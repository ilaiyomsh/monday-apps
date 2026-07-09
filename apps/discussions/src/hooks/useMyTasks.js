import { useState, useEffect, useCallback, useRef } from 'react';
import { משימות1Board } from '@api/BoardSDK.js';
import { api, parseValue, cvSelection } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import logger from '../utils/logger.js';

/*
 * "My Tasks" data hook (client-only).
 *
 * Reads tasks straight off the TASKS board (not from a single discussion's
 * relation) and filters them SERVER-SIDE to the current user via the
 * responsibility people column (alias `responsibilityID` / "אחריות"):
 *   query_params.rules = [{ column_id: <responsibilityID id>, compare_value: [userId],
 *                           operator: any_of }]
 * monday's any_of on a people column matches items where that user is among the
 * column's persons — exactly "tasks assigned to me". An optional taskCreatorID
 * filter (alias `taskCreatorID`) adds a second any_of rule on the creator column.
 *
 * Cursor pagination: the first page comes from boards.items_page; "load more"
 * follows the returned cursor via next_items_page (handled inside BoardSDK's
 * ItemsQueryBuilder — withPagination({ cursor })).
 *
 * Each task is mapped through parseValue (via BoardSDK.mapItem) so the rendered
 * shape matches the rest of the app: { id, name, created_at, responsibilityID, deadlineID,
 * statusID, discussionLinkID (discussion relation), taskNotesID, priorityID }. The discussion
 * name shown in the table comes from the discussionLinkID board_relation's linked_items.
 *
 * Inline edits (status / priority / notes / deadline / name) are optimistic and
 * revert on error, writing through BoardSDK .item(id).update()
 * (change_multiple_column_values). Which of them a given row actually offers is
 * gated per task by the board-permissions matrix (MyTasksView's canTask →
 * resolveCan with { item }, no discussion).
 */

const PAGE_SIZE = 100;
// Undo window for deferred bulk delete — matches the delete toast auto-hide.
const DELETE_GRACE_MS = 6000;

// Columns the "My Tasks" view renders / filters on. Kept lean so the page query
// stays light. discussionLinkID is the discussion board_relation (for the discussion
// column + the discussion grouping); taskNotesID is the inline-editable notes col;
// priorityID is a SECOND status column (its label order = priorityID order).
// taskCreatorID is fetched for the PERMISSION resolution only (the task-tier
// "creator" role in resolveCan) — it isn't rendered as a column here.
const RENDERED_COLUMNS = ['responsibilityID', 'taskCreatorID', 'deadlineID', 'statusID', 'discussionLinkID', 'taskNotesID', 'priorityID'];

// Resolve the current user's person id as a string, tolerant of the few shapes
// monday's context exposes it in (currentUser.id, context.user.id).
export function resolveUserId(currentUser, context) {
  const raw =
    currentUser?.id ??
    context?.user?.id ??
    context?.userId ??
    null;
  if (raw == null || raw === '') return null;
  return String(raw);
}

// Build the BoardSDK `where` clause for the My Tasks query. Exported so the
// query-shape can be unit-tested without a live board.
//   - responsibilityID (responsibility people): any_of current user
//   - taskCreatorID (people): any_of, only when a creator filter is supplied
//   - name: client-side contains search (BoardSDK handles it post-fetch)
export function buildMyTasksWhere({ userId, taskCreatorId, search }) {
  const where = {};
  if (userId) where.responsibilityID = String(userId);
  if (taskCreatorId) where.taskCreatorID = String(taskCreatorId);
  if (search && String(search).trim()) where.name = String(search).trim();
  return where;
}

