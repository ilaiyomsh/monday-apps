import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Button, Text, Dropdown } from '@vibe/core';
import { DropdownChevronDown, Filter } from '@vibe/icons';
import { SelectionActionBar } from '@generated/components/SelectionActionBar';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { GroupByBuilder, GROUP_STATUS_ORDERS, GROUP_AZ_ORDERS, sortGroupsByOrder } from '@generated/components/GroupByBuilder';
import { EmptyState } from '@generated/components/EmptyState';
// Varied stable group-title colors (owner request 2026-07-14) — shared engine.
import { ensureGroupColors, groupTabTasks } from '@generated/components/MyTasksView/grouping.js';
import { useGroupColors } from '@generated/hooks/useGroupColors.jsx';
import { SortByBuilder, SORT_STATUS_DIRS, SORT_DATE_DIRS, SORT_TEXT_DIRS } from '@generated/components/SortByBuilder';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { SearchPill, matchesSearch } from '@generated/components/SearchPill';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '@generated/components/MyTasksView/controls/Segment.jsx';
import { BuilderIcon } from '@generated/components/MyTasksView/controls/BuilderIcon.jsx';
import { HideColumnsControl } from '@generated/components/MyTasksView/controls/HideColumnsControl.jsx';
import { customEntriesFor, customColumnIcon } from '@generated/utils/customColumns.js';
import {
  filterTasks, filterCount, serializeFilter, sortTasks,
  FILTER_COLUMNS, FILTER_COLUMN_PERSON, OP_LABEL, DEADLINE_RANGES,
  customFilterDims, customComparableValues,
} from '@generated/components/MyTasksView/controls/controls.js';
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import { useEscToClearSelection } from '@generated/hooks/useEscToClearSelection.js';
import { useStableHandler } from '@generated/hooks/useStableHandler.js';
import { useBatchTargets } from '@generated/hooks/useBatchTargets.js';
import { useFilterBuilder } from '@generated/hooks/useFilterBuilder.js';
import bs from '@generated/components/MyTasksView/controls/builder.module.css';
import { useViewport } from '@generated/hooks/useViewport.js';
import { api } from '../../utils/mondayApi/monday-client.js';
import { openOrToggleItemCard } from '@generated/utils/itemCard.js';
import { getColumns } from '../../utils/mondayApi/board-config-store.js';
import { משימות1Board } from '@api/BoardSDK.js';
import { TaskTable } from '@generated/components/TaskTable';
import { PreviousTasksSkeleton } from '@generated/components/PreviousTasksSkeleton';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { isValidStatus } from '@generated/constants/statusConfig';
import { usePreviousDecisions } from './usePreviousDecisions.js';
import { PreviousDecisionsTable } from './PreviousDecisionsTable.jsx';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { PREVIOUS_TASKS_MODES, resolvePreference } from '@generated/utils/mondayApi/boards.config.js';
// Quick-filter status battery (round 81) — shared buckets + presentation chip.
import { TaskStatusBattery } from '@generated/components/TaskStatusBattery';
import battery from '@generated/components/TaskStatusBattery/TaskStatusBattery.module.css';
import { countBuckets, taskInBucket } from '@generated/components/TaskStatusBattery/taskBuckets.js';
import { resolveDoneStatusIds, startOfToday } from '@generated/components/EffectivenessTab/effectiveness.js';
import logger from '@generated/utils/logger.js';
import { usePreviousTasksData } from './usePreviousTasksData.js';
import { createTaskUpdaters } from './taskUpdaters.js';
import styles from './PreviousTasksTab.module.css';

// Column-name style options (nouns, no "לפי" prefix) + per-column order sets, so
// the builder matches the My Tasks Group module (English chrome, Hebrew column
// name in the segment, e.g. "דיון" / "Z → A").
const GROUP_OPTIONS = [
  { value: 'none', label: 'ללא קיבוץ' },
  { value: 'status', label: 'סטאטוס', icon: 'status', orders: GROUP_STATUS_ORDERS },
  { value: 'person', label: 'אחראי', icon: 'person', orders: GROUP_AZ_ORDERS },
];
// Sort columns for this tab (mirrors the filter columns: status + deadline +
// name). `value` is a sortTasks() column key; direction sets are the shared My
// Tasks sort config so labels/icons/keys match everywhere.
const SORT_OPTIONS = [
  { value: 'status', label: 'סטטוס', icon: 'status', dirs: SORT_STATUS_DIRS },
  { value: 'deadline', label: 'דד ליין', icon: 'date', dirs: SORT_DATE_DIRS, note: 'Tasks with no deadline always sort last' },
  { value: 'name', label: 'שם', icon: 'text', dirs: SORT_TEXT_DIRS },
];
const firstSortDir = (col) => (SORT_OPTIONS.find((o) => o.value === col) || SORT_OPTIONS[0])?.dirs?.[0]?.key;
// Group-by source discussion — only meaningful in the "by type" view (where
// tasks span multiple discussions), so it's appended to the options there only.
const GROUP_OPTION_DISCUSSION = { value: 'discussion', label: 'דיון מקור', icon: 'relation', orders: GROUP_AZ_ORDERS };
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
const rangeLabel = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.label || 'בחרו טווח תאריכים';
const rangeIcon = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.icon || 'date';

