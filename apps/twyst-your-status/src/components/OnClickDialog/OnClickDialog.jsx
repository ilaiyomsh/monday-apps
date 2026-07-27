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

  // Null storage = no rules yet → everyone may pick every active label.
  const effectiveSettings = settings ?? { version: 1, hiddenLabelIds: [], labels: {} };

  const pickerModel = useMemo(
    () => buildAvailableLabels({
      labels,
      settings: effectiveSettings,
      actor,
      currentValue,
    }),
    [actor, currentValue, labels, effectiveSettings],
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
    const rule = getLabelRule(effectiveSettings, label.id);
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

    const rule = getLabelRule(effectiveSettings, labelId);
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

  const NEUTRAL = 'hsl(0 0% 77%)';

  return (
    <main className="status-picker-dialog" aria-label="בחירת סטטוס" dir="rtl">
      {pickerModel.currentIsHidden && (
        <p className="status-picker-note">
          הסטטוס הנוכחי נקבע מחוץ לבורר (למשל אוטומציה) ואינו מוצג לבחירה.
        </p>
      )}

      {pickerModel.options.length > 0 ? (
        <div className="status-menu" role="listbox" aria-label="סטטוסים זמינים">
          {pickerModel.options.map((label) => {
            const isSaving = label.id === savingLabelId;
            return (
              <button
                key={label.id}
                className="status-option"
                type="button"
                role="option"
                aria-selected={false}
                disabled={savingLabelId !== null || user?.isViewOnly}
                style={{ background: label.color || NEUTRAL }}
                onClick={() => handleSelectLabel(label.id)}
              >
                {isSaving ? 'שומר…' : (label.label || 'ללא שם')}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="status-picker-empty">אין כרגע סטטוסים זמינים לבחירה.</p>
      )}

      {user?.isViewOnly && (
        <p className="status-picker-note">יש לך הרשאת צפייה בלבד ולכן לא ניתן לשנות את הסטטוס.</p>
      )}

      {error && <AttentionBox type="danger" text={error} />}
    </main>
  );
}

export default OnClickDialog;