export function useMyTasks({ currentUser, context, taskCreatorId = null, search = '', sort = null } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState(null);

  const userId = resolveUserId(currentUser, context);
  // Stable filter key so the fetch effect only re-runs on a real change.
  const filterKey = JSON.stringify({ userId, taskCreatorId, search: (search || '').trim(), sort });
  const reqIdRef = useRef(0);
  // Mirror of `items` for SYNCHRONOUS snapshots: an optimistic edit needs the
  // pre-edit list captured at call time so it can revert on error. Reading it
  // inside a setItems updater is unreliable (React may defer the updater past
  // the time the write rejects), so we keep this ref in lockstep with state.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const fetchPage = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    // Not configured yet (Settings not mapped) or no resolvable user → empty.
    if (!getBoardId('tasks') || !getColumns('tasks')?.responsibilityID?.id || !userId) {
      setItems([]);
      setCursor(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const where = buildMyTasksWhere({ userId, taskCreatorId, search });
      let q = new משימות1Board().items()
        .withColumns(RENDERED_COLUMNS)
        .withGroup() // need item.group for the board-group grouping
        .withPagination({ limit: PAGE_SIZE })
        .where(where);
      // Sort is { column, direction } over an aliased column (e.g. deadline =
      // deadlineID, status = statusID). monday orders by the real column id (BoardSDK
      // resolves the alias). Priority sort is done CLIENT-SIDE in the view (the
      // label display order — not the label id — defines priorityID), so it is
      // never passed here. Name/discussion sorts fall back to client order.
      if (sort?.column) q = q.orderBy({ column: sort.column, direction: sort.direction || 'asc' });
      const res = await q.execute();
      if (reqId !== reqIdRef.current) return; // a newer request superseded this one
      setItems(res.items || []);
      setCursor(res.cursor || null);
      setError(null);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      logger.error('useMyTasks', 'Error fetching my tasks', { userId, err });
      setError(err?.message || 'fetch failed');
      setItems([]);
      setCursor(null);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [userId, taskCreatorId, search, sort?.column, sort?.direction]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPage();
    // filterKey collapses the dependency set into one stable string.
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await new משימות1Board().items()
        .withColumns(RENDERED_COLUMNS)
        .withGroup()
        .withPagination({ cursor })
        .execute();
      setItems((prev) => {
        const have = new Set(prev.map((t) => String(t.id)));
        const fresh = (res.items || []).filter((t) => !have.has(String(t.id)));
        return [...prev, ...fresh];
      });
      setCursor(res.cursor || null);
    } catch (err) {
      logger.error('useMyTasks', 'Error loading more my tasks', err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  // Optimistic inline edit of a status-shaped column — revert on error. Used for
  // both `statusID` (status) and `priorityID`; both store the stable label id (id 0
  // is valid, so callers guard on null/'' upstream).
  const updateStatusColumn = useCallback((alias) => async (taskId, value) => {
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, [alias]: value } : t))
    );
    try {
      await new משימות1Board().item(taskId).update({ [alias]: value }).execute();
    } catch (err) {
      logger.error('useMyTasks', `Error updating task ${alias}`, err);
      setItems(prev);
    }
  }, []);

  const updateTaskStatus = useCallback((taskId, status) => updateStatusColumn('statusID')(taskId, status), [updateStatusColumn]);
  const updateTaskPriority = useCallback((taskId, value) => updateStatusColumn('priorityID')(taskId, value), [updateStatusColumn]);

  // Optimistic inline deadline edit — `date` is a Date or null (clear). The
  // write shape mirrors useTasks.updateTaskDeadline (local Y-M-D string).
  const updateTaskDeadline = useCallback(async (taskId, date) => {
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, deadlineID: date || null } : t))
    );
    try {
      const f = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : null;
      await new משימות1Board().item(taskId).update({ deadlineID: f }).execute();
    } catch (err) {
      logger.error('useMyTasks', 'Error updating task deadline', err);
      setItems(prev);
    }
  }, []);

  // Optimistic inline rename — mirrors useTasks.updateTaskName ({ name } rides
  // change_multiple_column_values' name key). Empty names are ignored upstream.
  const updateTaskName = useCallback(async (taskId, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, name: trimmed } : t))
    );
    try {
      await new משימות1Board().item(taskId).update({ name: trimmed }).execute();
    } catch (err) {
      logger.error('useMyTasks', 'Error renaming task', err);
      setItems(prev);
    }
  }, []);

  // Optimistic inline notes edit (taskNotesID, a text/long_text column) — revert
  // on error.
  const updateTaskNotes = useCallback(async (taskId, notes) => {
    const next = notes == null ? '' : String(notes);
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    setItems((current) =>
      current.map((t) => (String(t.id) === String(taskId) ? { ...t, taskNotesID: next } : t))
    );
    try {
      await new משימות1Board().item(taskId).update({ taskNotesID: next }).execute();
    } catch (err) {
      logger.error('useMyTasks', 'Error updating task notes', err);
      setItems(prev);
    }
  }, []);

  // Deferred bulk delete with an undo window (mirrors useTasks.softDeleteTasks):
  // rows vanish optimistically now, the real delete_item fires only after
  // DELETE_GRACE_MS, and the returned undo() (wired to the toast's "בטל") cancels
  // the pending delete and restores the rows. monday has no simple un-delete.
  const softDeleteTasks = useCallback((ids) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!idList.length) return { undo: () => {}, count: 0 };
    const idSet = new Set(idList.map(String));
    const removed = itemsRef.current.filter((i) => idSet.has(String(i.id))); // snapshot for restore
    setItems((current) => current.filter((i) => !idSet.has(String(i.id))));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      idList.forEach((id) => {
        api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: id }, 'useMyTasks.softDeleteTasks')
          .catch((err) => logger.error('useMyTasks', 'Error deleting task', err));
      });
    }, DELETE_GRACE_MS);

    const undo = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      setItems((current) => {
        const have = new Set(current.map((i) => String(i.id)));
        return [...current, ...removed.filter((i) => !have.has(String(i.id)))];
      });
    };
    return { undo, count: idList.length };
  }, []);

  const refresh = useCallback(() => fetchPage(), [fetchPage]);

  // Create a standalone task from the My Tasks view (no discussion link). The
  // responsibility (responsibilityID) is stamped with the CURRENT user so the new
  // task passes the server-side "assigned to me" filter this view runs on — a
  // task created here without me as assignee would never appear in the list.
  // taskCreatorID is stamped too (mirrors useTasks.createTask). status/priority
  // are label ids (0 is valid); deadline is a Date; notes is text. The new row is
  // APPENDED optimistically by default (bottom of its group); pass `prepend:true`
  // (the top "משימה חדשה" button) to insert it at the FRONT instead, so it can be
  // surfaced at the very top of the view. Its temp id is swapped for the real one
  // on success (no full refetch → no skeleton flash). Optional callbacks let the
  // caller track the row across that swap: `onOptimistic(tempId)` fires the moment
  // the optimistic row is inserted, `onReconcile(tempId, realId)` the moment the
  // temp id becomes the real id — used by the view to keep the new row pinned to
  // the top through the create round-trip.
  const createTask = useCallback(async ({
    name, status = null, priority = null, deadline = null, notes = '',
    prepend = false, onOptimistic = null, onReconcile = null,
  } = {}) => {
    const trimmed = (name || '').trim();
    if (!trimmed || !userId) return null;
    const tempId = `temp-${Date.now()}`;
    const meAsPerson = [{ id: String(userId), name: currentUser?.name || '' }];
    const optimisticRow = {
      id: tempId,
      name: trimmed,
      responsibilityID: meAsPerson,
      // Stamp the creator locally too — the permission gate (canTask) reads
      // it, so the fresh optimistic row is immediately editable by its maker.
      taskCreatorID: meAsPerson,
      deadlineID: deadline instanceof Date ? deadline : null,
      statusID: status,
      priorityID: priority,
      taskNotesID: notes || '',
    };
    setItems((prev) => (prepend ? [optimisticRow, ...prev] : [...prev, optimisticRow]));
    onOptimistic?.(tempId);
    try {
      const data = { name: trimmed, responsibilityID: [Number(userId)] };
      if (getColumns('tasks')?.taskCreatorID?.id) data.taskCreatorID = [Number(userId)];
      if (status != null) data.statusID = status; // label id; 0 is valid
      if (priority != null) data.priorityID = priority;
      if (deadline instanceof Date) {
        data.deadlineID = `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}`;
      }
      if (notes && String(notes).trim()) data.taskNotesID = String(notes);
      const created = await new משימות1Board().item().create(data, { createLabelsIfMissing: true }).execute();
      const realId = created.id;
      setItems((prev) => prev.map((t) => (t.id === tempId ? { ...t, id: realId } : t)));
      // Let the caller migrate any temp-id tracking (e.g. the top-of-view pin)
      // to the real id in the SAME tick as the swap, so the row never flickers
      // out of its pinned position during reconciliation.
      onReconcile?.(tempId, realId);
      return { id: realId };
    } catch (err) {
      logger.error('useMyTasks', 'Error creating task', err);
      setItems((prev) => prev.filter((t) => t.id !== tempId));
      return null;
    }
  }, [userId, currentUser?.name]);

  return {
    items,
    loading,
    loadingMore,
    cursor,
    hasMore: !!cursor,
    error,
    userId,
    loadMore,
    updateTaskStatus,
    updateTaskPriority,
    updateTaskNotes,
    updateTaskDeadline,
    updateTaskName,
    softDeleteTasks,
    createTask,
    refresh,
  };
}

