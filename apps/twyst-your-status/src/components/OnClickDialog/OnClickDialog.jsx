import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AttentionBox } from '@vibe/core';
import { buildAvailableLabels } from '../../domain/buildAvailableLabels';
import {
  buildMultiColumnWritePayload,
  prefillFormValue,
} from '../../domain/columnValueFormats';
import { getLabelRule } from '../../domain/settingsSchema';
import { normalizeStatusLabels, serializeStatusMutationValue } from '../../domain/statusPolicy';
import {
  GET_ITEM_FORM_VALUES,
  GET_STATUS_COLUMN_CONTEXT,
  UPDATE_MULTIPLE_COLUMN_VALUES,
  UPDATE_STATUS_COLUMN_VALUE,
} from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import { loadUserTeamIds } from '../../services/teamsAccess';
import useColumnSettings from '../../hooks/useColumnSettings';
import logger from '../../utils/logger';
import ErrorState from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import './OnClickDialog.css';

const UNCONFIGURED_TITLE = 'העמודה לא הוגדרה';
const UNCONFIGURED_TEXT =
  'העמודה עדיין לא הוגדרה. פתחו את תפריט העמודה, בחרו "הגדרות", והגדירו הרשאות ושדות חובה ללייבלים.';

function inputTypeFor(columnType) {
  if (columnType === 'numbers') return 'number';
  if (columnType === 'date') return 'date';
  if (columnType === 'email') return 'email';
  return 'text';
}

function RequiredFieldsForm({
  label,
  fields,
  columnsById,
  initialValues,
  busy,
  onCancel,
  onSubmit,
}) {
  const [values, setValues] = useState(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <form className="twyst-form" onSubmit={handleSubmit} aria-labelledby="required-fields-title">
      <header>
        <p className="status-guard-eyebrow">מעבר סטטוס</p>
        <h2 id="required-fields-title">
          השלמת פרטים לפני מעבר ל״
          {label.label || 'ללא שם'}
          ״
        </h2>
      </header>
      {fields.map((field) => {
        const column = columnsById.get(field.columnId);
        return (
          <label key={field.columnId}>
            {column?.title || field.columnId}
            <b> *</b>
            <input
              type={inputTypeFor(column?.type)}
              required
              value={values[field.columnId] ?? ''}
              disabled={busy}
              onChange={(event) => setValues({
                ...values,
                [field.columnId]: event.target.value,
              })}
            />
          </label>
        );
      })}
      <div className="twyst-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>ביטול</button>
        <button className="primary-action" type="submit" disabled={busy}>
          {busy ? 'שומר…' : 'שמירה ומעבר'}
        </button>
      </div>
    </form>
  );
}

