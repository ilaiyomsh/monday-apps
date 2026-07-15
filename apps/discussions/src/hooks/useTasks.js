import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { משימות1Board } from '@api/BoardSDK.js';
import { api, parseValue, cvSelection } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { MondayContext } from '@generated/contexts/MondayContext.jsx';
import logger from '../utils/logger';
import { useOptimisticRows, isTempId, isRealId, nextTempId } from './useOptimisticRows.js';

// Undo window for deferred task deletion — must match the delete toast's
// auto-hide duration so the real delete fires exactly when "בטל" disappears.
const DELETE_GRACE_MS = 6000;

// Discussion-side fetch: from the discussion id we read the tasksBoardLinkID
// board_relation column and pull its linked_items (the tasks), requesting only
// the task columns these views render (responsibilityID assignee, deadlineID deadline,
// statusID status). Server-side query_params filtering on a board_relation
// column does NOT work (it matches by item NAME, not id), so we always read the
// relation FROM the discussion side — the discussion item carries the links.
async function fetchTasksByDiscussion(discussionId) {
  const discussionsBoardId = getBoardId('discussions');
  const discussionColumns = getColumns('discussions') || {};
  const tasksLinkColId = discussionColumns?.tasksBoardLinkID?.id;
  if (!discussionsBoardId || !tasksLinkColId) {
    logger.error('useTasks', 'Missing discussions board id or tasksBoardLinkID column id', {
      discussionId,
      discussionsBoardId,
      tasksLinkColId,
    });
    return [];
  }

  const taskColumns = getColumns('tasks') || {};
  // assignee, deadline, status + priority (a second status column, read-only;
  // rendered by TasksTab/EffectivenessTab only when mapped). Unmapped aliases
  // drop out via the Boolean filter below, so listing it here is always safe.
  const RENDERED = ['responsibilityID', 'deadlineID', 'statusID', 'priorityID'];
  // Permission role-source people columns (item 19/20). NOT rendered, but
  // resolveCan scans them per task — if they aren't fetched they deserialize to
  // [] and `itemReady` (an array IS "ready") lets the matrix falsely DENY a task
  // creator/editor here while allowing them in My Tasks (which does fetch them).
  // responsibilityID is already fetched above; add the rest.
  const PERMISSION_COLS = ['taskCreatorID', 'taskViewersID', 'taskEditorsID'];
  const FETCH_ALIASES = [...RENDERED, ...PERMISSION_COLS];
  const taskCols = FETCH_ALIASES.map((alias) => taskColumns?.[alias]?.id).filter(Boolean);
  const taskCv = cvSelection(FETCH_ALIASES.map((alias) => taskColumns?.[alias]?.type));

  const data = await api(
    `query ($discussionId: [ID!], $tasksLinkCol: [String!], $taskCols: [String!]) {
      items(ids: $discussionId) {
        column_values(ids: $tasksLinkCol) {
          ... on BoardRelationValue {
            linked_items {
              id
              name
              created_at
              column_values(ids: $taskCols) { ${taskCv} }
            }
          }
        }
      }
    }`,
    {
      discussionId: [String(discussionId)],
      tasksLinkCol: [String(tasksLinkColId)],
      taskCols,
    },
    'useTasks.fetchTasksByDiscussion'
  );

  const linkedItems = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
  return linkedItems.map((item) => {
    const byId = {};
    (item.column_values || []).forEach((cv) => {
      byId[cv.id] = cv;
    });
    const mapped = { id: String(item.id), name: item.name, created_at: item.created_at };
    Object.entries(taskColumns).forEach(([alias, col]) => {
      if (!col?.id) return;
      mapped[alias] = parseValue(col.type, byId[col.id]);
    });
    return mapped;
  });
}