// Pull the list of task CREATORS (distinct people on the taskCreatorID column)
// for the optional "filter by creator" dropdown. Returns [{ id, name }].
// Scans up to a few pages of the user's tasks — the creator set is small, so a
// bounded scan is fine. Kept here (vs the hook) so the view can lazy-load it.
export async function fetchTaskCreators({ userId, limit = 300 } = {}) {
  const boardId = getBoardId('tasks');
  const cols = getColumns('tasks') || {};
  const creatorColId = cols?.taskCreatorID?.id;
  const respColId = cols?.responsibilityID?.id;
  if (!boardId || !creatorColId) return [];
  const rules = [];
  if (userId && respColId) {
    rules.push({ column_id: respColId, compare_value: [String(userId)], operator: 'any_of' });
  }
  const qp = rules.length ? { rules } : undefined;
  const cv = cvSelection(['people']);
  try {
    const data = await api(
      `query ($boardId: ID!, $limit: Int!, $qp: ItemsQuery, $ids: [String!]) {
         boards(ids: [$boardId]) {
           items_page(limit: $limit, query_params: $qp) {
             items { id column_values(ids: $ids) { ${cv} } }
           }
         }
       }`,
      { boardId, limit, qp, ids: [creatorColId] },
      'useMyTasks.fetchTaskCreators'
    );
    const pageItems = data?.boards?.[0]?.items_page?.items || [];
    const byId = new Map();
    pageItems.forEach((it) => {
      const cvv = (it.column_values || [])[0];
      const people = parseValue('people', cvv) || [];
      people.forEach((p) => { if (p?.id && !byId.has(String(p.id))) byId.set(String(p.id), { id: String(p.id), name: p.name || '' }); });
    });
    return [...byId.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  } catch (err) {
    logger.error('useMyTasks', 'Error fetching task creators', err);
    return [];
  }
}