// ---- Previous-discussions DECISIONS view config (round280) ----------------
// Mirrors DecisionsTab's decisions controls verbatim so the "דיונים קודמים →
// החלטות" view gets the SAME Search / Filter / Sort / Group-by / Collapse
// toolbar as the in-discussion decisions tab (and the personal "ההחלטות שלי").
// Group by: none / סטאטוס (decisionStatusID) / מחליט (decider person).
const DEC_GROUP_OPTIONS = [
  { value: 'none', label: 'ללא קיבוץ' },
  { value: 'status', label: 'סטאטוס', icon: 'status', orders: GROUP_STATUS_ORDERS },
  { value: 'decider', label: 'מחליט', icon: 'person', orders: GROUP_AZ_ORDERS },
];
// Sort: החלטה (name) / סטאטוס / תאריך. `value` keys map to sortTasks(); a
// decision is mapped to the { name, statusID, deadlineID } shape before sorting.
const DEC_SORT_OPTIONS = [
  { value: 'name', label: 'החלטה', icon: 'text', dirs: SORT_TEXT_DIRS },
  { value: 'status', label: 'סטאטוס', icon: 'status', dirs: SORT_STATUS_DIRS },
  { value: 'deadline', label: 'תאריך', icon: 'date', dirs: SORT_DATE_DIRS },
];
const firstDecSortDir = (col) => (DEC_SORT_OPTIONS.find((o) => o.value === col) || DEC_SORT_OPTIONS[0])?.dirs?.[0]?.key;
const DEC_NO_STATUS = '__none__';
const DEC_NO_DECIDER = '__nodecider__';
// Filter columns: status + date + decider (person). Reuses the shared
// controls.js engine (which reads statusID / responsibilityID / deadlineID) via
// a filterView that maps each decision to that shape (see decFilterView below).
const DEC_FILTER_COLUMNS = [
  FILTER_COLUMNS.find((c) => c.key === 'status'),
  FILTER_COLUMNS.find((c) => c.key === 'deadline'),
  FILTER_COLUMN_PERSON,
];
const DEC_FILTER_TYPE_ICON = { status: 'status', date: 'date', person: 'person' };
const DEC_FILTER_COL_NAME = { status: 'סטאטוס', deadline: 'תאריך', person: 'מחליט' };
const decRangeLabel = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.label || 'בחרו טווח תאריכים';
const decRangeIcon = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.icon || 'date';


