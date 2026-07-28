/**
 * RequiredFieldsModal — the /required-fields route.
 *
 * WHY a separate iframe: the picker is a cell-attached Dialog Design fixed at
 * 200×250 in the Developer Center, and monday-sdk-js 0.5.9 has no runtime dialog
 * resize command. A two-column form needs `openAppFeatureModal`, which opens a
 * NEW iframe at a URL with an explicit pixel size. So this modal carries no state
 * from the picker: it receives ids through `urlParams` and re-reads everything.
 *
 * The picker passes board/column/item explicitly rather than trusting the modal's
 * monday context to carry a cell selection it never made.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { prefillFieldValue } from '../../domain/columnFields';
import { buildMultiColumnWritePayload } from '../../domain/columnValueFormats';
import { getLabelRule } from '../../domain/settingsSchema';
import { normalizeStatusLabels } from '../../domain/statusPolicy';
import {
  GET_REQUIRED_FIELDS_CONTEXT,
  UPDATE_MULTIPLE_COLUMN_VALUES,
} from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import useColumnSettings from '../../hooks/useColumnSettings';
import logger from '../../utils/logger';
import { readModalHandoffParams } from '../../utils/modalHandoffParams';
import ErrorState from '../shared/ErrorState';
import LoadingState from '../shared/LoadingState';
import RequiredFieldsForm from './RequiredFieldsForm';
import './OnClickDialog.css';

function RequiredFieldsModal({ context }) {
  // urlParams win: they name the cell the user actually clicked. Context is the
  // fallback for anything monday does propagate into the modal.
  const params = useMemo(() => readModalHandoffParams(window.location.search), []);
  const boardId = params.boardId ?? context?.boardId ?? null;
  const columnId = params.columnId ?? context?.columnId ?? null;
  const itemId = params.itemId ?? context?.itemId ?? null;
  const { labelId } = params;

  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
    reload: reloadSettings,
  } = useColumnSettings({ boardId, columnId });

  const [label, setLabel] = useState(null);
  const [fields, setFields] = useState([]);
  const [columnsById, setColumnsById] = useState(new Map());
  const [formValues, setFormValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const requiredColumnIds = useMemo(() => {
    if (settingsLoading || labelId === null) return null;
    return getLabelRule(settings, labelId).requiredColumnIds;
  }, [settings, settingsLoading, labelId]);

  const load = useCallback(async () => {
    if (!boardId || !columnId || !itemId || labelId === null) return;
    if (requiredColumnIds === null) return;
    try {
      setLoading(true);
      setError(null);
      const data = await mondayService.query(GET_REQUIRED_FIELDS_CONTEXT, {
        boardIds: [String(boardId)],
        statusColumnIds: [columnId],
        itemIds: [String(itemId)],
        columnIds: requiredColumnIds,
      });

      const statusColumn = data?.boards?.[0]?.columns?.[0] ?? null;
      const resolvedLabel = normalizeStatusLabels(statusColumn?.settings)
        .find((candidate) => candidate.id === String(labelId)) ?? null;
      if (!resolvedLabel) throw new Error('הסטטוס שנבחר לא נמצא בעמודה');

      const values = data?.items?.[0]?.column_values ?? [];
      const nextColumns = new Map();
      const initial = {};
      values.forEach((value) => {
        if (value.column) nextColumns.set(value.id, value.column);
        initial[value.id] = prefillFieldValue(value.column?.type ?? value.type, value);
      });

      setLabel(resolvedLabel);
      setColumnsById(nextColumns);
      setFormValues(initial);
      // Keep the settings' order — it is the order the admin arranged.
      setFields(requiredColumnIds.map((columnIdValue) => ({ columnId: columnIdValue })));
    } catch (err) {
      logger.error('RequiredFieldsModal', 'Failed to load required field values', err);
      setError(err.message || 'לא הצלחנו לטעון את שדות החובה');
    } finally {
      setLoading(false);
    }
  }, [boardId, columnId, itemId, labelId, requiredColumnIds]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Close this modal, and take the picker dialog behind it down too.
   *
   * `closeDialog` targets the cell dialog that opened us. It runs FIRST and
   * best-effort: if monday does not let a child modal close its parent it is a
   * no-op, and we still close ourselves. Doing it the other way round would leave
   * this iframe destroyed before the second call could run.
   */
  const close = useCallback(async () => {
    try {
      await mondayService.closeDialog();
    } catch (err) {
      logger.warn('RequiredFieldsModal', 'Could not close the picker dialog behind the modal', err);
    }
    try {
      await mondayService.closeAppFeatureModal();
    } catch (err) {
      logger.error('RequiredFieldsModal', 'Failed to close the required-fields modal', err);
    }
  }, []);

  const handleSubmit = async (values) => {
    try {
      setSaving(true);
      setError(null);
      const payload = buildMultiColumnWritePayload({
        statusColumnId: columnId,
        statusLabelId: label.id,
        formFields: fields,
        formValues: values,
        columnsById,
      });
      await mondayService.query(UPDATE_MULTIPLE_COLUMN_VALUES, {
        boardId: String(boardId),
        itemId: String(itemId),
        columnValues: JSON.stringify(payload),
      });
      await mondayService.showNotice(`הסטטוס עודכן ל״${label.label || 'ללא שם'}״`);
      await close();
    } catch (err) {
      logger.error('RequiredFieldsModal', 'Failed to save the status transition', err);
      // monday rejects a people write when the assignee is not subscribed to the
      // board — a generic "save failed" sends the user hunting in the wrong place.
      const message = /invalidPersonAssignment|unable to assign/i.test(err?.message || '')
        ? 'אחד הנמענים שנבחרו אינו מנוי ללוח הזה, ולכן monday דחה את ההקצאה.'
        : (err.message || 'לא הצלחנו לשמור את המעבר');
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!boardId || !columnId || !itemId || labelId === null) {
    return (
      <ErrorState message="הקישור לטופס חסר מזהים. סגרו ונסו לבחור את הסטטוס מחדש." />
    );
  }
  if (settingsError) {
    return <ErrorState message="טעינת ההגדרות נכשלה. נסו שוב." onRetry={reloadSettings} />;
  }
  if (settingsLoading || loading) {
    return <LoadingState message="טוען שדות חובה…" />;
  }
  if (error && !label) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <main className="twyst-required-fields-modal" dir="rtl">
      <RequiredFieldsForm
        label={label}
        fields={fields}
        columnsById={columnsById}
        initialValues={formValues}
        busy={saving}
        error={error}
        onCancel={close}
        onSubmit={handleSubmit}
      />
    </main>
  );
}

export default RequiredFieldsModal;
