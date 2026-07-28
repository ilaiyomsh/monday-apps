import { משימות1Board } from '@api/BoardSDK.js';
import logger from '@generated/utils/logger.js';

/*
 * Optimistic task updaters for the Previous-Tasks tab (round146 split — moved
 * verbatim out of PreviousTasksTab.jsx). Each handler applies the change to the
 * local list first, writes via BoardSDK (board_id + column-value formatting are
 * handled in one place), and reverts on error; the batch variants revert only
 * the ids whose write failed. `setTasks` is the tab's task-list state setter.
 */
export function createTaskUpdaters(setTasks) {
  // Updates go through BoardSDK (same as useTasks) so board_id + the column-value
  // formatting are handled in one place — change_multiple_column_values requires board_id.
  // Optimistic inline rename (mirrors updateStatus). Writes the item name via
  // BoardSDK's { name } key; reverts on error. Per-task permission gating is
  // applied by TaskTable (onRenameTask is withheld when canTask('editTaskName')
  // is false for that row).
  const updateName = async (id, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (t.id === id ? { ...t, name: trimmed } : t));
    });
    try { await new משימות1Board().item(id).update({ name: trimmed }).execute(); }
    catch (err) { logger.error('PreviousTasksTab', 'שגיאה בעדכון משימה', err); setTasks(prev); }
  };
  const updateStatus = async (id, s) => {
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (t.id === id ? { ...t, statusID: s } : t));
    });
    try { await new משימות1Board().item(id).update({ statusID: s }).execute(); }
    catch (err) { logger.error('PreviousTasksTab', 'שגיאה בעדכון משימה', err); setTasks(prev); }
  };
  const updatePriority = async (id, s) => {
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (t.id === id ? { ...t, priorityID: s } : t));
    });
    try { await new משימות1Board().item(id).update({ priorityID: s }).execute(); }
    catch (err) { logger.error('PreviousTasksTab', 'שגיאה בעדכון משימה', err); setTasks(prev); }
  };
  const updateAssignee = async (id, p) => {
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (t.id === id ? { ...t, responsibilityID: p } : t));
    });
    try { await new משימות1Board().item(id).update({ responsibilityID: p.map(x => Number(x.id)) }).execute(); }
    catch (err) { logger.error('PreviousTasksTab', 'שגיאה בעדכון משימה', err); setTasks(prev); }
  };
  // round306 — שותפים (partnersID): same optimistic shape as updateAssignee.
  const updatePartners = async (id, p) => {
    const next = Array.isArray(p) ? p : [];
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (t.id === id ? { ...t, partnersID: next } : t));
    });
    try { await new משימות1Board().item(id).update({ partnersID: next.map((x) => Number(x.id)) }).execute(); }
    catch (err) { logger.error('PreviousTasksTab', 'שגיאה בעדכון שותפים', err); setTasks(prev); }
  };
  const updateDeadline = async (id, d) => {
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (t.id === id ? { ...t, deadlineID: d } : t));
    });
    try {
      const f = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
      await new משימות1Board().item(id).update({ deadlineID: f }).execute();
    } catch (err) { logger.error('PreviousTasksTab', 'שגיאה בעדכון משימה', err); setTasks(prev); }
  };

  const updateStatusBatch = async (taskIds, status) => {
    const ids = [...new Set((taskIds || []).map((id) => String(id)).filter(Boolean))];
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (idsSet.has(String(t.id)) ? { ...t, statusID: status } : t));
    });
    try {
      const board = new משימות1Board();
      const results = await Promise.allSettled(ids.map((id) => board.item(id).update({ statusID: status }).execute()));
      const failedIds = ids.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('PreviousTasksTab', 'Batch status update partially failed', { failedIds, total: ids.length });
      const prevById = new Map(prev.map((t) => [String(t.id), t]));
      const failedSet = new Set(failedIds);
      setTasks((current) => current.map((t) => (failedSet.has(String(t.id)) ? (prevById.get(String(t.id)) || t) : t)));
    } catch (err) {
      logger.error('PreviousTasksTab', 'Batch status update failed', err);
      setTasks(prev);
    }
  };

  const updateAssigneeBatch = async (taskIds, people) => {
    const ids = [...new Set((taskIds || []).map((id) => String(id)).filter(Boolean))];
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (idsSet.has(String(t.id)) ? { ...t, responsibilityID: people } : t));
    });
    try {
      const board = new משימות1Board();
      const peopleIds = (people || []).map((p) => Number(p.id));
      const results = await Promise.allSettled(ids.map((id) => board.item(id).update({ responsibilityID: peopleIds }).execute()));
      const failedIds = ids.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('PreviousTasksTab', 'Batch assignee update partially failed', { failedIds, total: ids.length });
      const prevById = new Map(prev.map((t) => [String(t.id), t]));
      const failedSet = new Set(failedIds);
      setTasks((current) => current.map((t) => (failedSet.has(String(t.id)) ? (prevById.get(String(t.id)) || t) : t)));
    } catch (err) {
      logger.error('PreviousTasksTab', 'Batch assignee update failed', err);
      setTasks(prev);
    }
  };

  const updateDeadlineBatch = async (taskIds, date) => {
    const ids = [...new Set((taskIds || []).map((id) => String(id)).filter(Boolean))];
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    let prev = [];
    setTasks((current) => {
      prev = current;
      return current.map((t) => (idsSet.has(String(t.id)) ? { ...t, deadlineID: date } : t));
    });
    try {
      const board = new משימות1Board();
      const formatted = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : null;
      const results = await Promise.allSettled(ids.map((id) => board.item(id).update({ deadlineID: formatted }).execute()));
      const failedIds = ids.filter((id, idx) => results[idx].status === 'rejected');
      if (failedIds.length === 0) return;
      logger.error('PreviousTasksTab', 'Batch deadline update partially failed', { failedIds, total: ids.length });
      const prevById = new Map(prev.map((t) => [String(t.id), t]));
      const failedSet = new Set(failedIds);
      setTasks((current) => current.map((t) => (failedSet.has(String(t.id)) ? (prevById.get(String(t.id)) || t) : t)));
    } catch (err) {
      logger.error('PreviousTasksTab', 'Batch deadline update failed', err);
      setTasks(prev);
    }
  };

  return {
    updateName, updateStatus, updatePriority, updateAssignee, updatePartners, updateDeadline,
    updateStatusBatch, updateAssigneeBatch, updateDeadlineBatch,
  };
}
