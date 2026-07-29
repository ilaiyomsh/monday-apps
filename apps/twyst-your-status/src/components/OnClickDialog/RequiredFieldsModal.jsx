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
import { assertStatusWritten } from '../../domain/statusWriteResult';
import {
  GET_REQUIRED_FIELDS_CONTEXT,
  UPDATE_MULTIPLE_COLUMN_VALUES,
} from '../../services/graphqlQueries';
import mondayService from '../../services/mondayService';
import useColumnSettings from '../../hooks/useColumnSettings';
import logger from '../../utils/logger';
import { dismissBootLoader } from '../../utils/bootLoader';
import { readModalHandoffParams } from '../../utils/modalHandoffParams';
import ErrorState from '../shared/ErrorState';
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
  const hasIds = Boolean(boardId && columnId && itemId) && labelId !== null;

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
      const data = await mondayService.query(UPDATE_MULTIPLE_COLUMN_VALUES, {
        boardId: String(boardId),
        itemId: String(itemId),
        columnValues: JSON.stringify(payload),
        statusColumnId: String(columnId),
      });
      /*
       * The form closes on this line and NOT before, which is the whole ordering:
       * click → the form stays open with a spinner → the write comes back → close.
       * `assertStatusWritten` is what makes "came back" mean "the status changed" —
       * the mutation echoes the status column, and an echo naming a different label
       * (or no item at all) arrives inside a 200 with no `errors`.
       *
       * No success notice for a status change: the cell shows the result, and the
       * modal closing is itself the confirmation. Failures speak — see the catch.
       */
      assertStatusWritten(data?.change_multiple_column_values, columnId, label.id);
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

  // This modal is its own iframe, so it serves the same index.html as the picker and
  // paints the same boot overlay — monday's black spinner, continued. Release it the
  // moment there is something real to show, exactly as OnClickDialog does. Missing ids
  // and a settings failure both count as "something to show": an error must never sit
  // behind a spinner, and `loading` stays true forever on the missing-ids path because
  // load() returns before its finally block.
  const stillLoading = hasIds && (settingsLoading || loading) && !settingsError;
  useEffect(() => {
    if (!stillLoading) dismissBootLoader();
  }, [stillLoading]);

  if (!hasIds) {
    return (
      <ErrorState message="הקישור לטופס חסר מזהים. סגרו ונסו לבחור את הסטטוס מחדש." />
    );
  }
  if (settingsError) {
    return <ErrorState message="טעינת ההגדרות נכשלה. נסו שוב." onRetry={reloadSettings} />;
  }
  if (settingsLoading || loading) {
    // Nothing of our own: the boot overlay is still up, and drawing a second loader
    // over it is the visible jump the overlay exists to remove.
    return null;
  }
  if (error && !label) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <main className="twyst-required-fields-modal" dir="rtl">
      <RequiredFieldsForm
        fields={fields}
        columnsById={columnsById}
        initialValues={formValues}
        busy={saving}
        error={error}
        onSubmit={handleSubmit}
      />
    </main>
  );
}

export default RequiredFieldsModal;
