import { useState, useEffect, useCallback, useContext } from 'react';
import { משימות1Board } from '@api/BoardSDK.js';
import { api, parseValue, cvSelection } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { MondayContext } from '@generated/contexts/MondayContext.jsx';
import logger from '../utils/logger';

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
  const taskCols = RENDERED.map((alias) => taskColumns?.[alias]?.id).filter(Boolean);
  const taskCv = cvSelection(RENDERED.map((alias) => taskColumns?.[alias]?.type));

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
      setItems(fetchedItems);
    } catch (err) {
      logger.error('useTasks', 'Error refreshing tasks', { discussionId, err });
    }
  }, [discussionId]);

  const updateTaskName = async (taskId, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === taskId ? { ...i, name: trimmed } : i));
    });
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
    try {
      const b = new משימות1Board();
      const results = await Promise.allSettled(ids.map((id) => b.item(id).update({ statusID: status }).execute()));
      const failedIds = ids.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('useTasks', 'Batch status update partially failed', { failedIds, total: ids.length });
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
    try {
      const b = new משימות1Board();
      const peopleIds = (people || []).map((p) => Number(p.id));
      const results = await Promise.allSettled(ids.map((id) => b.item(id).update({ responsibilityID: peopleIds }).execute()));
      const failedIds = ids.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('useTasks', 'Batch assignee update partially failed', { failedIds, total: ids.length });
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
    try {
      const b = new משימות1Board();
      const formatted = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : null;
      const results = await Promise.allSettled(ids.map((id) => b.item(id).update({ deadlineID: formatted }).execute()));
      const failedIds = ids.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('useTasks', 'Batch deadline update partially failed', { failedIds, total: ids.length });
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
    const prev = [...items];
    setItems((current) => current.filter((i) => i.id !== taskId));
    try {
      await api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: taskId }, 'useTasks.deleteTask');
      return true;
    } catch (err) {
      logger.error('useTasks', 'Error deleting task', err);
      setItems(prev);
      return false;
    }
  }, [items]);

  // Deferred ("soft") delete with an undo window: the rows vanish from the UI
  // immediately, but the real delete_item fires only after DELETE_GRACE_MS — so
  // the returned `undo()` (wired to the toast's "בטל" button) can cancel the
  // pending delete and restore the rows. monday has no simple un-delete, so
  // deferring is the only way to offer a true undo.
  const softDeleteTasks = useCallback((ids) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!idList.length) return { undo: () => {}, count: 0 };
    const idSet = new Set(idList.map(String));
    const removed = items.filter((i) => idSet.has(String(i.id))); // snapshot for restore
    setItems((current) => current.filter((i) => !idSet.has(String(i.id))));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      idList.forEach((id) => {
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
  }, [items]);

  // Drop tasks from the shared list without touching the board — used to reverse
  // a carry-forward merge when the user undoes "move to current discussion".
  const removeTasks = useCallback((ids) => {
    const idSet = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
    setItems((current) => current.filter((i) => !idSet.has(String(i.id))));
  }, []);

  // Create a task linked to this discussion and add it to the shared list
  // optimistically, so it shows immediately in the Tasks tab. `opts` may be a
  // status string (back-compat with the Tasks-tab quick-add) or an object:
  //   { status, assignee: people[], deadline: Date, topicId } — the latter is
  // used when creating a task from a topic point (links to the topic too).
  const createTask = useCallback(async (name, opts) => {
    // opts may be an options object, or a bare status value (a label id) for the
    // quick-add back-compat. A status id can be 0, so don't treat it as empty.
    const o = (opts && typeof opts === 'object') ? opts : (opts != null ? { status: opts } : {});
    const { status = null, assignee = [], deadline = null, topicId = null } = o;
    const tempId = `temp-${Date.now()}`;
    setItems(prev => [...prev, {
      id: tempId, name, responsibilityID: assignee, deadlineID: deadline,
      statusID: status,
    }]);
    try {
      const b = new משימות1Board();
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
      if (deadline) data.deadlineID = `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}`;
      const created = await b.item().create(data, { createLabelsIfMissing: true }).execute();
      const realId = created.id;
      const relations = { discussionLinkID: { linkedItems: [{ id: discussionId }] } };
      if (topicId) relations.topicsLinkID = { linkedItems: [{ id: topicId }] };
      await b.item(realId).update(relations).execute();
      setItems(prev => prev.map(i => i.id === tempId ? { ...i, id: realId } : i));
      // Silent refresh so the Tasks tab and the Effectiveness tab (both read the
      // shared list) reflect the authoritative server state — fire-and-forget so
      // it doesn't delay the modal close or flash a loader.
      refresh();
      return { id: realId };
    } catch (err) {
      logger.error('useTasks', 'Error creating task', err);
      setItems(prev => prev.filter(i => i.id !== tempId));
      return null;
    }
  }, [discussionId, taskTypeText, refresh, currentUserId]);

  // Merge already-known tasks (e.g. carried from the previous-discussion tab)
  // into the shared list, de-duping by id so a task already present isn't doubled.
  const mergeTasks = useCallback((incoming) => {
    setItems(prev => {
      const byId = new Map(prev.map(i => [String(i.id), i]));
      incoming.forEach(t => { const id = String(t.id); byId.set(id, { ...(byId.get(id) || {}), ...t, id }); });
      return Array.from(byId.values());
    });
  }, []);

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
    mergeTasks,
    refresh,
  };
}