export function PreviousTasksTab({ discussion, onCarryForward, onCarryForwardUndo, onNotify, onNotifyLoading: _onNotifyLoading, onDismissToast: _onDismissToast, canTask = () => true, canCreateTask = true, canEditDiscussion = true, canDecision = () => true, canReorderColumns, canManageSettings = false }) {
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
  const { colorById, labelById, orderById, doneId, options: statusOptions } = useStatusOptions();
  const { isMobile } = useViewport();
  // Show the read-only priority column only when the owner mapped priorityID.
  const showPriority = !!getColumns('tasks').priorityID?.id;

  // Mode: resolve previous tasks via the linked previous discussion (default) or
  // by the current discussion's TYPE (taskTypeID written on each task). Owner sets
  // this in Settings (settings.preferences.previousTasksMode).
  const { settings } = useSettings();
  // round340 — through resolvePreference, so an instance with nothing stored gets the
  // SHIPPED default (now 'auto') instead of a fallback hardcoded at this call site.
  const mode = resolvePreference(settings?.preferences, 'previousTasksMode');
  // Resolve by TYPE when the mode is DISCUSSION_TYPE (always) or AUTO *and* this
  // discussion actually has a type. In AUTO with no type we fall through to the
  // previous-discussion link path (byType=false) — so a single flag still drives
  // every downstream effect/branch below.
  const byType =
    mode === PREVIOUS_TASKS_MODES.DISCUSSION_TYPE
    || (mode === PREVIOUS_TASKS_MODES.AUTO && !!discussion?.discussionTypeID);

  // round274 — by-type scope: 'last' ("הפעם האחרונה", default) shows only the most
  // recent previous discussion of this type; 'all' ("כל הדיונים הקודמים") shows
  // every occurrence. Meaningless in linked mode (a single previous discussion),
  // so the toolbar shows the pill only when byType.
  const [scope, setScope] = useState('last');

  // round275 — content mode: 'tasks' (default) or 'decisions'. The mode toggle
  // sits in the toolbar (right after the source chip, per the approved layout)
  // and swaps the whole view: tasks table + tasks toolbar features ⇄ a read-only
  // decisions table + a decisions search + a tracking-label quick-filter battery.
  const [contentMode, setContentMode] = useState('tasks');
  const [decSearch, setDecSearch] = useState('');
  const [decQuick, setDecQuick] = useState(null); // a decisionTrackingID label id, or null
  const tracking = useStatusOptions('decisions', 'decisionTrackingID');
  // Decision STATUS labels/order/colors — drive the decisions Filter/Sort/Group
  // controls (mirrors DecisionsTab's useStatusOptions('decisions','decisionStatusID')).
  const decStatus = useStatusOptions('decisions', 'decisionStatusID');
  // round279 — keep the WHOLE hook result: it now also exposes the optimistic
  // updaters wired into the interactive decisions table (edit/reorder/resize).
  const decisionsData =
    usePreviousDecisions(discussion, { byType, scope, enabled: contentMode === 'decisions' });
  const { decisions: allDecisions, loading: decisionsLoading } = decisionsData;

  // ---- Decisions Filter / Sort / Group / Save-to-view (round280) ------------
  // Same shared engine + builder chrome as DecisionsTab, but persisted under a
  // SEPARATE saved-view key ('previousDecisions') so it never clobbers the
  // in-discussion decisions tab ('decisionsTab').
  const { view: decSavedView, canSave: decCanSaveView, saveView: decSaveView } =
    useSavedViews('previousDecisions', { canManageSettings });
  const decSavedGroup = DEC_GROUP_OPTIONS.some((o) => o.value === decSavedView?.group?.col) ? decSavedView.group : null;
  const [decGroupBy, setDecGroupBy] = useState(decSavedGroup ? decSavedGroup.col : 'none');
  const [decGroupOrder, setDecGroupOrder] = useState(decSavedGroup?.order || 'labelAsc');
  const [decCollapsed, setDecCollapsed] = useState({});
  const [decSort, setDecSort] = useState(() => {
    const s = decSavedView?.sort;
    if (!s || !s.active || !DEC_SORT_OPTIONS.some((o) => o.value === s.col)) return { col: null, dir: null, active: false };
    return { col: s.col, dir: s.dir || firstDecSortDir(s.col), active: true };
  });
  const {
    filter: decFilter, filterRows: decFilterRows, setFilterOp: setDecFilterOp,
    toggleFilterVal: toggleDecFilterVal, setDeadlineRange: setDecDeadlineRange, setDeadlineDate: setDecDeadlineDate,
    addFilterRow: addDecFilterRow, removeFilterRow: removeDecFilterRow, retargetFilterRow: retargetDecFilterRow, clearFilter: clearDecFilter,
  } = useFilterBuilder({ columns: DEC_FILTER_COLUMNS, defaultRows: ['status'], savedView: decSavedView });
  const decFc = filterCount(decFilter);
  const onDecSortChange = ({ col, dir }) => setDecSort({ col, dir: dir || firstDecSortDir(col), active: true });
  const clearDecSort = () => setDecSort({ col: null, dir: null, active: false });

  // Map a decision to the shape controls.js' engine expects (verbatim from
  // DecisionsTab): status + decider(person) + date.
  const decFilterView = (d) => ({
    id: d.id,
    statusID: d.decisionStatusID,
    responsibilityID: Array.isArray(d.deciderID) ? d.deciderID : [],
    deadlineID: d.decisionDateID instanceof Date ? d.decisionDateID : null,
  });
  // Client pipeline: filter -> search -> quick-filter -> sort, over allDecisions.
  const filteredDecisions = useMemo(() => {
    let list = allDecisions || [];
    if (filterCount(decFilter) > 0) {
      const passing = new Set(filterTasks(list.map(decFilterView), decFilter).map((v) => String(v.id)));
      list = list.filter((d) => passing.has(String(d.id)));
    }
    const q = decSearch.trim();
    if (q) list = list.filter((d) => matchesSearch(d.name, q));
    if (decQuick != null) list = list.filter((d) => String(d.decisionTrackingID) === String(decQuick));
    if (!decSort.active || !decSort.col) return list;
    const views = list.map((d) => ({
      id: d.id, name: d.name,
      statusID: d.decisionStatusID,
      deadlineID: d.decisionDateID instanceof Date ? d.decisionDateID : null,
    }));
    const orderIds = sortTasks(views, decSort, { orderById: decStatus.orderById, labelById: decStatus.labelById })
      .map((v) => String(v.id));
    const byId = new Map(list.map((d) => [String(d.id), d]));
    return orderIds.map((id) => byId.get(id)).filter(Boolean);
  }, [allDecisions, decFilter, decSearch, decQuick, decSort, decStatus.orderById, decStatus.labelById]);

  // Decider person options = the distinct deciders across the loaded decisions.
  const decPersonOptions = useMemo(() => {
    const seen = new Map();
    (allDecisions || []).forEach((d) => (Array.isArray(d.deciderID) ? d.deciderID : []).forEach((p) => {
      if (p && p.id != null && !seen.has(String(p.id))) {
        seen.set(String(p.id), { id: String(p.id), label: p.name || String(p.id), color: null });
      }
    }));
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
  }, [allDecisions]);
  // Tracking-label chips for the decisions quick-filter battery (owner-configured
  // labels + colors, e.g. התקבלה / מיושמת חלקית / מיושמת במלואה).
  const trackingChips = useMemo(
    () => (tracking.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      color: o.color,
      count: (allDecisions || []).filter((d) => String(d.decisionTrackingID) === String(o.id)).length,
    })),
    [tracking.options, allDecisions]
  );

  // Data layer (round146 split): mode-resolved task list + previous-discussion
  // link/picker plumbing live in usePreviousTasksData; the optimistic update
  // handlers live in taskUpdaters.js. Behavior unchanged.
  const {
    tasks, setTasks, tasksLoading,
    resolving, picking, setPicking, discussionOptions, savingPrev, setPrevious,
    previousDiscussionId, previousDiscussionLabel,
    typeFilter, typeMapsLoading,
  } = usePreviousTasksData(discussion, byType, { onResetSelection: () => setSelectedIds(new Set()), scope });
  const {
    updateName, updateStatus, updatePriority, updateAssignee, updatePartners, updateDeadline,
    updateColumn,
    updateStatusBatch, updateAssigneeBatch, updateDeadlineBatch,
  } = useMemo(() => createTaskUpdaters(setTasks), [setTasks]);


  // --- Hide columns (round 47) ------------------------------------------------
  // monday-style column show/hide, OWNER-gated (canManageSettings) at the render
  // site, persisted to the SHARED saved view
  // (settings.preferences.savedViews.previousTasks.hiddenColumns) so an owner's
  // "Save to this view" applies for everyone. The primary name column is never
  // hideable. The list mirrors the TaskTable columns actually shown here
  // (priority only when mapped; "דיון מקור"/source only in by-type mode).
  // round366 — custom mappings join the filter as typed dims (see TasksTab).
  const customTaskCols = useMemo(
    () => customEntriesFor(getColumns('tasks'))
      .filter(([, c]) => c?.id)
      .map(([alias, c]) => ({ alias, type: c.type, title: c.title || alias })),
    []
  );
  const customDims = useMemo(() => customFilterDims(customTaskCols), [customTaskCols]);
  const filterColumns = useMemo(() => [
    ...PREV_FILTER_COLUMNS,
    ...customDims.map((d) => ({
      key: d.key,
      type: d.control === 'values' ? 'status' : d.control,
      alias: d.key,
      ops: d.control === 'date' ? ['within', 'before', 'after'] : d.control === 'text' ? ['contains'] : ['is', 'isnot'],
    })),
  ], [customDims]);
  const colName = (key) => PREV_COL_NAME[key] || customTaskCols.find((c) => c.alias === key)?.title || key;
  const columnList = [
    { key: 'name', label: 'שם', icon: 'text', locked: true },
    showPriority && { key: 'priority', label: 'עדיפות', icon: 'status' },
    { key: 'assignee', label: 'אחראי', icon: 'person' },
    // round306 — hideable like the rest; shown only when the alias is mapped.
    (getColumns('tasks') || {}).partnersID?.id && { key: 'partners', label: 'שותפים', icon: 'person' },
    { key: 'deadline', label: 'דד ליין', icon: 'date' },
    { key: 'status', label: 'סטאטוס', icon: 'status' },
    byType && { key: 'source', label: 'דיון מקור', icon: 'relation' },
    // round366 — custom mappings are hideable like every other column.
    ...customTaskCols.map((c) => ({ key: c.alias, label: c.title, icon: customColumnIcon(c.type) })),
  ].filter(Boolean);
  const hideableKeys = columnList.filter((c) => !c.locked).map((c) => c.key);
  const [hiddenColumns, setHiddenColumns] = useState(
    () => new Set(Array.isArray(savedView?.hiddenColumns) ? savedView.hiddenColumns : [])
  );
  const toggleColumn = useCallback((key) => setHiddenColumns((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), []);
  const showAllColumns = useCallback((show) => {
    setHiddenColumns(show ? new Set() : new Set(hideableKeys));
  }, [hideableKeys]);
  const saveHiddenColumns = useCallback(() => {
    saveView({ hiddenColumns: [...hiddenColumns] });
    onNotify?.('התצוגה נשמרה עבור כל המשתמשים', 'success');
  }, [saveView, hiddenColumns, onNotify]);

  // round286 (owner request) — the DECISIONS view gets its own "הסתר" (columns)
  // control, mirroring "ההחלטות שלי". Columns match MyDecisionsTable's set (name
  // locked); persisted to the previousDecisions saved view. Applied at the render
  // layer only (MyDecisionsTable's `hiddenColumns`), so order/width are untouched.
  const decCols = getColumns('decisions') || {};
  const decColumnList = [
    { key: 'name', label: 'החלטה', icon: 'text', locked: true },
    decCols.deciderID?.id && { key: 'decider', label: 'מחליט', icon: 'person' },
    decCols.affectedID?.id && { key: 'affected', label: 'מושפעים', icon: 'person' },
    decCols.decisionPriorityID?.id && { key: 'priority', label: 'עדיפות', icon: 'status' },
    { key: 'status', label: 'סטאטוס', icon: 'status' },
    decCols.decisionTrackingID?.id && { key: 'tracking', label: 'מעקב החלטה', icon: 'status' },
    decCols.decisionDateID?.id && { key: 'date', label: 'תאריך', icon: 'date' },
    decCols.discussionLinkID?.id && { key: 'discussion', label: 'דיון מקור', icon: 'relation' },
  ].filter(Boolean);
  const decHideableKeys = decColumnList.filter((c) => !c.locked).map((c) => c.key);
  const [decHiddenColumns, setDecHiddenColumns] = useState(
    () => new Set(Array.isArray(decSavedView?.hiddenColumns) ? decSavedView.hiddenColumns : [])
  );
  const toggleDecColumn = useCallback((key) => setDecHiddenColumns((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), []);
  const showAllDecColumns = useCallback((show) => {
    setDecHiddenColumns(show ? new Set() : new Set(decHideableKeys));
  }, [decHideableKeys]);
  const saveDecHiddenColumns = useCallback(() => {
    decSaveView({ hiddenColumns: [...decHiddenColumns] });
    onNotify?.('התצוגה נשמרה עבור כל המשתמשים', 'success');
  }, [decSaveView, decHiddenColumns, onNotify]);





  // Clicking a task's name opens ITS item card on the Updates pane — same
  // affordance as the My Tasks tab (kind: 'updates'). Opens the task, not the
  // source discussion (that's the separate "דיון מקור" chip).
  // Open the task's item card via the shared helper. monday's SDK has no
  // programmatic close (see utils/itemCard.js), so every click reliably (re)opens.
  const openTaskCard = (taskId) => {
    if (!taskId) return;
    openOrToggleItemCard(taskId);
  };

  // ---- multi-select + carry-forward to the current ("next") discussion ----
  // round136 — stable identity so the memoized rows don't thaw on tab re-renders.
  const toggleSelect = useStableHandler((id, checked) =>
    setSelectedIds(prev => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; }));
  const clearSelection = () => setSelectedIds(new Set());
  // ESC clears this tab's multi-selection (shared hook — round135; guards:
  // visible view only, not while typing, not while an overlay is open).
  const rootRef = useRef(null);
  const hasSelection = selectedIds.size > 0;
  useEscToClearSelection(rootRef, hasSelection, clearSelection);
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
  const resolveTargetIds = useBatchTargets(selectedIds, allow); // round143 — shared resolver
  // round136 — the apply* handlers are wrapped in useStableHandler: one frozen
  // identity per handler for the memoized rows; each call reads the LATEST
  // selection/permission state through the wrapper.
  const applyStatusChange = useStableHandler(async (taskId, status) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskStatus');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1) {
      await updateStatusBatch(targetIds, status);
      return;
    }
    for (const id of targetIds) await updateStatus(id, status);
  });
  // Priority has no batch endpoint; apply to each selected target sequentially.
  const applyPriorityChange = useStableHandler(async (taskId, priority) => {
    for (const id of resolveTargetIds(taskId, 'editTaskPriority')) await updatePriority(id, priority);
  });
  // round306 — שותפים, bulk-aware over the allowed selection.
  const applyPartnersChange = useStableHandler(async (taskId, people) => {
    for (const id of resolveTargetIds(taskId, 'editTaskPartners')) await updatePartners(id, people);
  });
  const applyAssigneeChange = useStableHandler(async (taskId, people) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskAssignee');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1) {
      await updateAssigneeBatch(targetIds, people);
      return;
    }
    for (const id of targetIds) await updateAssignee(id, people);
  });
  // round366 — inline edit of a custom column (single-row; gated per row).
  const applyCustomChange = useStableHandler(async (taskId, alias, value) => {
    if (!allow('editTaskCustomColumns', taskId)) return;
    await updateColumn(taskId, alias, value);
  });
  const applyDeadlineChange = useStableHandler(async (taskId, date) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskDeadline');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1) {
      await updateDeadlineBatch(targetIds, date);
      return;
    }
    for (const id of targetIds) await updateDeadline(id, date);
  });

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
    onNotify?.(msg, 'success', DELETE_GRACE_MS, { label: 'בטל', onClick: undo });
  };

  // ---- Sort + Filter (client-side, over the loaded tasks; same engine + saved-
  // view contract as My Tasks). Sort is empty/inactive by default; Filter opens
  // with a default STATUS row (empty values ⇒ shows all) unless a saved view exists. ----
  const [sort, setSort] = useState(() => {
    const s = savedView?.sort;
    if (!s || !s.active || !SORT_OPTIONS.some((o) => o.value === s.col)) return { col: null, dir: null, active: false };
    return { col: s.col, dir: s.dir || firstSortDir(s.col), active: true };
  });
  // Default STATUS row when nothing saved; a saved view's own rows win.
  // State + mutators come from the shared builder state machine (round137).
  const {
    filter, filterRows, setFilterOp, toggleFilterVal, setFilterText, setDeadlineRange, setDeadlineDate,
    setDateColRange, setDateColDate,
    addFilterRow, removeFilterRow, retargetFilterRow, clearFilter,
  } = useFilterBuilder({ columns: filterColumns, defaultRows: ['status'], savedView });
  const fc = filterCount(filter, customDims);
  // Sort handlers (session-only until an owner hits Save, like the other builders).
  const onSortChange = ({ col, dir }) => setSort({ col, dir: dir || firstSortDir(col), active: true });
  const clearSort = () => setSort({ col: null, dir: null, active: false });

  // round366 — value options per custom dim, scanned off the loaded tasks.
  const customFilterOptions = useMemo(() => {
    const map = {};
    for (const d of customDims) {
      if (d.control === 'date' || d.control === 'text') continue;
      const seen = new Map();
      (tasks || []).forEach((t) => {
        const raw = t[d.key];
        if (d.control === 'person') {
          (Array.isArray(raw) ? raw : []).forEach((p) => {
            if (p && p.id != null && !seen.has(String(p.id))) seen.set(String(p.id), { id: String(p.id), label: p.name || String(p.id), color: null });
          });
        } else {
          customComparableValues(raw).forEach((v) => { if (!seen.has(v)) seen.set(v, { id: v, label: v, color: null }); });
        }
      });
      map[d.key] = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
    }
    return map;
  }, [customDims, tasks]);

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

  // Quick-filter battery (round 81): open / done / delayed counts over ALL loaded
  // tasks + a one-click bucket filter folded into the client pipeline.
  const doneStatusIds = useMemo(() => resolveDoneStatusIds(undefined, doneId), [doneId]);
  const todayStart = useMemo(() => startOfToday(), []);
  const bucketCounts = useMemo(() => countBuckets(tasks, doneStatusIds, todayStart), [tasks, doneStatusIds, todayStart]);
  const [quickStatus, setQuickStatus] = useState(null);
  // round132 — toolbar Search (shared SearchPill): client-side name "contains".
  const [search, setSearch] = useState('');

  // Client pipeline: filter -> sort (both instant, over the loaded tasks). An
  // inactive sort returns the list unchanged, so default order is untouched.
  const filteredTasks = useMemo(
    () => {
      let base = sortTasks(filterTasks(tasks, filter, { custom: customDims }), sort, { orderById, labelById });
      if (search.trim()) base = base.filter((tk) => matchesSearch(tk.name, search));
      return quickStatus ? base.filter((tk) => taskInBucket(tk, quickStatus, doneStatusIds, todayStart)) : base;
    },
    [tasks, filter, sort, orderById, labelById, quickStatus, doneStatusIds, todayStart, search, customDims]
  );

  // Groups carry { key, label, color, items } — status groups key by the stable
  // label id (string) and resolve label/color via useStatusOptions; person groups
  // key by name. (See TasksTab for the same shape.)
  // Right-click a group header → shared color palette (round 77).
  const { colorsByKey, openMenuFor, menu: groupColorMenu } = useGroupColors();
  // round142 (audit stage 4) — the grouping engine is shared with TasksTab via
  // grouping.js (groupTabTasks). NOTE: person-group keys are now the unified
  // 'people:<sorted ids>' format (was a bare id list here), so saved header
  // colors for person groups in THIS tab reset once.
  const groupedRaw = useMemo(
    () => groupTabTasks(filteredTasks, { by: groupBy, order: groupOrder, labelById, colorById, orderById }),
    [filteredTasks, groupBy, groupOrder, labelById, colorById, orderById]
  );
  // Apply the shared per-header color overrides as a final pass.
  const grouped = useMemo(() => ensureGroupColors(groupedRaw, colorsByKey), [groupedRaw, colorsByKey]);

  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed[g.key]);
  const toggleAll = () => {
    if (allCollapsed) setCollapsed({});
    else { const c = {}; grouped.forEach((g) => { c[g.key] = true; }); setCollapsed(c); }
  };

  const groupOptions = byType ? [...GROUP_OPTIONS, GROUP_OPTION_DISCUSSION] : GROUP_OPTIONS;

  // Decisions grouping (round280) — status groups key by the stable label id and
  // resolve label/color via useStatusOptions; decider groups key by the sorted
  // person-id set. Verbatim from DecisionsTab.groupedRaw. Shares the same
  // useGroupColors instance (colorsByKey/openMenuFor) as the tasks groups above.
  const decGroupedRaw = useMemo(() => {
    if (decGroupBy === 'status') {
      const groups = new Map();
      filteredDecisions.forEach((d) => {
        const id = isValidStatus(d.decisionStatusID) && decStatus.labelById[d.decisionStatusID] != null ? d.decisionStatusID : null;
        const key = id == null ? DEC_NO_STATUS : String(id);
        if (!groups.has(key)) groups.set(key, { key, statusId: id, items: [] });
        groups.get(key).items.push(d);
      });
      const list = [...groups.values()].map((g) => ({
        key: g.key,
        label: g.statusId == null ? 'ללא סטאטוס' : (decStatus.labelById[g.statusId] ?? 'ללא סטאטוס'),
        color: g.statusId == null ? null : (decStatus.colorById[g.statusId] || null),
        items: g.items,
      }));
      return ensureGroupColors(sortGroupsByOrder(list, { order: decGroupOrder, orderById: decStatus.orderById, noKey: DEC_NO_STATUS }));
    }
    if (decGroupBy === 'decider') {
      const groups = new Map();
      filteredDecisions.forEach((d) => {
        const people = Array.isArray(d.deciderID) ? d.deciderID : [];
        const key = people.map((p) => String(p.id)).sort().join('|') || DEC_NO_DECIDER;
        const label = people.map((p) => p.name).filter(Boolean).join(', ') || 'ללא מחליט';
        if (!groups.has(key)) groups.set(key, { key, label: key, color: null, items: [] });
        groups.get(key).label = label;
        groups.get(key).items.push(d);
      });
      return ensureGroupColors(sortGroupsByOrder([...groups.values()], { order: decGroupOrder, noKey: DEC_NO_DECIDER }));
    }
    return [{ key: '__all__', label: '', color: null, items: filteredDecisions }];
  }, [filteredDecisions, decGroupBy, decGroupOrder, decStatus.labelById, decStatus.colorById, decStatus.orderById]);
  const decGrouped = useMemo(() => ensureGroupColors(decGroupedRaw, colorsByKey), [decGroupedRaw, colorsByKey]);
  const decIsGrouped = decGroupBy !== 'none';
  const decAllCollapsed = decGrouped.length > 0 && decGrouped.every((g) => decCollapsed[g.key]);
  const toggleDecAll = () => {
    if (decAllCollapsed) setDecCollapsed({});
    else { const c = {}; decGrouped.forEach((g) => { c[g.key] = true; }); setDecCollapsed(c); }
  };

  // ---------- Filter panel body (mirrors My Tasks; status + deadline + person) ----------
  const field = (mobile, label, seg) => (mobile
    ? <div className={bs.bField} key={label}><div className={bs.bFieldLabel}>{label}</div>{seg}</div>
    : seg);
  const valueChips = (col) => {
    const opts = col === 'person' ? personOptions : statusOptions;
    return (opts || []).filter((o) => filter[col].values.has(String(o.id))).map((o) => ({ color: o.color, text: o.label }));
  };
  const renderFilterRow = (col, i, mobile, openId, setOpenId) => {
    const fcfg = filterColumns.find((c) => c.key === col);
    if (!fcfg) return null;
    const colSeg = (
      <Segment id={`fcol-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="עמודה"
        icon={PREV_TYPE_ICON[fcfg.type] || 'text'} text={colName(col)}
        options={filterColumns.map((c) => ({
          key: c.key, label: colName(c.key), icon: PREV_TYPE_ICON[c.type] || 'text',
          selected: c.key === col, disabled: c.key !== col && filterRows.includes(c.key),
        }))}
        onPick={(to) => retargetFilterRow(col, to)} />
    );
    const opSeg = (
      <Segment id={`fop-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="תנאי"
        text={OP_LABEL[filter[col].op]}
        options={fcfg.ops.map((op) => ({ key: op, label: OP_LABEL[op], selected: filter[col].op === op }))}
        onPick={(op) => setFilterOp(col, op)} />
    );
    let valueCtl = null;
    if (fcfg.type === 'date') {
      const f = filter[col];
      const onRange = col === 'deadline' ? setDeadlineRange : (r) => setDateColRange(col, r);
      const onDate = col === 'deadline' ? setDeadlineDate : (d) => setDateColDate(col, d);
      if (f.op === 'within') {
        valueCtl = (
          <Segment id={`fval-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="מתי"
            icon={f.range ? rangeIcon(f.range) : 'date'} text={f.range ? rangeLabel(f.range) : 'בחרו טווח תאריכים'} placeholder={!f.range}
            options={DEADLINE_RANGES.map((r) => ({ key: r.key, label: r.label, icon: r.icon, selected: f.range === r.key }))}
            onPick={onRange} />
        );
      } else {
        valueCtl = (
          <div className={mobile ? bs.bDateWrapFull : bs.bDateWrap}>
            <DatePickerPopover value={f.date || null} onChange={onDate} />
          </div>
        );
      }
    } else if (fcfg.type === 'text') {
      valueCtl = (
        <input
          type="text"
          className={bs.bTextInput}
          value={filter[col]?.text || ''}
          placeholder="טקסט לחיפוש"
          onChange={(e) => setFilterText(col, e.target.value)}
          aria-label={`סינון ${colName(col)}`}
        />
      );
    } else {
      const opts = col === 'person' ? personOptions : col === 'status' ? statusOptions : (customFilterOptions[col] || []);
      valueCtl = (
        <Segment id={`fval-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle={colName(col)} multi
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
          {field(true, 'עמודה', colSeg)}
          {field(true, 'תנאי', opSeg)}
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
      {filterRows.length < filterColumns.length
        ? <button type="button" className={bs.bAddLink} onClick={addFilterRow}>+ New filter</button>
        : null}
    </>
  );

  // ---------- Decisions Filter panel body (round280 — mirrors DecisionsTab) ----------
  const decValueChips = (col) => {
    const opts = col === 'person' ? decPersonOptions : decStatus.options;
    return (opts || []).filter((o) => decFilter[col].values.has(String(o.id))).map((o) => ({ color: o.color, text: o.label }));
  };
  const renderDecFilterRow = (col, i, mobile, openId, setOpenId) => {
    const fcfg = DEC_FILTER_COLUMNS.find((c) => c.key === col);
    const colSeg = (
      <Segment id={`dfcol-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="עמודה"
        icon={DEC_FILTER_TYPE_ICON[fcfg.type]} text={DEC_FILTER_COL_NAME[col]}
        options={DEC_FILTER_COLUMNS.map((c) => ({
          key: c.key, label: DEC_FILTER_COL_NAME[c.key], icon: DEC_FILTER_TYPE_ICON[c.type],
          selected: c.key === col, disabled: c.key !== col && decFilterRows.includes(c.key),
        }))}
        onPick={(to) => retargetDecFilterRow(col, to)} />
    );
    const opSeg = (
      <Segment id={`dfop-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="תנאי"
        text={OP_LABEL[decFilter[col].op]}
        options={fcfg.ops.map((op) => ({ key: op, label: OP_LABEL[op], selected: decFilter[col].op === op }))}
        onPick={(op) => setDecFilterOp(col, op)} />
    );
    let valueCtl = null;
    if (col === 'deadline') {
      const f = decFilter.deadline;
      if (f.op === 'within') {
        valueCtl = (
          <Segment id="dfval-deadline" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="מתי"
            icon={f.range ? decRangeIcon(f.range) : 'date'} text={f.range ? decRangeLabel(f.range) : 'בחרו טווח תאריכים'} placeholder={!f.range}
            options={DEADLINE_RANGES.map((r) => ({ key: r.key, label: r.label, icon: r.icon, selected: f.range === r.key }))}
            onPick={setDecDeadlineRange} />
        );
      } else {
        valueCtl = (
          <div className={mobile ? bs.bDateWrapFull : bs.bDateWrap}>
            <DatePickerPopover value={f.date || null} onChange={setDecDeadlineDate} />
          </div>
        );
      }
    } else {
      const opts = col === 'person' ? decPersonOptions : decStatus.options;
      valueCtl = (
        <Segment id={`dfval-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle={DEC_FILTER_COL_NAME[col]} multi
          chips={decValueChips(col)}
          options={(opts || []).map((o) => ({ key: String(o.id), label: o.label, dot: o.color, selected: decFilter[col].values.has(String(o.id)) }))}
          onPick={(id) => toggleDecFilterVal(col, id)} />
      );
    }
    const lead = i === 0 ? 'Where' : 'And';
    const removeBtn = (
      <button type="button" className={bs.bIconBtn} onClick={() => removeDecFilterRow(col)} aria-label="Remove filter">
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
          {field(true, 'עמודה', colSeg)}
          {field(true, 'תנאי', opSeg)}
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
  const renderDecFilterBody = ({ mobile, openId, setOpenId }) => (
    <>
      {decFilterRows.map((col, i) => renderDecFilterRow(col, i, mobile, openId, setOpenId))}
      {decFilterRows.length === 0 ? <div className={bs.bEmpty}>No filters — showing all decisions</div> : null}
      {decFilterRows.length < DEC_FILTER_COLUMNS.length
        ? <button type="button" className={bs.bAddLink} onClick={addDecFilterRow}>+ New filter</button>
        : null}
    </>
  );

  // Loader-first: until the previous-discussion link (or the by-type bridge
  // maps) are resolved, don't render anything definitive (avoids flashing a
  // "nothing here" message before resolution completes).
  if (resolving || typeMapsLoading) {
    return (
      <div className={styles.root}>
        <PreviousTasksSkeleton />
      </div>
    );
  }

  // By-type mode with no resolvable type → explain why (no type set on the
  // discussion, or no matching label on the tasks taskTypeID column / unmapped).
  if (byType && !typeFilter.taskTypeId) {
    return (
      <div className={styles.root}>
        <EmptyState bleedStart>
          {!discussion?.discussionTypeID
            ? 'לא הוגדר סוג לדיון זה'
            : 'לא נמצאו משימות מסוג דיון זה'}
        </EmptyState>
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
    <div ref={rootRef} className={styles.root}>
      {groupColorMenu}
      <div className={styles.toolbar}>
        {/* One left-aligned cluster (like My Tasks): the discussion-type/source chip, then filter + group-by + collapse-all. */}
        <div className={styles.prevChip} dir="rtl">
          <span className={styles.prevChipLabel}>{byType ? 'סוג דיון' : 'דיון קודם'}</span>
          <span className={styles.prevChipName}>{byType ? typeFilter.label : previousDiscussionLabel}</span>
        </div>
        {/* round275 — content mode toggle (משימות/החלטות), right after the source
            chip per the owner's order: source → mode → scope → features. */}
        {/* round279 — segment is dir="rtl", so the FIRST array item renders on the
            RIGHT. Owner wants משימות on the LEFT of החלטות, so החלטות is listed
            first (rightmost) and משימות second (leftmost). Default stays 'tasks'. */}
        <div className={styles.modeSeg} dir="rtl" role="tablist" aria-label="סוג התוכן">
          {[{ key: 'decisions', label: 'החלטות' }, { key: 'tasks', label: 'משימות' }].map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={contentMode === m.key}
              className={`${styles.modeSegBtn}${contentMode === m.key ? ` ${styles.modeSegOn}` : ''}`}
              onClick={() => { setContentMode(m.key); setSelectedIds(new Set()); }}
            >
              {m.label}
            </button>
          ))}
        </div>
        {/* round274 — by-type scope toggle, folded into the toolbar as a compact
            pill (owner spec: one top row). Only shown in by-type mode. */}
        {byType && (
          <button
            type="button"
            className={styles.scopePill}
            dir="rtl"
            onClick={() => { setScope((s) => (s === 'last' ? 'all' : 'last')); setSelectedIds(new Set()); }}
            title="החלפת טווח התצוגה בין הפעם האחרונה לכל הדיונים הקודמים"
          >
            טווח: <b>{scope === 'last' ? 'הפעם האחרונה' : 'כל הדיונים הקודמים'}</b>
            <span className={styles.scopePillChev} aria-hidden="true">▾</span>
          </button>
        )}
        {contentMode === 'tasks' && (
        <div className={styles.toolbarActions} dir="ltr">
          <SearchPill value={search} onChange={setSearch} />
          <BuilderControl
            icon={Filter} label="סינון" title="סינון לפי" mobile={isMobile} width={isMobile ? undefined : 620}
            applied={fc > 0} badge={fc}
            onClear={fc > 0 ? clearFilter : null}
            onSave={canSaveView ? () => {
              saveView({ filter: serializeFilter(filter, customDims), filterRows });
              onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
            } : null}
            renderBody={renderFilterBody}
          />
          <SortByBuilder
            options={SORT_OPTIONS}
            value={sort}
            mobile={isMobile}
            onChange={onSortChange}
            onClear={clearSort}
            onSave={canSaveView ? () => {
              saveView({ sort });
              onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
            } : null}
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
          {/* Hide columns (round 47) — owners only. Non-owners never see it and
              always get the saved config applied to the table below. */}
          {canManageSettings && (
            <HideColumnsControl
              columns={columnList}
              hidden={hiddenColumns}
              onToggle={toggleColumn}
              onToggleAll={showAllColumns}
              onSave={canSaveView ? saveHiddenColumns : null}
            />
          )}
          {groupBy !== 'none' && filteredTasks.length > 0 && (
            <CollapseAllButton collapsed={allCollapsed} onClick={toggleAll} />
          )}
        </div>
        )}
        {/* round275 — decisions feature cluster: just the search here; the quick
            filter is a battery pinned to the far edge (batterySlot) below, so it
            matches the tasks battery's look AND position exactly. */}
        {contentMode === 'decisions' && (
          <div className={styles.toolbarActions} dir="ltr">
            <SearchPill value={decSearch} onChange={setDecSearch} />
            <BuilderControl
              icon={Filter} label="סינון" title="סינון לפי" mobile={isMobile} width={isMobile ? undefined : 620}
              applied={decFc > 0} badge={decFc}
              onClear={decFc > 0 ? clearDecFilter : null}
              onSave={decCanSaveView ? () => {
                decSaveView({ filter: serializeFilter(decFilter), filterRows: decFilterRows });
                onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
              } : null}
              renderBody={renderDecFilterBody}
            />
            <SortByBuilder
              options={DEC_SORT_OPTIONS}
              value={decSort}
              mobile={isMobile}
              onChange={onDecSortChange}
              onClear={clearDecSort}
              onSave={decCanSaveView ? () => {
                decSaveView({ sort: decSort });
                onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
              } : null}
            />
            <GroupByBuilder
              options={DEC_GROUP_OPTIONS}
              value={{ col: decGroupBy, order: decGroupOrder }}
              noneValue="none"
              mobile={isMobile}
              onChange={(g) => { setDecGroupBy(g.col ?? 'none'); if (g.order) setDecGroupOrder(g.order); setDecCollapsed({}); }}
              onSave={decCanSaveView ? () => {
                decSaveView({ group: { col: decGroupBy, order: decGroupOrder } });
                onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
              } : null}
            />
            {/* round286 — "הסתר" (columns) for the decisions view, owners only,
                exactly like "ההחלטות שלי". */}
            {canManageSettings && (
              <HideColumnsControl
                columns={decColumnList}
                hidden={decHiddenColumns}
                onToggle={toggleDecColumn}
                onToggleAll={showAllDecColumns}
                onSave={decCanSaveView ? saveDecHiddenColumns : null}
              />
            )}
            {decIsGrouped && filteredDecisions.length > 0 && (
              <CollapseAllButton collapsed={decAllCollapsed} onClick={toggleDecAll} />
            )}
          </div>
        )}
        {/* Quick-filter battery — pushed to the RIGHT edge (batterySlot). Tasks:
            open/done/delayed. round277 — decisions: one chip per "מעקב החלטה"
            label, rendered with the SAME battery styling + position as tasks. */}
        {contentMode === 'tasks' && (
        <div className={styles.batterySlot}>
          <TaskStatusBattery counts={bucketCounts} active={quickStatus} onPick={setQuickStatus} />
        </div>
        )}
        {contentMode === 'decisions' && trackingChips.length > 0 && (
        <div className={styles.batterySlot}>
          <div className={battery.battery} role="group" aria-label="סינון מהיר לפי מעקב החלטה" dir="rtl">
            {trackingChips.map((c) => {
              const isActive = String(decQuick) === String(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`${battery.chip} ${isActive ? battery.chipActive : ''}`}
                  aria-pressed={isActive}
                  title={`הצג ${c.label}`}
                  onClick={() => setDecQuick((q) => (String(q) === String(c.id) ? null : c.id))}
                >
                  <span className={battery.dot} style={{ background: c.color || 'hsl(var(--status-default))' }} />
                  <span className={battery.label}>{c.label}</span>
                  <span className={battery.count}>{c.count}</span>
                </button>
              );
            })}
          </div>
        </div>
        )}
      </div>

      {contentMode === 'tasks' && (<>
      <SelectionActionBar count={selectedIds.size} onClear={clearSelection} ariaLabel="פעולות על משימות נבחרות">
        {/* "Move to next discussion" carries tasks forward along the
            discussion-to-discussion link — meaningless in by-type mode,
            where there is no "next" discussion, so hide it there. */}
        {!byType && canCreateTask && (
          <Button kind={"primary"} size={"small"} loading={carrying} disabled={carrying} onClick={moveSelectedToNext}>
            העבר לדיון הבא
          </Button>
        )}
        <Button kind={"secondary"} size={"small"} disabled={carrying || deletableSelectedIds.length === 0} onClick={deleteSelectedTasks}>
          מחיקה
        </Button>
      </SelectionActionBar>

      {tasksLoading ? (
        <PreviousTasksSkeleton showToolbar={false} />
      ) : tasks.length === 0 ? (
        <EmptyState bleedStart>
          {byType
            ? `אין משימות שנוצרו ${scope === 'all' ? 'בדיונים האחרונים' : 'בדיון האחרון'} מסוג זה`
            : 'לא נמצאו משימות בדיון הקודם'}
        </EmptyState>
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
                  onContextMenu={(e) => openMenuFor(grp.key, e)}
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
                  hiddenColumns={hiddenColumns}
                  canReorderColumns={canReorderColumns}
                  canManageSettings={canManageSettings}
                  reorderScope={discussion?.id ? `previous_${discussion.id}_${byType ? `type:${typeFilter.taskTypeId}` : `prev:${previousDiscussionId}`}_${groupBy}_${grp.key}` : null}
                  canReorderRows={canCreateTask || canSelect}
                  onOpenCard={openTaskCard}
                  canTask={canTask}
                  onStatusChange={applyStatusChange}
                  onPriorityChange={applyPriorityChange}
                  onAssigneeChange={applyAssigneeChange}
                  onPartnersChange={applyPartnersChange}
                  onDeadlineChange={applyDeadlineChange}
                  onCustomChange={applyCustomChange}
                  onRenameTask={updateName}
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
      </>)}

      {/* round275 — decisions mode: read-only decisions from previous discussions. */}
      {contentMode === 'decisions' && (
        decisionsLoading ? (
          <PreviousTasksSkeleton showToolbar={false} />
        ) : filteredDecisions.length === 0 ? (
          <EmptyState bleedStart>
            {(allDecisions || []).length === 0
              ? (byType
                  ? `אין החלטות שנוצרו ${scope === 'all' ? 'בדיונים האחרונים' : 'בדיון האחרון'} מסוג זה`
                  : 'לא נמצאו החלטות בדיונים קודמים')
              : 'לא נמצאו החלטות התואמות לסינון'}
          </EmptyState>
        ) : !decIsGrouped ? (
          <div className={styles.board}>
            <PreviousDecisionsTable
              decisions={filteredDecisions}
              data={decisionsData}
              canDecision={canDecision}
              canManageSettings={canManageSettings}
              hiddenColumns={decHiddenColumns}
            />
          </div>
        ) : (
          <div className={styles.board}>
            <div className={styles.groupScrollInner}>
              <div className={styles.groupStack}>
                {decGrouped.map((grp) => (
                  <div key={grp.key}>
                    {grp.label && (
                      <button type="button" onClick={() => setDecCollapsed((p) => ({ ...p, [grp.key]: !p[grp.key] }))}
                        onContextMenu={(e) => openMenuFor(grp.key, e)}
                        className={styles.groupHeader}>
                        <DropdownChevronDown
                          className={`${styles.groupChevron} ${decCollapsed[grp.key] ? styles.groupChevronCollapsed : ''}`}
                          style={grp.color ? { color: grp.color } : undefined}
                        />
                        <span className={styles.groupTitle} style={grp.color ? { color: grp.color } : undefined}>{grp.label}</span>
                      </button>
                    )}
                    {!decCollapsed[grp.key] && (
                      <PreviousDecisionsTable
                        decisions={grp.items}
                        data={decisionsData}
                        canDecision={canDecision}
                        canManageSettings={canManageSettings}
                        color={grp.color}
                        hiddenColumns={decHiddenColumns}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default PreviousTasksTab;