export function useTasks(discussionId, discussionTypeId = null) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Current user id — used to stamp the task creator (taskCreatorID) on create.
  // Read MondayContext SOFTLY (useContext, not useMondayContext) so the hook
  // still works in surfaces/tests rendered without a MondayProvider; stamping
  // simply no-ops when no user is available.
  const ctxApi = useContext(MondayContext);
  const currentUserId = ctxApi?.currentUser?.id ?? ctxApi?.context?.user?.id ?? null;

  // The parent discussion's "סוג" (discussionTypeID) is now a DROPDOWN value =
  // the label TEXT directly. taskTypeID (tasks board) is still a status column;
  // label TEXT bridges the two. Every task created from this discussion is
  // stamped with this text on taskTypeID (paired with create_labels_if_missing)
  // so the "Previous tasks by discussion type" view can filter on it — writing
  // by text means the stamp succeeds even when no same-text label exists on the
  // tasks board yet (monday creates it).
  const taskTypeText = discussionTypeId || null;

  // Optimistic-row bookkeeping: queue edits made on a freshly-added row BEFORE
  // its real id arrives, and stash create args for retry (see useOptimisticRows).
  const {
    enqueueEdit, drainEdits, stashCreateArgs, getCreateArgs, forgetRow,
    protectRealId, unprotectRealId, mergeServerList,
  } = useOptimisticRows();
  // Live handle to the per-field update fns so createTask's reconcile step can
  // FLUSH queued edits through the SAME mutations a committed row uses (assigned
  // each render, just before the hook returns).
  const flushersRef = useRef({});
  // tempId -> already-created real id. create_item and the follow-up relation
  // write are two steps; if the SECOND fails, the item already exists on the
  // board. Remembering its id lets a retry RESUME from the relation write instead
  // of calling create_item again (which would leave a duplicate, unlinked task).
  const createdRealIdRef = useRef(new Map());

  useEffect(() => {
    if (!discussionId) { setItems([]); setLoading(false); return; }
    let cancelled = false;
    async function fetch() {
      try {
        setLoading(true);
        logger.info('useTasks', 'Fetching tasks for discussion', { discussionId });
        const fetchedItems = await fetchTasksByDiscussion(discussionId);
        if (!cancelled) {
          setItems(fetchedItems);
          logger.info('useTasks', 'Tasks fetch completed', { discussionId, count: fetchedItems.length });
        }
      } catch (err) {
        logger.error('useTasks', 'Error fetching tasks', { discussionId, err });
      }
      finally { if (!cancelled) setLoading(false); }
    }
    fetch();
    return () => { cancelled = true; };
  }, [discussionId]);

  // Silent refetch — re-pulls the discussion's tasks WITHOUT toggling `loading`
  // (no skeleton flash). Used after a create so the shared list (Tasks tab) and
  // the derived metrics (Effectiveness tab) reflect the authoritative server state.
  const refresh = useCallback(async () => {
    if (!discussionId) return;
    try {
      const fetchedItems = await fetchTasksByDiscussion(discussionId);
      // Multi-row-safe MERGE (not a REPLACE). Keeps every in-flight temp row and
      // every just-created (protected) row the eventually-consistent relation
      // read hasn't surfaced yet. Replacing the list was the "create 3 tasks
      // fast, then set their status → the first two vanish and one reappears"
      // bug: an early create's fire-and-forget refresh() overwrote the list with
      // a server snapshot that still lacked the other in-flight rows, so their
      // later reconciles found no temp row to swap (temp→real) and the rows were
      // lost until a subsequent refresh happened to catch them.
      setItems((current) => mergeServerList(current, fetchedItems));
    } catch (err) {
      logger.error('useTasks', 'Error refreshing tasks', { discussionId, err });
    }
  }, [discussionId, mergeServerList]);

  const updateTaskName = async (taskId, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === taskId ? { ...i, name: trimmed } : i));
    });
    if (!isRealId(taskId)) { enqueueEdit(taskId, 'name', trimmed); return; }
    try {
      const b = new משימות1Board();
      await b.item(taskId).update({ name: trimmed }).execute();
    } catch (err) { logger.error('useTasks', 'Error updating task', err); setItems(prev); }
  };

  const updateTaskStatus = async (taskId, status) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === taskId ? { ...i, statusID: status } : i));
    });
    if (!isRealId(taskId)) { enqueueEdit(taskId, 'statusID', status); return; }
    try {
      const b = new משימות1Board();
      await b.item(taskId).update({ statusID: status }).execute();
    } catch (err) { logger.error('useTasks', 'Error updating task', err); setItems(prev); }
  };

  const updateTaskPriority = async (taskId, priority) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === taskId ? { ...i, priorityID: priority } : i));
    });
    if (!isRealId(taskId)) { enqueueEdit(taskId, 'priorityID', priority); return; }
    try {
      const b = new משימות1Board();
      await b.item(taskId).update({ priorityID: priority }).execute();
    } catch (err) { logger.error('useTasks', 'Error updating task', err); setItems(prev); }
  };

  const updateTaskAssignee = async (taskId, people) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === taskId ? { ...i, responsibilityID: people } : i));
    });
    if (!isRealId(taskId)) { enqueueEdit(taskId, 'responsibilityID', people); return; }
    try {
      const b = new משימות1Board();
      await b.item(taskId).update({ responsibilityID: people.map(p => Number(p.id)) }).execute();
    } catch (err) { logger.error('useTasks', 'Error updating task', err); setItems(prev); }
  };

  const updateTaskDeadline = async (taskId, date) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === taskId ? { ...i, deadlineID: date } : i));
    });
    if (!isRealId(taskId)) { enqueueEdit(taskId, 'deadlineID', date); return; }
    try {
      const b = new משימות1Board();
      const f = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : null;
      await b.item(taskId).update({ deadlineID: f }).execute();
    } catch (err) { logger.error('useTasks', 'Error updating task', err); setItems(prev); }
  };

  const updateTasksStatusBatch = async (taskIds, status) => {
    const ids = [...new Set((taskIds || []).map((id) => String(id)).filter(Boolean))];
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (idsSet.has(String(i.id)) ? { ...i, statusID: status } : i));
    });
    // Temp rows aren't on the board yet — queue their edit; only write real ones.
    ids.filter((id) => !isRealId(id)).forEach((id) => enqueueEdit(id, 'statusID', status));
    const realIds = ids.filter(isRealId);
    if (realIds.length === 0) return;
    try {
      const b = new משימות1Board();
      const results = await Promise.allSettled(realIds.map((id) => b.item(id).update({ statusID: status }).execute()));
      const failedIds = realIds.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('useTasks', 'Batch status update partially failed', { failedIds, total: realIds.length });
      const prevById = new Map(prev.map((i) => [String(i.id), i]));
      const failedSet = new Set(failedIds);
      setItems((current) => current.map((i) => (failedSet.has(String(i.id)) ? (prevById.get(String(i.id)) || i) : i)));
    } catch (err) {
      logger.error('useTasks', 'Batch status update failed', err);
      setItems(prev);
    }
  };

  const updateTasksAssigneeBatch = async (taskIds, people) => {
    const ids = [...new Set((taskIds || []).map((id) => String(id)).filter(Boolean))];
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (idsSet.has(String(i.id)) ? { ...i, responsibilityID: people } : i));
    });
    // Temp rows aren't on the board yet — queue their edit; only write real ones.
    ids.filter((id) => !isRealId(id)).forEach((id) => enqueueEdit(id, 'responsibilityID', people));
    const realIds = ids.filter(isRealId);
    if (realIds.length === 0) return;
    try {
      const b = new משימות1Board();
      const peopleIds = (people || []).map((p) => Number(p.id));
      const results = await Promise.allSettled(realIds.map((id) => b.item(id).update({ responsibilityID: peopleIds }).execute()));
      const failedIds = realIds.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('useTasks', 'Batch assignee update partially failed', { failedIds, total: realIds.length });
      const prevById = new Map(prev.map((i) => [String(i.id), i]));
      const failedSet = new Set(failedIds);
      setItems((current) => current.map((i) => (failedSet.has(String(i.id)) ? (prevById.get(String(i.id)) || i) : i)));
    } catch (err) {
      logger.error('useTasks', 'Batch assignee update failed', err);
      setItems(prev);
    }
  };

  const updateTasksDeadlineBatch = async (taskIds, date) => {
    const ids = [...new Set((taskIds || []).map((id) => String(id)).filter(Boolean))];
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (idsSet.has(String(i.id)) ? { ...i, deadlineID: date } : i));
    });
    // Temp rows aren't on the board yet — queue their edit; only write real ones.
    ids.filter((id) => !isRealId(id)).forEach((id) => enqueueEdit(id, 'deadlineID', date));
    const realIds = ids.filter(isRealId);
    if (realIds.length === 0) return;
    try {
      const b = new משימות1Board();
      const formatted = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : null;
      const results = await Promise.allSettled(realIds.map((id) => b.item(id).update({ deadlineID: formatted }).execute()));
      const failedIds = realIds.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('useTasks', 'Batch deadline update partially failed', { failedIds, total: realIds.length });
      const prevById = new Map(prev.map((i) => [String(i.id), i]));
      const failedSet = new Set(failedIds);
      setItems((current) => current.map((i) => (failedSet.has(String(i.id)) ? (prevById.get(String(i.id)) || i) : i)));
    } catch (err) {
      logger.error('useTasks', 'Batch deadline update failed', err);
      setItems(prev);
    }
  };

  const deleteTask = useCallback(async (taskId) => {
    if (!taskId) return false;
    unprotectRealId(taskId); // a deleted row must not be resurrected by a later refresh-merge
    const prev = [...items];
    setItems((current) => current.filter((i) => i.id !== taskId));
    // A temp row never reached the board — local removal is enough.
    if (isTempId(taskId)) { forgetRow(taskId); return true; }
    try {
      await api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: taskId }, 'useTasks.deleteTask');
      return true;
    } catch (err) {
      logger.error('useTasks', 'Error deleting task', err);
      setItems(prev);
      return false;
    }
  }, [items, forgetRow, unprotectRealId]);

  // Deferred ("soft") delete with an undo window: the rows vanish from the UI
  // immediately, but the real delete_item fires only after DELETE_GRACE_MS — so
  // the returned `undo()` (wired to the toast's "בטל" button) can cancel the
  // pending delete and restore the rows. monday has no simple un-delete, so
  // deferring is the only way to offer a true undo.
  const softDeleteTasks = useCallback((ids) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!idList.length) return { undo: () => {}, count: 0 };
    const idSet = new Set(idList.map(String));
    idList.forEach((id) => unprotectRealId(id)); // don't let a concurrent refresh-merge resurrect a soft-deleted row
    const removed = items.filter((i) => idSet.has(String(i.id))); // snapshot for restore
    setItems((current) => current.filter((i) => !idSet.has(String(i.id))));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      idList.forEach((id) => {
        // Temp rows never reached the board — just drop their bookkeeping.
        if (isTempId(id)) { forgetRow(id); return; }
        api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: id }, 'useTasks.softDeleteTasks')
          .catch((err) => logger.error('useTasks', 'Error deleting task', err));
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
  }, [items, forgetRow, unprotectRealId]);

  // Drop tasks from the shared list without touching the board — used to reverse
  // a carry-forward merge when the user undoes "move to current discussion".
  const removeTasks = useCallback((ids) => {
    const idSet = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
    setItems((current) => current.filter((i) => !idSet.has(String(i.id))));
  }, []);

  // Run (or RE-run, on retry) the background create for ONE optimistic row.
  // Extracted from createTask so a failed create can be retried against the SAME
  // temp row (same id → same React key → no flicker/dup/disappear).
  const runCreate = useCallback(async (tempId, name, o) => {
    const { status = null, assignee = [], deadline = null, topicId = null, viewers = [], editors = [] } = o || {};
    // Clear any prior error flag (retry path).
    setItems((prev) => prev.map((i) => (i.id === tempId ? { ...i, _createFailed: false } : i)));
    try {
      const b = new משימות1Board();
      // RESUME GUARD: on a retry where create_item already succeeded (only the
      // relation write failed), reuse the existing real id instead of creating a
      // second item — otherwise a link-step failure duplicates the task on the board.
      let realId = createdRealIdRef.current.get(tempId) || null;
      if (!realId) {
      // monday's create_item IGNORES board_relation values, so the discussion
      // (discussionLinkID) and topic (topicsLinkID) links are set AFTER creation via
      // change_multiple_column_values — the verified write path. Without this
      // the task is created but never linked, so it never shows in any tab.
      const data = { name, detailsID: 'נוצרה מדיון' };
      if (status != null) data.statusID = status; // status is a label id; 0 is valid
      // Stamp the parent discussion's type by label TEXT so the task is
      // discoverable in the "by discussion type" previous-tasks view. taskTypeID
      // is a DROPDOWN column, so the plain text is written (formatValue('dropdown')
      // -> { labels:[text] }) + create_labels_if_missing on the create below, so
      // the label is minted on the tasks board if absent (and reused if present).
      // Omitted when the discussion has no type; no-ops if taskTypeID is unmapped.
      if (taskTypeText) data.taskTypeID = taskTypeText;
      // Stamp the task creator with the current user (only on NEW tasks, mirrors
      // the taskTypeID stamping). Drives the task-tier "creator" role for the
      // board-permissions matrix. Skipped when taskCreatorID isn't mapped or no
      // user id is available (harmless no-op).
      if (currentUserId != null && getColumns('tasks')?.taskCreatorID?.id) {
        data.taskCreatorID = [Number(currentUserId)];
      }
      if (assignee.length) data.responsibilityID = assignee.map(p => Number(p.id));
      // Item 19 — access columns, auto-filled from the parent discussion:
      // participants → יכולת צפייה (viewers), single-person discussion roles →
      // יכולת עריכה (editors). Written only when the owner mapped the columns.
      if (viewers.length && getColumns('tasks')?.taskViewersID?.id) {
        data.taskViewersID = viewers.map((p) => Number(p?.id ?? p)).filter((n) => Number.isFinite(n));
      }
      if (editors.length && getColumns('tasks')?.taskEditorsID?.id) {
        data.taskEditorsID = editors.map((p) => Number(p?.id ?? p)).filter((n) => Number.isFinite(n));
      }
      if (deadline) data.deadlineID = `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}`;
      const created = await b.item().create(data, { createLabelsIfMissing: true }).execute();
      realId = created.id;
      // Remember it so a failure in the relation write below lets retry resume
      // here instead of re-creating (see createdRealIdRef).
      createdRealIdRef.current.set(tempId, realId);
      }
      const relations = { discussionLinkID: { linkedItems: [{ id: discussionId }] } };
      if (topicId) relations.topicsLinkID = { linkedItems: [{ id: topicId }] };
      await b.item(realId).update(relations).execute();
      // PROTECT the real id BEFORE any async flush below, so a CONCURRENT
      // create's fire-and-forget refresh() can never evict this just-created row
      // during the eventual-consistency window (this ordering is what makes
      // rapid multi-row creation stable — no vanish/reappear).
      protectRealId(realId);
      // RECONCILE: swap temp→real IN PLACE (the spread preserves any edits the
      // user applied while the row was still optimistic). IDEMPOTENT: if the temp
      // row is somehow gone (a race dropped it) and the real row isn't present
      // either, RE-ADD it — a freshly-created task must never vanish.
      setItems((prev) => {
        let swapped = false;
        const next = prev.map((i) => {
          if (i.id === tempId) { swapped = true; return { ...i, id: realId, _createFailed: false }; }
          return i;
        });
        if (!swapped && !next.some((i) => String(i.id) === String(realId))) {
          next.push({ id: realId, name, statusID: status, responsibilityID: assignee, deadlineID: deadline, _createFailed: false });
        }
        return next;
      });
      // FLUSH edits queued while the row had no real id, through the SAME update
      // mutations a committed row uses (last-write-wins per field). Awaited so the
      // silent refresh below reads the persisted values (never clobbers a flush).
      const edits = drainEdits(tempId);
      if (edits) {
        const f = flushersRef.current;
        const jobs = [];
        if ('name' in edits) jobs.push(f.updateTaskName(realId, edits.name));
        if ('statusID' in edits) jobs.push(f.updateTaskStatus(realId, edits.statusID));
        if ('priorityID' in edits) jobs.push(f.updateTaskPriority(realId, edits.priorityID));
        if ('responsibilityID' in edits) jobs.push(f.updateTaskAssignee(realId, edits.responsibilityID));
        if ('deadlineID' in edits) jobs.push(f.updateTaskDeadline(realId, edits.deadlineID));
        await Promise.allSettled(jobs);
      }
      forgetRow(tempId);
      createdRealIdRef.current.delete(tempId); // fully committed — drop the resume marker
      // Silent refresh so the Tasks tab and the Effectiveness tab (both read the
      // shared list) reflect the authoritative server state — fire-and-forget so
      // it doesn't delay the modal close or flash a loader. `.catch` belt-and-
      // suspenders: refresh() already swallows its own errors, but never let a
      // floating promise surface as an unhandled rejection (→ global handler).
      Promise.resolve(refresh()).catch(() => {});
      return { id: realId };
    } catch (err) {
      logger.error('useTasks', 'Error creating task', err);
      // Keep the row in a clear ERROR state (never silently drop it) so the user
      // can retry or dismiss it; the Hebrew error toast is raised via the logger
      // sink. Queued edits + create args are kept so a retry can still flush them.
      setItems(prev => prev.map(i => i.id === tempId ? { ...i, _createFailed: true } : i));
      return null;
    }
  }, [discussionId, taskTypeText, refresh, currentUserId, drainEdits, forgetRow, protectRealId]);

  // Create a task linked to this discussion, inserting an OPTIMISTIC row that
  // shows immediately AND is fully editable right away. `opts` may be a status
  // string (quick-add back-compat) or an object { status, assignee, deadline, topicId }.
  const createTask = useCallback((name, opts) => {
    // opts may be an options object, or a bare status value (a label id) for the
    // quick-add back-compat. A status id can be 0, so don't treat it as empty.
    const o = (opts && typeof opts === 'object') ? opts : (opts != null ? { status: opts } : {});
    const { status = null, assignee = [], deadline = null, prepend = false } = o;
    const tempId = nextTempId();
    stashCreateArgs(tempId, { name, o });
    // The optimistic row is APPENDED by default (bottom of its group). The top
    // blue "משימה חדשה" button passes { prepend:true } so its new task lands at
    // the TOP of the topmost group / list instead. `prepend` is a placement hint
    // only — runCreate ignores it, so it never reaches the board write.
    const optimisticRow = {
      id: tempId, name, responsibilityID: assignee, deadlineID: deadline, statusID: status,
    };
    setItems(prev => (prepend ? [optimisticRow, ...prev] : [...prev, optimisticRow]));
    return runCreate(tempId, name, o);
  }, [runCreate, stashCreateArgs]);

  // Retry a failed create against the same optimistic row (row error affordance).
  const retryCreate = useCallback((tempId) => {
    const args = getCreateArgs(tempId);
    if (!args) return null;
    return runCreate(tempId, args.name, args.o);
  }, [getCreateArgs, runCreate]);

  // Dismiss a failed optimistic row: it never reached the board, so just remove
  // it locally and drop its bookkeeping (no API call).
  const dismissRow = useCallback((tempId) => {
    forgetRow(tempId);
    setItems(prev => prev.filter(i => i.id !== tempId));
  }, [forgetRow]);

  // Merge already-known tasks (e.g. carried from the previous-discussion tab)
  // into the shared list, de-duping by id so a task already present isn't doubled.
  const mergeTasks = useCallback((incoming) => {
    setItems(prev => {
      const byId = new Map(prev.map(i => [String(i.id), i]));
      incoming.forEach(t => { const id = String(t.id); byId.set(id, { ...(byId.get(id) || {}), ...t, id }); });
      return Array.from(byId.values());
    });
  }, []);

  // Expose the latest per-field update fns to runCreate's flush step (read
  // lazily at flush time, so no stale closures and no createTask identity churn).
  flushersRef.current = {
    updateTaskName, updateTaskStatus, updateTaskPriority, updateTaskAssignee, updateTaskDeadline,
  };

  return {
    items,
    loading,
    updateTaskName,
    updateTaskStatus,
    updateTaskPriority,
    updateTaskAssignee,
    updateTaskDeadline,
    updateTasksStatusBatch,
    updateTasksAssigneeBatch,
    updateTasksDeadlineBatch,
    deleteTask,
    softDeleteTasks,
    removeTasks,
    createTask,
    retryCreate,
    dismissRow,
    mergeTasks,
    refresh,
  };
}
