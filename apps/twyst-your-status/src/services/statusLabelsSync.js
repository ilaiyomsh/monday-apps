import {
  buildStatusLabelsUpdatePayload,
  buildUpdateStatusColumnMutation,
  createLabelsDraft,
  ensureDefaultLabelRow,
  hasPendingLabelEdits,
  renumberDraftIndexes,
} from '../domain/statusLabelDraft.js';
import { normalizeStatusLabels } from '../domain/statusPolicy.js';
import { GET_STATUS_COLUMN_REVISION } from './graphqlQueries.js';
import mondayService from './mondayService.js';

/**
 * Push the settings screen's pending label edits to the status column, then read
 * back what monday now has.
 *
 * Returns `null` when there is nothing to send — the caller then keeps the
 * `activeLabelIds` it already derived from its own draft. Otherwise it returns
 * `{ activeLabelIds, reseededDraft }`: the ids monday reports as active after the
 * mutation, and the draft rebuilt from that answer for the caller to store.
 *
 * Throws on a column with no revision, exactly as the inline step did — the
 * caller's catch turns it into the save error message.
 */
export async function syncStatusLabels({ boardId, columnId, labelsDraft, labelsBaseline }) {
  if (!hasPendingLabelEdits(labelsDraft, labelsBaseline)) return null;

  const revisionData = await mondayService.query(GET_STATUS_COLUMN_REVISION, {
    boardIds: [String(boardId)],
    columnIds: [columnId],
  });
  const liveColumn = revisionData?.boards?.[0]?.columns?.[0];
  const revision = liveColumn?.revision;
  if (!revision) {
    throw new Error('חסר revision לעמודת הסטטוס — לא ניתן לעדכן לייבלים');
  }
  const liveFresh = normalizeStatusLabels(liveColumn.settings);
  /*
   * Renumber to 0..n-1 HERE, after the pending-edits check and before the payload:
   * the payload sends positions, with deactivated rows packed above the actives so
   * no two indexes collide. Doing it BEFORE `hasPendingLabelEdits` would read as an
   * edit on any column with a removed label and fire this mutation on every save.
   */
  const orderedDraft = renumberDraftIndexes(labelsDraft);
  const payload = buildStatusLabelsUpdatePayload(orderedDraft, liveFresh);
  const mutation = buildUpdateStatusColumnMutation(payload);
  await mondayService.query(mutation, {
    boardId: String(boardId),
    columnId,
    revision: String(revision),
  });

  const refreshed = await mondayService.query(GET_STATUS_COLUMN_REVISION, {
    boardIds: [String(boardId)],
    columnIds: [columnId],
  });
  const refreshedColumn = refreshed?.boards?.[0]?.columns?.[0];
  const refreshedLabels = normalizeStatusLabels(refreshedColumn?.settings);
  const activeLabelIds = refreshedLabels
    .filter((label) => !label.isDeactivated)
    .map((label) => String(label.id));

  /*
   * Re-seed the label draft from what monday now HAS, so a second save attempt —
   * after a storage failure, or the validation error below — starts from the
   * persisted state rather than replaying edits that already landed.
   */
  const reseededDraft = ensureDefaultLabelRow(createLabelsDraft(refreshedLabels));
  return { activeLabelIds, reseededDraft };
}