function OnClickDialog({ context }) {
  const { boardId, columnId, itemId, user } = context || {};
  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
    reload: reloadSettings,
  } = useColumnSettings(context);

  const [labels, setLabels] = useState([]);
  const [currentValue, setCurrentValue] = useState(null);
  const [actor, setActor] = useState({ userId: String(user?.id ?? ''), teamIds: [] });
  const [columnsById, setColumnsById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingLabelId, setSavingLabelId] = useState(null);
  const [formTarget, setFormTarget] = useState(null);
  const [formValues, setFormValues] = useState({});

  const loadDialogData = useCallback(async () => {
    if (!boardId || !columnId || !itemId) return;
    try {
      setLoading(true);
      setError(null);
      const [data, teamsResult] = await Promise.all([
        mondayService.query(GET_STATUS_COLUMN_CONTEXT, {
          boardIds: [String(boardId)],
          itemIds: [String(itemId)],
          columnIds: [columnId],
        }),
        loadUserTeamIds(user?.id),
      ]);

      const column = data?.boards?.[0]?.columns?.[0];
      if (!column || column.type !== 'status') {
        throw new Error('העמודה שנפתחה אינה עמודת Status פעילה');
      }

      const item = data?.items?.[0];
      const statusValue = item?.column_values?.find((value) => value.id === columnId) ?? null;
      setLabels(normalizeStatusLabels(column.settings));
      setCurrentValue(statusValue);
      setActor({
        userId: String(user?.id ?? ''),
        teamIds: teamsResult.teamIds,
      });
      setColumnsById(new Map(
        (item?.column_values ?? [])
          .filter((value) => value.column)
          .map((value) => [value.id, value.column]),
      ));
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to load status picker data', err);
      setError(err.message || 'לא הצלחנו לטעון את הסטטוסים');
    } finally {
      setLoading(false);
    }
  }, [boardId, columnId, itemId, user?.id]);

  useEffect(() => {
    loadDialogData();
  }, [loadDialogData]);

  const pickerModel = useMemo(
    () => buildAvailableLabels({
      labels,
      settings,
      actor,
      currentValue,
    }),
    [actor, currentValue, labels, settings],
  );

  const writeStatusOnly = async (labelId) => {
    await mondayService.query(UPDATE_STATUS_COLUMN_VALUE, {
      boardId: String(boardId),
      itemId: String(itemId),
      columnId,
      value: serializeStatusMutationValue(labelId),
    });
  };

  const writeStatusAndFields = async (labelId, fields, values) => {
    const payload = buildMultiColumnWritePayload({
      statusColumnId: columnId,
      statusLabelId: labelId,
      formFields: fields,
      formValues: values,
      columnsById,
    });
    await mondayService.query(UPDATE_MULTIPLE_COLUMN_VALUES, {
      boardId: String(boardId),
      itemId: String(itemId),
      columnValues: JSON.stringify(payload),
    });
  };

  const openRequiredForm = async (label) => {
    const rule = getLabelRule(settings, label.id);
    const fieldIds = rule.requiredColumnIds;
    try {
      setSavingLabelId(label.id);
      setError(null);
      const data = await mondayService.query(GET_ITEM_FORM_VALUES, {
        itemIds: [String(itemId)],
        columnIds: fieldIds,
      });
      const values = data?.items?.[0]?.column_values ?? [];
      const nextColumns = new Map(columnsById);
      const initial = {};
      values.forEach((value) => {
        if (value.column) nextColumns.set(value.id, value.column);
        initial[value.id] = prefillFormValue(value.column?.type ?? value.type, value);
      });
      fieldIds.forEach((id) => {
        if (initial[id] === undefined) initial[id] = '';
      });
      setColumnsById(nextColumns);
      setFormValues(initial);
      setFormTarget({
        label,
        fields: fieldIds.map((columnIdValue) => ({ columnId: columnIdValue })),
      });
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to load required field values', err);
      setError(err.message || 'לא הצלחנו לטעון את שדות החובה');
    } finally {
      setSavingLabelId(null);
    }
  };

  const handleSelectLabel = async (labelId) => {
    const selectedLabel = pickerModel.options.find((label) => label.id === labelId);
    if (!selectedLabel || user?.isViewOnly) return;

    const rule = getLabelRule(settings, labelId);
    if (rule.requiredColumnIds.length > 0) {
      await openRequiredForm(selectedLabel);
      return;
    }

    try {
      setSavingLabelId(labelId);
      setError(null);
      await writeStatusOnly(labelId);
      await mondayService.showNotice(`הסטטוס עודכן ל״${selectedLabel.label}״`);
      await mondayService.closeDialog();
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to update status value', err);
      setError(err.message || 'לא הצלחנו לעדכן את הסטטוס');
    } finally {
      setSavingLabelId(null);
    }
  };

  const handleFormSubmit = async (values) => {
    if (!formTarget) return;
    try {
      setSavingLabelId(formTarget.label.id);
      setError(null);
      await writeStatusAndFields(formTarget.label.id, formTarget.fields, values);
      await mondayService.showNotice(`הסטטוס עודכן ל״${formTarget.label.label}״`);
      await mondayService.closeDialog();
    } catch (err) {
      logger.error('OnClickDialog', 'Failed to save status with required fields', err);
      setError(err.message || 'לא הצלחנו לשמור את המעבר');
    } finally {
      setSavingLabelId(null);
    }
  };

  if (settingsError) {
    return <ErrorState message="טעינת ההגדרות נכשלה. נסו שוב." onRetry={reloadSettings} />;
  }

  if (!settingsLoading && settings == null) {
    return (
      <div className="status-guard-dialog" dir="rtl">
        <AttentionBox type="primary" title={UNCONFIGURED_TITLE} text={UNCONFIGURED_TEXT} />
      </div>
    );
  }

  if (settingsLoading || loading) {
    return <LoadingState message="טוען את הסטטוסים…" />;
  }

  if (error && !formTarget) {
    return <ErrorState message={error} onRetry={loadDialogData} />;
  }

  if (formTarget) {
    return (
      <main className="status-guard-dialog" dir="rtl">
        {error && <AttentionBox type="danger" text={error} />}
        <RequiredFieldsForm
          label={formTarget.label}
          fields={formTarget.fields}
          columnsById={columnsById}
          initialValues={formValues}
          busy={savingLabelId !== null}
          onCancel={() => {
            setFormTarget(null);
            setError(null);
          }}
          onSubmit={handleFormSubmit}
        />
      </main>
    );
  }

  return (
    <main className="status-guard-dialog" aria-labelledby="status-picker-title">
      <header className="status-guard-header">
        <div>
          <p className="status-guard-eyebrow">Twyst Your Status</p>
          <h1 id="status-picker-title">בחירת סטטוס</h1>
        </div>
      </header>

      <section className="current-status" aria-label="הסטטוס הנוכחי">
        <span className="section-label">הסטטוס הנוכחי</span>
        {pickerModel.currentLabel ? (
          <div className="current-status-row">
            <span
              className="status-chip"
              style={{ '--status-color': pickerModel.currentLabel.color }}
            >
              {pickerModel.currentLabel.label}
            </span>
            {pickerModel.currentIsHidden && (
              <span className="automation-only-badge">לצפייה בלבד</span>
            )}
          </div>
        ) : (
          <span className="empty-current-status">לא נבחר סטטוס</span>
        )}
        {pickerModel.currentIsHidden && (
          <p className="restricted-explanation">
            הסטטוס הזה נקבע מחוץ לבורר — למשל על ידי אוטומציה — ולכן הוא מוצג אך אינו זמין לבחירה ידנית.
          </p>
        )}
      </section>

      <section aria-labelledby="available-statuses-title">
        <h2 id="available-statuses-title">אפשרויות זמינות</h2>
        {pickerModel.options.length > 0 ? (
          <div className="status-options" role="listbox" aria-label="סטטוסים זמינים">
            {pickerModel.options.map((label) => {
              const isSelected = label.id === pickerModel.currentLabelId;
              const isSaving = label.id === savingLabelId;
              return (
                <button
                  key={label.id}
                  className={`status-option${isSelected ? ' is-selected' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={savingLabelId !== null || user?.isViewOnly}
                  onClick={() => handleSelectLabel(label.id)}
                >
                  <span className="status-option-name">
                    <span className="status-dot" style={{ '--status-color': label.color }} />
                    {label.label || 'ללא שם'}
                  </span>
                  <span className="status-option-state">
                    {isSaving ? 'שומר…' : isSelected ? 'נבחר' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="empty-options">אין כרגע סטטוסים זמינים לבחירה.</p>
        )}
      </section>

      {user?.isViewOnly && (
        <p className="view-only-note">יש לך הרשאת צפייה בלבד ולכן לא ניתן לשנות את הסטטוס.</p>
      )}
    </main>
  );
}

export default OnClickDialog;
