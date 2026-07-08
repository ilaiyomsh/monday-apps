import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Skeleton, Button, Text, Dropdown } from '@vibe/core';
import { DropdownChevronDown, CloseSmall, Filter } from '@vibe/icons';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { GroupByBuilder, GROUP_STATUS_ORDERS, GROUP_AZ_ORDERS, sortGroupsByOrder } from '@generated/components/GroupByBuilder';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '@generated/components/MyTasksView/controls/Segment.jsx';
import { BuilderIcon } from '@generated/components/MyTasksView/controls/BuilderIcon.jsx';
import {
  filterTasks, filterCount, emptyFilter, serializeFilter, deserializeFilter,
  FILTER_COLUMNS, FILTER_COLUMN_PERSON, OP_LABEL, DEADLINE_RANGES,
} from '@generated/components/MyTasksView/controls/controls.js';
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import bs from '@generated/components/MyTasksView/controls/builder.module.css';
import { useViewport } from '@generated/hooks/useViewport.js';
import { api, parseValue, cvSelection, monday } from '../../utils/mondayApi/monday-client.js';
import { getColumns } from '../../utils/mondayApi/board-config-store.js';
import { משימות1Board, דיונים1Board } from '@api/BoardSDK.js';
import { TaskTable } from '@generated/components/TaskTable';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useDropdownOptions } from '@generated/hooks/useDropdownOptions';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { PREVIOUS_TASKS_MODES } from '@generated/utils/mondayApi/boards.config.js';
import { isValidStatus } from '@generated/constants/statusConfig';
import logger from '@generated/utils/logger.js';
import styles from './PreviousTasksTab.module.css';

// Column-name style options (nouns, no "לפי" prefix) + per-column order sets, so
// the builder matches the My Tasks Group module (English chrome, Hebrew column
// name in the segment, e.g. "דיון" / "Z → A").
const GROUP_OPTIONS = [
  { value: 'none', label: 'ללא קיבוץ' },
  { value: 'status', label: 'סטאטוס', icon: 'status', orders: GROUP_STATUS_ORDERS },
  { value: 'person', label: 'אחראי', icon: 'person', orders: GROUP_AZ_ORDERS },
];
// Group-by source discussion — only meaningful in the "by type" view (where
// tasks span multiple discussions), so it's appended to the options there only.
const GROUP_OPTION_DISCUSSION = { value: 'discussion', label: 'דיון מקור', icon: 'relation', orders: GROUP_AZ_ORDERS };
const NO_STATUS = '__none__';
const NO_ASSIGNEE = '__unassigned__';
const NO_DISCUSSION = '__nodiscussion__';
// Undo window for deferred deletion — matches the delete toast auto-hide.
const DELETE_GRACE_MS = 6000;

// Client-side Filter config for this tab (mirrors My Tasks' builder, but these
// tasks have NO priority column, and DO have a meaningful assignee column — so
// the columns are status + deadline + person). Reuses the shared controls.js
// engine (filterTasks/filterCount/emptyFilter) and BuilderControl UI.
const PREV_FILTER_COLUMNS = [
  FILTER_COLUMNS.find((c) => c.key === 'status'),
  FILTER_COLUMNS.find((c) => c.key === 'deadline'),
  FILTER_COLUMN_PERSON,
];
const PREV_TYPE_ICON = { status: 'status', date: 'date', person: 'person' };
const PREV_COL_NAME = { status: 'סטטוס', deadline: 'דד ליין', person: 'אחראי' };
const rangeLabel = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.label || 'Choose a date range';
const rangeIcon = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.icon || 'date';

// Map a linked task item (from the discussion-side relation query) into the
// app-facing task shape TaskTable/TaskTableRow render: { id, name, responsibilityID,
// deadlineID, statusID, ... } via parseValue using the configured tasks columns.
function mapTaskItems(linkedItems = [], taskColumns = {}) {
  return linkedItems.map((item) => {
    const byId = {};
    (item.column_values || []).forEach((cv) => { byId[cv.id] = cv; });

    const mapped = { id: String(item.id), name: item.name, created_at: item.created_at };
    Object.entries(taskColumns).forEach(([alias, col]) => {
      if (!col?.id) return;
      mapped[alias] = parseValue(col.type, byId[col.id]);
    });
    return mapped;
  });
}

export function PreviousTasksTab({ discussion, onCarryForward, onCarryForwardUndo, onNotify, onNotifyLoading, onDismissToast, canTask = () => true, canCreateTask = true, canEditDiscussion = true, canReorderColumns, canManageSettings = false }) {
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  // Load-time grouping/filter = the shared saved view (empty default otherwise);
  // in-session changes are local until someone with permission hits Save.
  const { view: savedView, canSave: canSaveView, saveView } = useSavedViews('previousTasks', { canManageSettings });
  const savedGroup = [...GROUP_OPTIONS, GROUP_OPTION_DISCUSSION].some((o) => o.value === savedView?.group?.col)
    ? savedView.group : null;
  const [groupBy, setGroupBy] = useState(savedGroup ? savedGroup.col : 'none');
  const [groupOrder, setGroupOrder] = useState(savedGroup?.order || 'labelAsc');
  const [collapsed, setCollapsed] = useState({});
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [carrying, setCarrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previousDiscussionID, setPreviousDiscussion] = useState({ id: null, name: null });
  // Resolve the previous-discussion link first; show a loader until we know
  // whether one exists (avoids flashing "no previous discussion" on every open).
  const [resolving, setResolving] = useState(true);
  // Picker for setting a previous discussion when none is defined.
  const [picking, setPicking] = useState(false);
  const [discussionOptions, setDiscussionOptions] = useState([]);
  const [savingPrev, setSavingPrev] = useState(false);
  const { colorById, labelById, orderById, options: statusOptions } = useStatusOptions();
  const { isMobile } = useViewport();
  // Show the read-only priority column only when the owner mapped priorityID.
  const showPriority = !!getColumns('tasks').priorityID?.id;

  // Mode: resolve previous tasks via the linked previous discussion (default) or
  // by the current discussion's TYPE (taskTypeID written on each task). Owner sets
  // this in Settings (settings.preferences.previousTasksMode).
  const { settings } = useSettings();
  const mode = settings?.preferences?.previousTasksMode || PREVIOUS_TASKS_MODES.LINKED_DISCUSSION;
  // Resolve by TYPE when the mode is DISCUSSION_TYPE (always) or AUTO *and* this
  // discussion actually has a type. In AUTO with no type we fall through to the
  // previous-discussion link path (byType=false) — so a single flag still drives
  // every downstream effect/branch below.
  const byType =
    mode === PREVIOUS_TASKS_MODES.DISCUSSION_TYPE
    || (mode === PREVIOUS_TASKS_MODES.AUTO && !!discussion?.discussionTypeID);
  // The discussion's "סוג" is a DROPDOWN value = the label TEXT directly. taskTypeID
  // is ALSO a dropdown on the tasks board; bridge the text -> its label id and
  // filter server-side (any_of by id — exact match, same as task creation writes).
  const { options: taskTypeOptions, loading: taskTypeLoading } = useDropdownOptions('tasks', 'taskTypeID');
  // True while the taskType map is still loading and the discussion HAS a type —
  // avoids briefly flashing "no tasks of this type" before resolution completes.
  const typeMapsLoading = byType && !!discussion?.discussionTypeID && taskTypeLoading;
  // { taskTypeId, label } for the current discussion's type; taskTypeId is the
  // TASKS-board label id to filter on (null when no type / no text match / unmapped).
  const [typeFilter, setTypeFilter] = useState({ taskTypeId: null, label: null });

  // Resolve the previous discussion via the TYPED board_relation field on the
  // current discussion (linked_items[0] — ONE back only, no recursion).
  useEffect(() => {
    let cancelled = false;

    async function resolvePreviousDiscussion() {
      setResolving(true);
      setPicking(false);
      setSelectedIds(new Set()); // a discussion switch clears any pending selection
      // By-type mode resolves via a separate effect (below) — don't touch the
      // previous-discussion link here.
      if (byType) { setResolving(false); return; }
      if (!discussion?.id) {
        setPreviousDiscussion({ id: null, name: null });
        setResolving(false);
        return;
      }

      const discussionsColumns = getColumns('discussions');
      const previousDiscussionColId = discussionsColumns?.previousDiscussionID?.id;
      if (!previousDiscussionColId) {
        setPreviousDiscussion({ id: null, name: null });
        setResolving(false);
        return;
      }

      try {
        const data = await api(
          `query ($discussionId: ID!, $relationCol: [String!]) {
            items(ids: [$discussionId]) {
              column_values(ids: $relationCol) { ${cvSelection(['board_relation'])} }
            }
          }`,
          { discussionId: String(discussion.id), relationCol: [previousDiscussionColId] },
          'PreviousTasksTab.resolvePreviousDiscussion'
        );

        const cv = data?.items?.[0]?.column_values?.[0];
        const relation = parseValue('board_relation', cv);
        const prev = relation?.linkedItems?.[0] || null;
        if (!cancelled) {
          setPreviousDiscussion({
            id: prev?.id ? String(prev.id) : null,
            name: prev?.name || relation?.text || null,
          });
        }
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to resolve previous discussion link', err);
        if (!cancelled) setPreviousDiscussion({ id: null, name: null });
      } finally {
        if (!cancelled) setResolving(false);
      }
    }

    resolvePreviousDiscussion();
    return () => { cancelled = true; };
  }, [discussion?.id, byType]);

  // By-type resolution: map the current discussion's "סוג" label -> the TASKS
  // board taskTypeID label id to filter on. Runs only in by-type mode; waits for
  // the status-option maps (loaded async) before resolving.
  useEffect(() => {
    if (!byType) { setTypeFilter({ taskTypeId: null, label: null }); return; }
    setSelectedIds(new Set());
    const text = discussion?.discussionTypeID || null;
    if (!text) { setTypeFilter({ taskTypeId: null, label: null }); return; }
    const match = (taskTypeOptions || []).find((o) => o.label === text);
    setTypeFilter({ taskTypeId: match ? match.id : null, label: text });
  }, [byType, discussion?.id, discussion?.discussionTypeID, taskTypeOptions]);

  // Load the discussions list (id + name) for the "set previous discussion"
  // picker, lazily on first use. Excludes the current discussion.
  useEffect(() => {
    if (!picking || discussionOptions.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await new דיונים1Board().items()
          .withColumns(['discussionDateID'])
          .orderBy({ column: 'discussionDateID', direction: 'desc' })
          .withPagination({ limit: 100 })
          .execute();
        const opts = (result.items || [])
          .filter((d) => String(d.id) !== String(discussion?.id))
          .map((d) => ({ value: String(d.id), label: d.name }));
        if (!cancelled) setDiscussionOptions(opts);
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to load discussions for picker', err);
      }
    })();
    return () => { cancelled = true; };
  }, [picking, discussionOptions.length, discussion?.id]);

  // Write the chosen previous-discussion link onto the current discussion, then
  // reflect it locally so the tasks load.
  const setPrevious = async (id, name) => {
    if (!id || !discussion?.id) return;
    try {
      setSavingPrev(true);
      await new דיונים1Board().item(discussion.id)
        .update({ previousDiscussionID: { linkedItems: [{ id }] } })
        .execute();
      setPreviousDiscussion({ id: String(id), name });
      setPicking(false);
    } catch (err) {
      logger.error('PreviousTasksTab', 'Failed to set previous discussion', err);
    } finally {
      setSavingPrev(false);
    }
  };

  const previousDiscussionId = previousDiscussionID?.id || null;
  const previousDiscussionLabel = previousDiscussionID?.name || null;

  // Fetch the previous discussion's tasks the SAME discussion-side way as
  // useTasks: read them off the discussion's tasksBoardLinkID relation column.
  useEffect(() => {
    if (byType) return; // by-type mode loads via its own effect below
    if (!previousDiscussionId) { setTasks([]); return; }
    let cancelled = false;

    async function load() {
      const discussionsColumns = getColumns('discussions');
      const tasksBoardLinkId = discussionsColumns?.tasksBoardLinkID?.id;
      const taskColumns = getColumns('tasks') || {};
      const RENDERED = ['responsibilityID', 'deadlineID', 'statusID', 'priorityID', 'discussionLinkID']; // assignee, deadline, status, priority (read-only), discussion links
      const taskCols = RENDERED.map((alias) => taskColumns?.[alias]?.id).filter(Boolean);
      const taskCv = cvSelection(RENDERED.map((alias) => taskColumns?.[alias]?.type));

      if (!tasksBoardLinkId) { setTasks([]); return; }

      try {
        setTasksLoading(true);
        const data = await api(
          `query ($discussionId: ID!, $relationCol: [String!], $taskCols: [String!]) {
            items(ids: [$discussionId]) {
              column_values(ids: $relationCol) {
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
            discussionId: String(previousDiscussionId),
            relationCol: [tasksBoardLinkId],
            taskCols,
          },
          'PreviousTasksTab.loadPreviousTasks'
        );

        const linkedTasks = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
        if (!cancelled) setTasks(mapTaskItems(linkedTasks, taskColumns));
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to load previous-discussion tasks', err);
        if (!cancelled) setTasks([]);
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [previousDiscussionId, byType]);

  // By-type tasks loader: server-side filter the TASKS board by taskTypeID =
  // the current discussion's mapped type label id (BoardSDK formats the status
  // any_of rule). Returns ALL tasks of that type across discussions.
  useEffect(() => {
    if (!byType) return;
    const taskTypeId = typeFilter.taskTypeId;
    if (taskTypeId == null) { setTasks([]); return; }
    let cancelled = false;

    async function load() {
      try {
        setTasksLoading(true);
        const result = await new משימות1Board().items()
          .where({ taskTypeID: taskTypeId })
          .withColumns(['responsibilityID', 'deadlineID', 'statusID', 'priorityID', 'discussionLinkID', 'taskTypeID'])
          .withPagination({ limit: 200 })
          .execute();
        if (!cancelled) setTasks(result.items || []);
      } catch (err) {
        logger.error('PreviousTasksTab', 'Failed to load tasks by discussion type', err);
        if (!cancelled) setTasks([]);
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [byType, typeFilter.taskTypeId]);

  // Updates go through BoardSDK (same as useTasks) so board_id + the column-value
  // formatting are handled in one place — change_multiple_column_values requires board_id.
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

  // Clicking a task's name opens ITS item card on the Updates pane — same
  // affordance as the My Tasks tab (kind: 'updates'). Opens the task, not the
  // source discussion (that's the separate "דיון מקור" chip).
  const openTaskCard = (taskId) => {
    if (!taskId) return;
    monday.execute('openItemCard', { itemId: Number(taskId), kind: 'updates' });
  };

  // ---- multi-select + carry-forward to the current ("next") discussion ----
  const toggleSelect = (id, checked) =>
    setSelectedIds(prev => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; });
  const clearSelection = () => setSelectedIds(new Set());
  const itemById = useMemo(() => {
    const m = new Map();
    tasks.forEach((t) => m.set(String(t.id), t));
    return m;
  }, [tasks]);
  // Per-task capability check (board permissions, Phase 4). Gates row editors and
  // filters batch/bulk targets to the tasks the user may actually edit. A mixed
  // selection applies ONLY to the allowed subset.
  const allow = useCallback(
    (cap, taskId) => canTask(cap, itemById.get(String(taskId))),
    [canTask, itemById]
  );
  const resolveTargetIds = (originTaskId, cap) => {
    const base = selectedIds.size > 1 && selectedIds.has(originTaskId) ? [...selectedIds] : [originTaskId];
    return cap ? base.filter((id) => allow(cap, id)) : base;
  };
  const applyStatusChange = async (taskId, status) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskStatus');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1) {
      await updateStatusBatch(targetIds, status);
      return;
    }
    for (const id of targetIds) await updateStatus(id, status);
  };
  // Priority has no batch endpoint; apply to each selected target sequentially.
  const applyPriorityChange = async (taskId, priority) => {
    for (const id of resolveTargetIds(taskId, 'editTaskPriority')) await updatePriority(id, priority);
  };
  const applyAssigneeChange = async (taskId, people) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskAssignee');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1) {
      await updateAssigneeBatch(targetIds, people);
      return;
    }
    for (const id of targetIds) await updateAssignee(id, people);
  };
  const applyDeadlineChange = async (taskId, date) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskDeadline');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1) {
      await updateDeadlineBatch(targetIds, date);
      return;
    }
    for (const id of targetIds) await updateDeadline(id, date);
  };

  // Carry the selected previous-discussion tasks forward into the current
  // discussion. board_relation writes REPLACE the whole linked set, so we send
  // the UNION of each task's existing discussion links + the current one — this
  // ADDS the current discussion while preserving the previous link. create_item
  // can't do this; change_multiple_column_values (via BoardSDK update) is the
  // verified write path on discussionLinkID (the writable side).
  const moveSelectedToNext = async () => {
    const currentId = String(discussion?.id || '');
    if (!currentId || selectedIds.size === 0) return;
    if (previousDiscussionId && String(previousDiscussionId) === currentId) {
      logger.warn('PreviousTasksTab', 'previous === current; skipping carry-forward');
      return;
    }
    setCarrying(true);
    // No loading notice here — this is an inline (non-modal) action, so the
    // in-button spinner (loading={carrying}) is the loading feedback. Loading
    // notices are reserved for modal-driven actions (e.g. task creation).
    const board = new משימות1Board();
    const ok = [];
    const changed = []; // tasks whose link we actually added — the undoable set
    for (const taskId of selectedIds) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) continue;
      const existing = (task.discussionLinkID?.ids || (task.discussionLinkID?.linkedItems || []).map(l => String(l.id)))
        .map(String)
        .filter(id => Number.isFinite(Number(id))); // NaN guard — never corrupt the set
      if (existing.includes(currentId)) { ok.push(task); continue; } // already linked → no-op
      const unionItems = [...new Set([...existing, currentId])].map(id => ({ id })); // UNION keeps the previous link
      try {
        await board.item(taskId).update({ discussionLinkID: { linkedItems: unionItems } }).execute();
        ok.push(task);
        changed.push({ id: taskId, prevLinked: existing }); // remember the pre-move link set for undo
      } catch (err) {
        logger.error('PreviousTasksTab', 'שגיאה בהעברת משימה לדיון הנוכחי', err);
      }
    }
    setCarrying(false);
    setSelectedIds(new Set());
    if (ok.length) {
      onCarryForward?.(ok.map(t => ({ id: t.id, name: t.name, responsibilityID: t.responsibilityID, deadlineID: t.deadlineID, statusID: t.statusID })));
      // Undo restores each moved task's link set to its pre-move value and drops
      // it from the current discussion's list. Only offered when we added links
      // (already-linked no-ops aren't reversible — they were linked before).
      const undoMove = async () => {
        const undoBoard = new משימות1Board();
        for (const { id, prevLinked } of changed) {
          try {
            await undoBoard.item(id).update({ discussionLinkID: { linkedItems: prevLinked.map(x => ({ id: x })) } }).execute();
          } catch (err) {
            logger.error('PreviousTasksTab', 'ביטול העברת המשימה נכשל', err);
          }
        }
        onCarryForwardUndo?.(changed.map(c => c.id));
      };
      const msg = ok.length === 1 ? `"${ok[0].name}" הועברה לדיון הנוכחי` : `${ok.length} משימות הועברו לדיון הנוכחי`;
      onNotify?.(msg, 'success', 6000, changed.length ? { label: 'בטל', onClick: undoMove } : null);
    }
  };

  // Only the selected tasks the user may delete (mixed selection → delete the
  // allowed subset).
  const deletableSelectedIds = useMemo(
    () => [...selectedIds].filter((id) => allow('deleteTask', id)),
    [selectedIds, allow]
  );
  // Selection is offered when the user can act on at least one loaded task
  // (edit any field, delete, or carry forward via createTask). While the feature
  // is off this equals the legacy creator/lead/owner gate.
  const PREV_EDIT_CAPS = ['editTaskStatus', 'editTaskPriority', 'editTaskDeadline', 'editTaskAssignee', 'deleteTask'];
  const canSelect = canCreateTask || tasks.some((t) => PREV_EDIT_CAPS.some((cap) => canTask(cap, t)));
  const deleteSelectedTasks = () => {
    if (deletableSelectedIds.length === 0) return;
    const ids = deletableSelectedIds;
    const removed = tasks.filter((t) => ids.includes(t.id)); // snapshot for restore
    setTasks((current) => current.filter((t) => !ids.includes(t.id)));
    setSelectedIds(new Set());

    // Deferred delete with an undo window — the real delete_item fires only
    // after the toast's "בטל" disappears (monday has no simple un-delete).
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      ids.forEach((id) => {
        api(
          `mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`,
          { itemId: id },
          'PreviousTasksTab.deleteSelectedTasks'
        ).catch((err) => logger.error('PreviousTasksTab', 'שגיאה במחיקת משימה', err));
      });
    }, DELETE_GRACE_MS);
    const undo = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      setTasks((current) => {
        const have = new Set(current.map((t) => String(t.id)));
        return [...current, ...removed.filter((t) => !have.has(String(t.id)))];
      });
    };

    const msg = ids.length === 1 ? 'המשימה נמחקה' : `${ids.length} משימות נמחקו`;
    onNotify?.(msg, 'info', DELETE_GRACE_MS, { label: 'בטל', onClick: undo });
  };

  // ---- Filter (client-side, over the loaded tasks; same engine as My Tasks) ----
  const [filter, setFilter] = useState(() => (savedView?.filter ? deserializeFilter(savedView.filter) : emptyFilter()));
  const [filterRows, setFilterRows] = useState(() => {
    // Empty default: no pre-seeded "Where" row — the panel offers "+ New filter".
    return Array.isArray(savedView?.filterRows)
      ? savedView.filterRows.filter((k) => PREV_FILTER_COLUMNS.some((c) => c.key === k))
      : [];
  });
  const resetCol = (col) => (col === 'deadline' ? { op: 'within', range: null, date: null } : { op: 'is', values: new Set() });
  const setFilterOp = (col, op) => setFilter((f) => ({ ...f, [col]: { ...f[col], op } }));
  const toggleFilterVal = (col, id) => setFilter((f) => {
    const next = new Set(f[col].values);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...f, [col]: { ...f[col], values: next } };
  });
  const setDeadlineRange = (range) => setFilter((f) => ({ ...f, deadline: { op: 'within', range, date: null } }));
  const setDeadlineDate = (date) => setFilter((f) => ({ ...f, deadline: { ...f.deadline, date } }));
  const addFilterRow = () => setFilterRows((rows) => {
    const next = PREV_FILTER_COLUMNS.map((c) => c.key).find((k) => !rows.includes(k));
    return next ? [...rows, next] : rows;
  });
  const removeFilterRow = (col) => {
    setFilterRows((rows) => rows.filter((k) => k !== col));
    setFilter((f) => ({ ...f, [col]: resetCol(col) }));
  };
  const retargetFilterRow = (fromCol, toCol) => {
    if (fromCol === toCol) return;
    setFilterRows((rows) => rows.map((k) => (k === fromCol ? toCol : k)));
    setFilter((f) => ({ ...f, [fromCol]: resetCol(fromCol), [toCol]: resetCol(toCol) }));
  };
  const clearFilter = () => { setFilter(emptyFilter()); setFilterRows([]); };
  const fc = filterCount(filter);

  // Assignee options = the distinct people present across the loaded tasks.
  const personOptions = useMemo(() => {
    const seen = new Map();
    (tasks || []).forEach((t) => (t.responsibilityID || []).forEach((p) => {
      if (p && p.id != null && !seen.has(String(p.id))) {
        seen.set(String(p.id), { id: String(p.id), label: p.name || String(p.id), color: null });
      }
    }));
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
  }, [tasks]);

  const filteredTasks = useMemo(() => filterTasks(tasks, filter), [tasks, filter]);

  // Groups carry { key, label, color, items } — status groups key by the stable
  // label id (string) and resolve label/color via useStatusOptions; person groups
  // key by name. (See TasksTab for the same shape.)
  const grouped = useMemo(() => {
    if (groupBy === 'status') {
      const groups = new Map();
      filteredTasks.forEach(t => {
        const id = isValidStatus(t.statusID) && labelById[t.statusID] != null ? t.statusID : null;
        const key = id == null ? NO_STATUS : String(id);
        if (!groups.has(key)) groups.set(key, { key, statusId: id, items: [] });
        groups.get(key).items.push(t);
      });
      const list = [...groups.values()].map(g => ({
        key: g.key,
        label: g.statusId == null ? 'ללא סטאטוס' : (labelById[g.statusId] ?? 'ללא סטאטוס'),
        color: g.statusId == null ? null : (colorById[g.statusId] || null),
        items: g.items,
      }));
      return sortGroupsByOrder(list, { order: groupOrder, orderById, noKey: NO_STATUS });
    }
    if (groupBy === 'person') {
      const groups = new Map();
      filteredTasks.forEach(t => {
        const key = (t.responsibilityID || []).map(p => String(p.id)).sort().join('|') || NO_ASSIGNEE;
        const label = (t.responsibilityID || []).map(p => p.name).join(', ') || 'לא הוקצה';
        if (!groups.has(key)) groups.set(key, { key, label: key, color: null, items: [] });
        groups.get(key).label = label;
        groups.get(key).items.push(t);
      });
      return sortGroupsByOrder([...groups.values()], { order: groupOrder, noKey: NO_ASSIGNEE });
    }
    if (groupBy === 'discussion') {
      // Group by the task's source discussion(s) (discussionLinkID). A task can
      // link to more than one — key by the sorted id set, label by names.
      const groups = new Map();
      filteredTasks.forEach(t => {
        const linked = t.discussionLinkID?.linkedItems || [];
        const key = linked.map(d => String(d.id)).sort().join('|') || NO_DISCUSSION;
        const label = linked.map(d => d.name || d.id).join(', ') || 'ללא דיון מקור';
        if (!groups.has(key)) groups.set(key, { key, label: key, color: null, items: [] });
        groups.get(key).label = label;
        groups.get(key).items.push(t);
      });
      return sortGroupsByOrder([...groups.values()], { order: groupOrder, noKey: NO_DISCUSSION });
    }
    return [{ key: '__all__', label: '', color: null, items: filteredTasks }];
  }, [filteredTasks, groupBy, groupOrder, labelById, colorById, orderById]);

  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed[g.key]);
  const toggleAll = () => {
    if (allCollapsed) setCollapsed({});
    else { const c = {}; grouped.forEach((g) => { c[g.key] = true; }); setCollapsed(c); }
  };

  const groupOptions = byType ? [...GROUP_OPTIONS, GROUP_OPTION_DISCUSSION] : GROUP_OPTIONS;

  // ---------- Filter panel body (mirrors My Tasks; status + deadline + person) ----------
  const field = (mobile, label, seg) => (mobile
    ? <div className={bs.bField} key={label}><div className={bs.bFieldLabel}>{label}</div>{seg}</div>
    : seg);
  const valueChips = (col) => {
    const opts = col === 'person' ? personOptions : statusOptions;
    return (opts || []).filter((o) => filter[col].values.has(String(o.id))).map((o) => ({ color: o.color, text: o.label }));
  };
  const renderFilterRow = (col, i, mobile, openId, setOpenId) => {
    const fcfg = PREV_FILTER_COLUMNS.find((c) => c.key === col);
    const colSeg = (
      <Segment id={`fcol-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={PREV_TYPE_ICON[fcfg.type]} text={PREV_COL_NAME[col]}
        options={PREV_FILTER_COLUMNS.map((c) => ({
          key: c.key, label: PREV_COL_NAME[c.key], icon: PREV_TYPE_ICON[c.type],
          selected: c.key === col, disabled: c.key !== col && filterRows.includes(c.key),
        }))}
        onPick={(to) => retargetFilterRow(col, to)} />
    );
    const opSeg = (
      <Segment id={`fop-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Condition"
        text={OP_LABEL[filter[col].op]}
        options={fcfg.ops.map((op) => ({ key: op, label: OP_LABEL[op], selected: filter[col].op === op }))}
        onPick={(op) => setFilterOp(col, op)} />
    );
    let valueCtl = null;
    if (col === 'deadline') {
      const f = filter.deadline;
      if (f.op === 'within') {
        valueCtl = (
          <Segment id="fval-deadline" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="When"
            icon={f.range ? rangeIcon(f.range) : 'date'} text={f.range ? rangeLabel(f.range) : 'Choose a date range'} placeholder={!f.range}
            options={DEADLINE_RANGES.map((r) => ({ key: r.key, label: r.label, icon: r.icon, selected: f.range === r.key }))}
            onPick={setDeadlineRange} />
        );
      } else {
        valueCtl = (
          <div className={mobile ? bs.bDateWrapFull : bs.bDateWrap}>
            <DatePickerPopover value={f.date || null} onChange={setDeadlineDate} />
          </div>
        );
      }
    } else {
      const opts = col === 'person' ? personOptions : statusOptions;
      valueCtl = (
        <Segment id={`fval-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle={PREV_COL_NAME[col]} multi
          chips={valueChips(col)}
          options={(opts || []).map((o) => ({ key: String(o.id), label: o.label, dot: o.color, selected: filter[col].values.has(String(o.id)) }))}
          onPick={(id) => toggleFilterVal(col, id)} />
      );
    }
    const lead = i === 0 ? 'Where' : 'And';
    const removeBtn = (
      <button type="button" className={bs.bIconBtn} onClick={() => removeFilterRow(col)} aria-label="Remove filter">
        <BuilderIcon name="x" size={16} />
      </button>
    );
    if (mobile) {
      return (
        <div className={bs.bWhere} style={{ display: 'block' }} key={col}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className={bs.bWhereLead}>{lead}</span>
            {removeBtn}
          </div>
          {field(true, 'Column', colSeg)}
          {field(true, 'Condition', opSeg)}
          {valueCtl ? field(true, 'Value', valueCtl) : null}
        </div>
      );
    }
    return (
      <div className={bs.bWhere} key={col}>
        <span className={bs.bWhereLead}>{lead}</span>
        {colSeg}{opSeg}{valueCtl}{removeBtn}
      </div>
    );
  };
  const renderFilterBody = ({ mobile, openId, setOpenId }) => (
    <>
      {filterRows.map((col, i) => renderFilterRow(col, i, mobile, openId, setOpenId))}
      {filterRows.length === 0 ? <div className={bs.bEmpty}>No filters — showing all tasks</div> : null}
      {filterRows.length < PREV_FILTER_COLUMNS.length
        ? <button type="button" className={bs.bAddLink} onClick={addFilterRow}>+ New filter</button>
        : null}
    </>
  );

  // Loader-first: until the previous-discussion link (or the by-type bridge
  // maps) are resolved, don't render anything definitive (avoids flashing a
  // "nothing here" message before resolution completes).
  if (resolving || typeMapsLoading) {
    return (
      <div className={styles.root}>
        <div className={styles.skeletonStack}>
          {[1, 2, 3].map((i) => <Skeleton key={i} type={"rectangle"} height={36} fullWidth />)}
        </div>
      </div>
    );
  }

  // By-type mode with no resolvable type → explain why (no type set on the
  // discussion, or no matching label on the tasks taskTypeID column / unmapped).
  if (byType && !typeFilter.taskTypeId) {
    return (
      <div className={styles.root}>
        <div className={styles.noPrevious}>
          <Text type={"text2"} color={"secondary"}>
            {!discussion?.discussionTypeID
              ? 'לא הוגדר סוג לדיון זה'
              : 'לא נמצאו משימות מסוג דיון זה'}
          </Text>
        </div>
      </div>
    );
  }

  // No previous discussion defined → centered message + a picker to set one.
  if (!byType && !previousDiscussionId) {
    return (
      <div className={styles.root}>
        <div className={styles.noPrevious}>
          <Text type={"text2"} color={"secondary"}>לא הוגדר דיון קודם</Text>
          {canEditDiscussion && (picking ? (
            <div className={styles.prevPicker}>
              <Dropdown
                options={discussionOptions}
                onChange={(opt) => opt && setPrevious(opt.value, opt.label)}
                placeholder="בחר דיון קודם"
                size="small"
                disabled={savingPrev}
                clearable={false}
                insideOverflowContainer
              />
            </div>
          ) : (
            <Button kind={"secondary"} size={"small"} onClick={() => setPicking(true)}>
              בחר דיון קודם
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {/* One left-aligned cluster (like My Tasks): the discussion-type/source chip, then filter + group-by + collapse-all. */}
        <div className={styles.prevChip} dir="rtl">
          <span className={styles.prevChipLabel}>{byType ? 'סוג דיון' : 'דיון קודם'}</span>
          <span className={styles.prevChipName}>{byType ? typeFilter.label : previousDiscussionLabel}</span>
        </div>
        <div className={styles.toolbarActions} dir="ltr">
          <BuilderControl
            icon={Filter} label="Filter" title="Filter by" mobile={isMobile} width={isMobile ? undefined : 620}
            applied={fc > 0} badge={fc}
            onClear={fc > 0 ? clearFilter : null}
            onSave={canSaveView ? () => {
              saveView({ filter: serializeFilter(filter), filterRows });
              onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
            } : null}
            renderBody={renderFilterBody}
          />
          <GroupByBuilder
            options={groupOptions}
            value={{ col: groupBy, order: groupOrder }}
            noneValue="none"
            mobile={isMobile}
            onChange={(g) => { setGroupBy(g.col ?? 'none'); if (g.order) setGroupOrder(g.order); setCollapsed({}); }}
            onSave={canSaveView ? () => {
              saveView({ group: { col: groupBy, order: groupOrder } });
              onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
            } : null}
          />
          {groupBy !== 'none' && filteredTasks.length > 0 && (
            <CollapseAllButton collapsed={allCollapsed} onClick={toggleAll} />
          )}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className={styles.actionBar} role="region" aria-label="פעולות על משימות נבחרות">
          <div className={styles.actionBarLeft}>
            <Text type={"text2"} element="span">{selectedIds.size} נבחרו</Text>
          </div>
          <div className={styles.actionBarCenter}>
            {/* "Move to next discussion" carries tasks forward along the
                discussion-to-discussion link — meaningless in by-type mode,
                where there is no "next" discussion, so hide it there. */}
            {!byType && canCreateTask && (
              <Button kind={"primary"} size={"small"} loading={carrying} disabled={carrying || deleting} onClick={moveSelectedToNext}>
                העבר לדיון הבא
              </Button>
            )}
            <Button kind={"secondary"} size={"small"} loading={deleting} disabled={carrying || deleting || deletableSelectedIds.length === 0} onClick={deleteSelectedTasks}>
              מחיקה
            </Button>
          </div>
          <div className={styles.actionBarRight}>
            <button type="button" className={styles.closeSelectionBtn} onClick={clearSelection} aria-label="בטל בחירה">
              <CloseSmall size={18} />
            </button>
          </div>
        </div>
      )}

      {tasksLoading ? (
        <div className={styles.skeletonStack}>
          {[1,2,3].map(i => <Skeleton key={i} type={"rectangle"} height={36} fullWidth />)}
        </div>
      ) : tasks.length === 0 ? (
        <div className={styles.emptyState}>
          <Text type={"text2"} color={"secondary"}>
            {byType ? 'לא נמצאו הנחיות מסוג דיון זה' : 'לא נמצאו הנחיות בדיון הקודם'}
          </Text>
        </div>
      ) : (
        <div className={styles.board}>
        <div className={styles.groupScrollInner}>
        <div className={styles.groupStack}>
          {grouped.map((grp) => {
            const groupColor = grp.color;
            const groupSelectedCount = grp.items.reduce((count, task) => count + (selectedIds.has(task.id) ? 1 : 0), 0);
            const groupAllSelected = grp.items.length > 0 && groupSelectedCount === grp.items.length;
            const groupSomeSelected = groupSelectedCount > 0 && !groupAllSelected;
            return (
            <div key={grp.key}>
              {groupBy !== 'none' && grp.label && (
                <button type="button" onClick={() => setCollapsed(p => ({ ...p, [grp.key]: !p[grp.key] }))}
                  className={styles.groupHeader}>
                  <DropdownChevronDown
                    className={`${styles.groupChevron} ${collapsed[grp.key] ? styles.groupChevronCollapsed : ''}`}
                    style={groupColor ? { color: groupColor } : undefined}
                  />
                  <span className={styles.groupTitle} style={groupColor ? { color: groupColor } : undefined}>{grp.label}</span>
                </button>
              )}
              {!collapsed[grp.key] && (
                <TaskTable tasks={grp.items} color={groupColor}
                  showSourceDiscussion={byType}
                  showPriority={showPriority}
                  canReorderColumns={canReorderColumns}
                  canManageSettings={canManageSettings}
                  reorderScope={discussion?.id ? `previous_${discussion.id}_${byType ? `type:${typeFilter.taskTypeId}` : `prev:${previousDiscussionId}`}_${groupBy}_${grp.key}` : null}
                  canReorderRows={canCreateTask || canSelect}
                  onOpenCard={openTaskCard}
                  canTask={canTask}
                  onStatusChange={applyStatusChange}
                  onPriorityChange={applyPriorityChange}
                  onAssigneeChange={applyAssigneeChange}
                  onDeadlineChange={applyDeadlineChange}
                  selectable={canSelect} selectedIds={selectedIds} onToggleSelect={toggleSelect}
                  selectAllChecked={groupAllSelected}
                  selectAllIndeterminate={groupSomeSelected}
                  onToggleSelectAll={(checked) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      grp.items.forEach((task) => {
                        if (checked) next.add(task.id);
                        else next.delete(task.id);
                      });
                      return next;
                    });
                  }} />
              )}
            </div>
            );
          })}
        </div>
        </div>
        </div>
      )}
    </div>
  );
}

export default PreviousTasksTab;
