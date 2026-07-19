import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/core';
import { DropdownChevronDown, Search, Filter, Sort, Group, CloseSmall } from '@vibe/icons';
import { SelectionActionBar } from '@generated/components/SelectionActionBar';
import { ArrowLeft } from 'lucide-react';
import { useMyTasks } from '@generated/hooks/useMyTasks.js';
import { usePermission } from '@generated/hooks/usePermission.js';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useDiscussions } from '@generated/hooks/useDiscussions.js';
import { useViewport } from '@generated/hooks/useViewport.js';
import { useMinSplash } from '@generated/hooks/useMinSplash.js';
import { isValidStatus } from '@generated/constants/statusConfig';
import { useMondayContext } from '@generated/contexts/MondayContext.jsx';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { BrandLoader } from '@generated/components/BrandLoader';
import { MyTasksTable } from './MyTasksTable.jsx';
import { groupMyTasks, ensureGroupColors, NO_DISCUSSION } from './grouping.js';
import { useGroupColors } from '@generated/hooks/useGroupColors.jsx';
import { TaskStatusBattery } from '@generated/components/TaskStatusBattery';
import { countBuckets, taskInBucket } from '@generated/components/TaskStatusBattery/taskBuckets.js';
import { resolveDoneStatusIds, startOfToday } from '@generated/components/EffectivenessTab/effectiveness.js';
import { BuilderControl } from './controls/BuilderControl.jsx';
import { Segment } from './controls/Segment.jsx';
import { BuilderIcon } from './controls/BuilderIcon.jsx';
import { HideColumnsControl } from './controls/HideColumnsControl.jsx';
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import { useEscToClearSelection } from '@generated/hooks/useEscToClearSelection.js';
import { useStableHandler } from '@generated/hooks/useStableHandler.js';
import { useBatchTargets } from '@generated/hooks/useBatchTargets.js';
import { useFilterBuilder } from '@generated/hooks/useFilterBuilder.js';
import { getColumns } from '@api/board-config-store.js';
import {
  SORT_COLUMNS, GROUP_COLUMNS, FILTER_COLUMNS, OP_LABEL, DEADLINE_RANGES,
  sortTasks, filterTasks, filterCount, DEFAULT_SORT, DEFAULT_GROUP,
  serializeFilter,
} from './controls/controls.js';
import logger from '@generated/utils/logger.js';
import { useViewTracking } from '@generated/utils/viewTracking.js';
import styles from './MyTasksView.module.css';
import bs from './controls/builder.module.css';

const TYPE_ICON = { status: 'status', date: 'date', text: 'text', relation: 'relation' };

const firstSortDir = (col) => (SORT_COLUMNS.find((c) => c.key === col) || SORT_COLUMNS[0]).dirs[0].key;
const firstGroupOrder = (col) => (GROUP_COLUMNS.find((c) => c.key === col) || GROUP_COLUMNS[0]).orders[0].key;
const rangeLabel = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.label || 'Choose a date range';
const rangeIcon = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.icon || 'date';

// Hidden loader: mounted ONLY when "group by discussion → order by date" is
// active, so discussion dates (which tasks don't carry) are fetched lazily.
function DiscussionDates({ onLoaded }) {
  const { items, loading } = useDiscussions();
  useEffect(() => {
    if (loading) return;
    const map = {};
    items.forEach((d) => { if (d.discussionDateID instanceof Date) map[String(d.id)] = d.discussionDateID; });
    onLoaded(map);
  }, [items, loading, onLoaded]);
  return null;
}

export function MyTasksView({ canManageSettings = false, onBackToDiscussions, onNotify, embedded = false }) {
  const { t } = useTranslation();
  // v2 usage telemetry: one view_open per session for the my_tasks view (D3).
  useViewTracking(logger, 'my_tasks');
  const { context, currentUser } = useMondayContext();
  const { isMobile } = useViewport();

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Seed a new task from the group it is created in: by-status group -> status,
  // by-priority group -> priority (grp.status holds the label id for both); other
  // groupings (discussion / none / board-group) seed nothing — a task created
  // under discussion grouping is deliberately UNLINKED (lands in "ללא דיון").
  const seedForGroup = (grp) => {
    if (group.col === 'status') return grp.status != null ? { status: grp.status } : null;
    if (group.col === 'priority') return grp.status != null ? { priority: grp.status } : null;
    return null;
  };
  // Inline creation (no modal): create immediately with the fixed name; the
  // optimistic row is APPENDED by useMyTasks, i.e. shows at its group's bottom.
  const addTask = (seed = null) =>
    createTask({ name: 'משימה חדשה', status: seed?.status ?? null, priority: seed?.priority ?? null });
  // Shared saved view (settings.preferences.savedViews.myTasks) is the LOAD-TIME
  // state for everyone; local changes are session-only. Empty when nothing saved.
  const { view: savedView, canSave: canSaveView, saveView } = useSavedViews('myTasks', { canManageSettings });
  const [sort, setSort] = useState(() => {
    const s = savedView?.sort;
    // A saved-but-inactive sort means "saved empty" — load as the empty state.
    if (!s || !s.active || !SORT_COLUMNS.some((c) => c.key === s.col)) return { ...DEFAULT_SORT };
    return { col: s.col, dir: s.dir || firstSortDir(s.col), active: true };
  });
  const [group, setGroup] = useState(() => {
    const g = savedView?.group;
    if (!g || !GROUP_COLUMNS.some((c) => c.key === g.col)) return { ...DEFAULT_GROUP };
    return { col: g.col, order: g.order || firstGroupOrder(g.col) };
  });
  // Filter state + mutators — the shared builder state machine (round137).
  // Empty default: no pre-seeded "Where" row — the panel offers "+ New filter".
  const {
    filter, filterRows, setFilterOp, toggleFilterVal, setDeadlineRange, setDeadlineDate,
    addFilterRow, removeFilterRow, retargetFilterRow, clearFilter,
  } = useFilterBuilder({ columns: FILTER_COLUMNS, defaultRows: [], savedView });

  // --- Hide columns (round 46) ------------------------------------------------
  // monday-style column show/hide, OWNER-gated (canManageSettings) at the render
  // site, persisted to the SHARED saved view
  // (settings.preferences.savedViews.myTasks.hiddenColumns) so an owner's "Save
  // to this view" applies for everyone. The primary name column is never
  // hideable. The saved set is LOAD-TIME state (like the other saved-view
  // controls) and is applied live to every table below.
  // Available columns for the Hide panel (plain per-render list, mirroring the
  // table's own getColumns-derived defs — see MyTasksTable.baseDefs).
  const taskCols = getColumns('tasks') || {};
  const columnList = [
    { key: 'name', label: t('myTasks.colName'), icon: 'text', locked: true },
    taskCols.deadlineID?.id && { key: 'deadline', label: t('myTasks.colDeadline'), icon: 'date' },
    taskCols.priorityID?.id && { key: 'priority', label: t('myTasks.colPriority'), icon: 'status' },
    { key: 'status', label: t('myTasks.colStatus'), icon: 'status' },
    taskCols.taskNotesID?.id && { key: 'notes', label: t('myTasks.colNotes'), icon: 'text' },
    { key: 'discussion', label: t('myTasks.colDiscussion'), icon: 'relation' },
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

  const [collapsed, setCollapsed] = useState({});
  const [discDateMap, setDiscDateMap] = useState({});
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Inline "new task" (blue toolbar button): `creatingNew` shows a focused,
  // pre-selected name input as the FIRST row of the topmost group; `newSeed` is
  // the topmost group's seed captured when creation starts; `newRowId` is the
  // just-created row (temp id, then real id) kept PINNED to the very top of the
  // first group so the user always sees it there, whatever the active Group by.
  const [creatingNew, setCreatingNew] = useState(false);
  const [newSeed, setNewSeed] = useState(null);
  const [newRowId, setNewRowId] = useState(null);
  const rootRef = useRef(null);
  // round136 — stable identity so the memoized rows don't thaw on re-renders.
  const toggleSelect = useStableHandler((id, checked) =>
    setSelectedIds((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; }));
  const clearSelection = () => setSelectedIds(new Set());
  // Bulk edit: when >1 rows are selected and the edited row is among them, the
  // change applies to the WHOLE selection (mirrors הנחיות קודמות). Otherwise it's
  // a single-row edit. Notes stays single-row (bulk notes is meaningless).
  // round136 — stable identities (useStableHandler) for the memoized rows; each
  // call still reads the LATEST selection/permission state through the wrapper.
  const applyStatus = useStableHandler((taskId, status) => resolveTargetIds(taskId, 'editTaskStatus').forEach((id) => updateTaskStatus(id, status)));
  const applyPriority = useStableHandler((taskId, value) => resolveTargetIds(taskId, 'editTaskPriority').forEach((id) => updateTaskPriority(id, value)));
  const applyDeadline = useStableHandler((taskId, date) => resolveTargetIds(taskId, 'editTaskDeadline').forEach((id) => updateTaskDeadline(id, date)));
  const applyNotes = useStableHandler((taskId, notes) => updateTaskNotes(taskId, notes));
  const applyRename = useStableHandler((taskId, name) => updateTaskName(taskId, name));
  const deleteSelected = () => {
    const ids = [...selectedIds].filter((id) => allow('deleteTask', id));
    if (ids.length === 0) return;
    clearSelection();
    const { undo } = softDeleteTasks(ids);
    const msg = ids.length === 1 ? 'המשימה נמחקה' : `${ids.length} משימות נמחקו`;
    onNotify?.(msg, 'success', 6000, { label: 'בטל', onClick: undo });
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Status options (for the fills + the staged phase-1 "not done" filter). Loaded
  // once (cached); notDoneStatusIds is [] until ready, so the staged phase-1 then
  // degrades gracefully to the last-month trim alone in that brief window.
  const { options: statusOptions, labelById, colorById, orderById, doneId } = useStatusOptions('tasks', 'statusID');
  const notDoneStatusIds = useMemo(
    () => (statusOptions || []).filter((o) => !o.isDone).map((o) => Number(o.id)),
    [statusOptions]
  );
  const {
    items, loading, loadingMore, hasMore, error, loadMore,
    updateTaskStatus, updateTaskPriority, updateTaskNotes, updateTaskDeadline, updateTaskName,
    softDeleteTasks, createTask,
  } = useMyTasks({ currentUser, context, search: debouncedSearch, notDoneStatusIds });

  // Branded splash for the initial tasks load. useMinSplash arms when `loading`
  // rises (on mount, as the first page fetches) and holds a short min window so
  // the animation is seen on every entry — even when the page is instant. Purely
  // presentational; it reads `loading` and changes no data/hook logic.
  const splash = useMinSplash(loading);

  // Per-task permission gate. Task-tier caps resolve from the TASK's own people
  // columns (creator/responsible) — there is no parent discussion in this
  // surface, so resolveCan takes { item } alone. The board/object OWNER
  // (canManageSettings) bypasses the matrix as everywhere else.
  const can = usePermission({ canManageSettings, currentUser });
  const canTask = useCallback((cap, task) => can(cap, { boardKey: 'tasks', item: task }), [can]);
  const itemById = useMemo(() => new Map(items.map((t) => [String(t.id), t])), [items]);
  const allow = useCallback((cap, taskId) => canTask(cap, itemById.get(String(taskId))), [canTask, itemById]);
  // Bulk targets are filtered per capability: a mixed selection (allowed +
  // disallowed) applies ONLY to the allowed subset (mirrors TasksTab).
  // round143 — shared resolver; declared here (after `allow`) — the hook call
  // evaluates its args immediately, unlike the old inline closure.
  const resolveTargetIds = useBatchTargets(selectedIds, allow);

  const {
    options: priorityOptions,
    labelById: priorityLabelById,
    colorById: priorityColorById,
    orderById: priorityOrderById,
  } = useStatusOptions('tasks', 'priorityID');

  // --- client pipeline: filter -> quick-status -> sort -> group (instant) ---
  const filteredItems = useMemo(() => filterTasks(items, filter), [items, filter]);
  // Quick-filter battery (round 81): open / done / delayed counts over ALL loaded
  // tasks + a one-click bucket filter. "done" = the status column's is_done label.
  const doneStatusIds = useMemo(() => resolveDoneStatusIds(undefined, doneId), [doneId]);
  const todayStart = useMemo(() => startOfToday(), []);
  const bucketCounts = useMemo(() => countBuckets(items, doneStatusIds, todayStart), [items, doneStatusIds, todayStart]);
  const [quickStatus, setQuickStatus] = useState(null);
  const scopedItems = useMemo(
    () => (quickStatus ? filteredItems.filter((tk) => taskInBucket(tk, quickStatus, doneStatusIds, todayStart)) : filteredItems),
    [filteredItems, quickStatus, doneStatusIds, todayStart]
  );
  const sortedItems = useMemo(
    () => sortTasks(scopedItems, sort, { orderById, labelById, priorityOrderById, priorityLabelById }),
    [scopedItems, sort, orderById, labelById, priorityOrderById, priorityLabelById]
  );
  // Right-click a group header → color palette; the chosen color is shared
  // across all users (round 77). colorsByKey overrides the auto group color.
  const { colorsByKey, openMenuFor, menu: groupColorMenu } = useGroupColors();
  const grouped = useMemo(
    () => ensureGroupColors(groupMyTasks(sortedItems, group.col, {
      labelById, colorById, orderById,
      priorityLabelById, priorityColorById, priorityOrderById,
      isValidStatus,
      order: group.order,
      discussionDateById: discDateMap,
      noStatusLabel: t('myTasks.noStatus'),
      noPriorityLabel: t('myTasks.noPriority'),
      noDiscussionLabel: t('myTasks.noDiscussion'),
      allTasksLabel: t('myTasks.allTasks'),
    }), colorsByKey),
    [sortedItems, group, discDateMap, labelById, colorById, orderById, priorityLabelById, priorityColorById, priorityOrderById, t, colorsByKey]
  );

  // Surface the just-created task at the VERY TOP of the view. Under GROUP BY
  // DISCUSSION the new (unlinked) task lives in "ללא דיון", so that group is
  // pinned to the top; under every other Group by the row is lifted to the top
  // of the first group. The pin releases when the grouped view's inputs change
  // (see the effect below).
  const displayGroups = useMemo(() => {
    if (!newRowId || grouped.length === 0) return grouped;
    // Under GROUP BY DISCUSSION a newly created task is UNLINKED, so it lives in
    // the "ללא דיון" bucket. Pin THAT group to the TOP (rather than lifting the
    // row under an unrelated discussion), with the new row first inside it.
    if (group.col === 'discussion') {
      const idx = grouped.findIndex((g) => g.key === NO_DISCUSSION);
      if (idx === -1) return grouped; // no unlinked bucket (row filtered out) — nothing to pin
      const noDisc = grouped[idx];
      const rowIdx = noDisc.items.findIndex((tk) => String(tk.id) === String(newRowId));
      const items = rowIdx === -1
        ? noDisc.items
        : [noDisc.items[rowIdx], ...noDisc.items.filter((_, i) => i !== rowIdx)];
      return [{ ...noDisc, items }, ...grouped.filter((_, i) => i !== idx)];
    }
    // Every other grouping: lift the new row out of its natural bucket to the
    // very top of the FIRST group (surfaces it at the top of the view, as today).
    let pinnedRow = null;
    const stripped = grouped.map((g) => {
      const idx = g.items.findIndex((tk) => String(tk.id) === String(newRowId));
      if (idx === -1) return g;
      pinnedRow = g.items[idx];
      return { ...g, items: g.items.filter((_, i) => i !== idx) };
    });
    if (!pinnedRow) return grouped; // not loaded (filtered out) — nothing to pin
    const [first, ...rest] = stripped;
    return [
      { ...first, items: [pinnedRow, ...first.items] },
      ...rest.filter((g) => g.items.length > 0),
    ];
  }, [grouped, newRowId, group.col]);

  // While drafting a new task inline, it must render in the group that will HOST
  // it: the "ללא דיון" bucket under discussion grouping (pinned to the TOP), or
  // the topmost group otherwise. Synthesize an empty host group when none exists.
  const groupsForRender = useMemo(() => {
    if (!creatingNew) return displayGroups;
    if (group.col === 'discussion') {
      const idx = displayGroups.findIndex((g) => g.key === NO_DISCUSSION);
      if (idx === -1) {
        return [
          { key: NO_DISCUSSION, label: t('myTasks.noDiscussion'), color: null, status: undefined, items: [] },
          ...displayGroups,
        ];
      }
      return [displayGroups[idx], ...displayGroups.filter((_, i) => i !== idx)];
    }
    if (displayGroups.length === 0) {
      return [{ key: '__creating__', label: t('myTasks.allTasks'), color: null, status: undefined, items: [] }];
    }
    return displayGroups;
  }, [creatingNew, displayGroups, group.col, t]);

  // Release the top-of-view pin whenever the grouped view's inputs change — once
  // the user re-sorts / re-groups / filters / searches, the new row settles into
  // its natural position like any other task.
  useEffect(() => { setNewRowId(null); }, [group, sort, filter, debouncedSearch]);

  // ESC clears the multi-selection (shared hook — round135; guards: visible
  // view only, not while typing, not while an overlay is open).
  const hasSelection = selectedIds.size > 0;
  useEscToClearSelection(rootRef, hasSelection, () => setSelectedIds(new Set()));

  // Prune selected ids that are no longer loaded (filter/search/pagination churn).
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const valid = new Set(items.map((t) => t.id));
      const next = new Set();
      current.forEach((id) => { if (valid.has(id)) next.add(id); });
      return next.size === current.size ? current : next;
    });
  }, [items]);

  // ---- sort handlers ----
  const setSortCol = useCallback((col) => setSort({ col, dir: firstSortDir(col), active: true }), []);
  const setSortDir = useCallback((dir) => setSort((s) => ({ ...s, dir, active: true })), []);
  const clearSort = useCallback(() => setSort({ ...DEFAULT_SORT }), []);

  // ---- group handlers (session-only; persisting is the explicit Save action) ----
  const setGroupCol = useCallback((col) => { setGroup({ col, order: firstGroupOrder(col) }); setCollapsed({}); }, []);
  const setGroupOrder = useCallback((order) => setGroup((g) => ({ ...g, order })), []);
  const clearGroup = useCallback(() => { setGroup({ col: 'none' }); setCollapsed({}); }, []);

  const fc = filterCount(filter);

  // ---- Save (shared saved view): each panel persists ITS selection for all users ----
  const notifySaved = () => onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
  const saveSortView = () => { saveView({ sort }); notifySaved(); };
  const saveGroupView = () => { saveView({ group }); notifySaved(); };
  const saveFilterView = () => { saveView({ filter: serializeFilter(filter), filterRows }); notifySaved(); };

  // ---- collapse ----
  const setGroupModePersist = setGroupCol; // alias for clarity in render
  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed[g.key]);
  const toggleAll = () => {
    if (allCollapsed) setCollapsed({});
    else { const c = {}; grouped.forEach((g) => { c[g.key] = true; }); setCollapsed(c); }
  };

  // Blue toolbar button ("משימה חדשה"): open an inline draft row at the VERY TOP
  // of the view (first row of the topmost group) with its name in edit mode —
  // instead of creating a fixed-named task at the bottom. Expand the topmost
  // group if collapsed so the draft row is visible, and capture that group's
  // seed (status/priority) so the committed task inherits it.
  const startCreateNew = () => {
    // The draft's host group: "ללא דיון" under discussion grouping (a new task is
    // unlinked), else the topmost group. Expand it if collapsed so the draft row
    // is visible, and capture its seed (status/priority) for the committed task.
    const host = group.col === 'discussion'
      ? (grouped.find((g) => g.key === NO_DISCUSSION) || null)
      : (grouped[0] || null);
    if (host && collapsed[host.key]) setCollapsed((p) => ({ ...p, [host.key]: false }));
    setNewSeed(host ? seedForGroup(host) : null);
    setCreatingNew(true);
  };
  // Commit the draft: create the task with `prepend` so its optimistic row lands
  // at the FRONT of the list, seeded with the topmost group's value, and pin it
  // to the top of the first group (newRowId) across the optimistic→real swap so
  // it stays put. An empty name discards (nothing created) — consistent with the
  // in-discussion inline add-row. The name is committed AS the task's name, so we
  // never create a fixed "משימה חדשה" the user then has to rename.
  const commitNewTask = (name) => {
    setCreatingNew(false);
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    createTask({
      name: trimmed,
      status: newSeed?.status ?? null,
      priority: newSeed?.priority ?? null,
      prepend: true,
      onOptimistic: (tempId) => setNewRowId(tempId),
      onReconcile: (tempId, realId) => setNewRowId((cur) => (String(cur) === String(tempId) ? realId : cur)),
    });
  };
  const cancelNewTask = () => setCreatingNew(false);

  const COL_NAME = {
    priority: t('myTasks.colPriority'),
    deadline: t('myTasks.colDeadline'),
    status: t('myTasks.colStatus'),
    name: t('myTasks.colName'),
    discussion: t('myTasks.colDiscussion'),
  };
  const field = (mobile, label, seg) => (mobile
    ? <div className={bs.bField} key={label}><div className={bs.bFieldLabel}>{label}</div>{seg}</div>
    : seg);

  // ---------- Sort panel body ----------
  const renderSortBody = ({ mobile, openId, setOpenId }) => {
    const colOptions = SORT_COLUMNS.map((c) => ({ key: c.key, label: COL_NAME[c.key], icon: TYPE_ICON[c.type], selected: c.key === sort.col }));
    // Empty state — no column chosen yet: a placeholder segment, like Group's.
    if (!sort.col) {
      const emptySeg = (
        <Segment id="col" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
          text="Choose a column" placeholder options={colOptions} onPick={setSortCol} />
      );
      return mobile ? field(true, 'Column', emptySeg) : <div className={bs.bRow}>{emptySeg}</div>;
    }
    const sc = SORT_COLUMNS.find((c) => c.key === sort.col) || SORT_COLUMNS[0];
    const dir = sc.dirs.find((d) => d.key === sort.dir) || sc.dirs[0];
    const colSeg = (
      <Segment id="col" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={TYPE_ICON[sc.type]} text={COL_NAME[sc.key]}
        options={colOptions}
        onPick={setSortCol} />
    );
    const dirSeg = (
      <Segment id="dir" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Direction" note={sc.note}
        icon={dir.icon} text={dir.label}
        options={sc.dirs.map((d) => ({ key: d.key, label: d.label, icon: d.icon, selected: d.key === sort.dir }))}
        onPick={setSortDir} />
    );
    return mobile
      ? <>{field(true, 'Column', colSeg)}{field(true, 'Direction', dirSeg)}</>
      : <div className={bs.bRow}>{colSeg}{dirSeg}</div>;
  };

  // ---------- Group panel body ----------
  const renderGroupBody = ({ mobile, openId, setOpenId }) => {
    const colOptions = GROUP_COLUMNS.map((c) => ({ key: c.key, label: COL_NAME[c.key], icon: TYPE_ICON[c.type], selected: c.key === group.col }));
    if (group.col === 'none') {
      const colSeg = (
        <Segment id="gcol" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
          text="Choose a column" placeholder options={colOptions} onPick={setGroupModePersist} />
      );
      return mobile ? field(true, 'Column', colSeg) : <div className={bs.bRow}>{colSeg}</div>;
    }
    const gc = GROUP_COLUMNS.find((c) => c.key === group.col) || GROUP_COLUMNS[0];
    const ord = gc.orders.find((o) => o.key === group.order) || gc.orders[0];
    const colSeg = (
      <Segment id="gcol" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={TYPE_ICON[gc.type]} text={COL_NAME[gc.key]} options={colOptions} onPick={setGroupModePersist} />
    );
    const ordSeg = (
      <Segment id="gord" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Order"
        icon={ord.icon} text={ord.label}
        options={gc.orders.map((o) => ({ key: o.key, label: o.label, icon: o.icon, selected: o.key === group.order }))}
        onPick={setGroupOrder} />
    );
    return mobile
      ? <>{field(true, 'Column', colSeg)}{field(true, 'Order', ordSeg)}</>
      : <div className={bs.bRow}>{colSeg}{ordSeg}</div>;
  };

  // ---------- Filter panel body ----------
  const valueChips = (col) => {
    const opts = col === 'status' ? statusOptions : priorityOptions;
    return opts.filter((o) => filter[col].values.has(String(o.id))).map((o) => ({ color: o.color, text: o.label }));
  };
  const renderFilterRow = (col, i, mobile, openId, setOpenId) => {
    const fcfg = FILTER_COLUMNS.find((c) => c.key === col);
    const colSeg = (
      <Segment id={`fcol-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={TYPE_ICON[fcfg.type]} text={COL_NAME[col]}
        options={FILTER_COLUMNS.map((c) => ({
          key: c.key, label: COL_NAME[c.key], icon: TYPE_ICON[c.type],
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
      const opts = col === 'status' ? statusOptions : priorityOptions;
      valueCtl = (
        <Segment id={`fval-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle={COL_NAME[col]} multi
          chips={valueChips(col)}
          options={opts.map((o) => ({ key: String(o.id), label: o.label, dot: o.color, selected: filter[col].values.has(String(o.id)) }))}
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
      {filterRows.length < FILTER_COLUMNS.length
        ? <button type="button" className={bs.bAddLink} onClick={addFilterRow}>+ New filter</button>
        : null}
    </>
  );

  const showSearch = searchOpen || search.length > 0;
  const needDiscDates = group.col === 'discussion' && (group.order === 'dateAsc' || group.order === 'dateDesc');

  return (
    <div className={styles.root} ref={rootRef}>
      {groupColorMenu}
      {needDiscDates ? <DiscussionDates onLoaded={setDiscDateMap} /> : null}

      {/* View title (round 40 typography; round 41 left-aligned) with a compact
          left-arrow "back to discussions" icon button to its LEFT (round 53a,
          replacing the old text button that lived in the toolbar). The header is
          direction:ltr so the arrow sits on the left, the title to its right. */}
      {/* round170 — when embedded in the PersonalShell, the shell owns the back
          arrow + the (tab) title, so this view drops its own header row. */}
      {!embedded && (
        <div className={styles.viewHeader}>
          {onBackToDiscussions && (
            <button
              type="button"
              className={styles.backArrowBtn}
              onClick={onBackToDiscussions}
              aria-label="בחזרה לתצוגת הדיונים"
              title="בחזרה לתצוגת הדיונים"
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
          )}
          <h1 className={styles.viewTitle}>המשימות שלי</h1>
        </div>
      )}

      {/* Single toolbar row (round 35 baseline; round 41 flush-LEFT): dir="ltr"
          and flush-LEFT, reading (left→right)
          [משימה חדשה][Search][Filter][Sort][Group by][collapse]. Round 53a moved
          the back control out of the toolbar to a left-arrow icon button beside
          the view title, so "משימה חדשה" is now the leftmost toolbar control. */}
      <div className={styles.toolbar} dir="ltr">
        <Button kind={"primary"} size={"small"} onClick={startCreateNew}>
          משימה חדשה
        </Button>

        {showSearch ? (
          <div className={styles.searchPill}>
            {/* clear-X pinned to the pill's LEFT edge (LTR toolbar → first child).
                mousedown-preventDefault keeps the input focused through the click
                so clearing never collapses the pill via the input's blur. */}
            {search ? (
              <button
                type="button"
                className={styles.searchClear}
                aria-label="נקה חיפוש"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSearch('')}
              >
                <CloseSmall size={16} />
              </button>
            ) : null}
            <Search className={styles.pillIcon} aria-hidden="true" />
            <input
              className={styles.searchInput}
              type="text"
              autoFocus
              value={search}
              placeholder="Search"
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => { if (!search) setSearchOpen(false); }}
              aria-label="Search"
            />
          </div>
        ) : (
          <button type="button" className={styles.pill} onClick={() => setSearchOpen(true)}>
            <Search className={styles.pillIcon} />
            <span>Search</span>
          </button>
        )}

        <BuilderControl
          icon={Filter} label="Filter" title="Filter by" mobile={isMobile} width={isMobile ? undefined : 620}
          applied={fc > 0} badge={fc}
          onClear={fc > 0 ? clearFilter : null}
          onSave={canSaveView ? saveFilterView : null}
          renderBody={renderFilterBody}
        />
        <BuilderControl
          icon={Sort} label="Sort" title="Sort by" mobile={isMobile} width={isMobile ? undefined : 360}
          applied={sort.active} badge={1}
          onClear={sort.active ? clearSort : null}
          onSave={canSaveView ? saveSortView : null}
          renderBody={renderSortBody}
        />
        <BuilderControl
          icon={Group} label="Group by" title="Group items by" mobile={isMobile} width={isMobile ? undefined : 360}
          applied={group.col !== 'none'} badge={1}
          onClear={group.col !== 'none' ? clearGroup : null}
          onSave={canSaveView ? saveGroupView : null}
          renderBody={renderGroupBody}
        />

        {/* Hide columns (round 46) — owners only. Non-owners never see it and
            always get the saved config applied. */}
        {canManageSettings && (
          <HideColumnsControl
            columns={columnList}
            hidden={hiddenColumns}
            onToggle={toggleColumn}
            onToggleAll={showAllColumns}
            onSave={canSaveView ? saveHiddenColumns : null}
          />
        )}

        <CollapseAllButton collapsed={allCollapsed} onClick={toggleAll} />

        {/* Quick-filter battery (round 81) — pushed to the far (right) end of the
            toolbar, monday-battery style: open / done / delayed counts + filter. */}
        <div className={styles.batterySlot}>
          <TaskStatusBattery counts={bucketCounts} active={quickStatus} onPick={setQuickStatus} />
        </div>
      </div>

      <SelectionActionBar count={selectedIds.size} onClear={clearSelection} ariaLabel="פעולות על משימות נבחרות">
        <Button kind={"secondary"} size={"small"} onClick={deleteSelected}>מחיקה</Button>
      </SelectionActionBar>

      <div className={styles.board}>
      {(loading || splash) ? (
        <BrandLoader />
      ) : error ? (
        <div className={styles.empty}>{t('myTasks.error')}</div>
      ) : (items.length === 0 && !creatingNew) ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>{t('myTasks.empty')}</div>
          <div className={styles.emptyHint}>{t('myTasks.emptyHint')}</div>
        </div>
      ) : (
        <div className={styles.groupScrollInner}>
          <div className={styles.groupStack}>
            {groupsForRender.map((grp, gi) => (
              <div key={grp.key}>
                <button
                  type="button"
                  onClick={() => setCollapsed((p) => ({ ...p, [grp.key]: !p[grp.key] }))}
                  onContextMenu={(e) => openMenuFor(grp.key, e)}
                  className={styles.groupHeader}
                >
                  <DropdownChevronDown
                    className={`${styles.chevron} ${collapsed[grp.key] ? styles.chevronCollapsed : ''}`}
                    style={grp.color ? { color: grp.color } : undefined}
                  />
                  <span
                    className={styles.groupTitle}
                    style={{ color: grp.color || 'var(--secondary-text-color)' }}
                  >
                    {grp.label}
                  </span>
                  <span className={styles.groupCount}>{grp.items.length}</span>
                </button>
                {!collapsed[grp.key] && (
                  <MyTasksTable
                    tasks={grp.items}
                    color={grp.color}
                    canManageSettings={canManageSettings}
                    hiddenColumns={hiddenColumns}
                    canTask={canTask}
                    searchTerm={debouncedSearch}
                    onStatusChange={applyStatus}
                    onPriorityChange={applyPriority}
                    onNotesChange={applyNotes}
                    onDeadlineChange={applyDeadline}
                    onRenameTask={applyRename}
                    selectable
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                    selectAllChecked={grp.items.length > 0 && grp.items.every((t) => selectedIds.has(t.id))}
                    selectAllIndeterminate={grp.items.some((t) => selectedIds.has(t.id)) && !grp.items.every((t) => selectedIds.has(t.id))}
                    onToggleSelectAll={(checked) => setSelectedIds((prev) => {
                      const n = new Set(prev);
                      grp.items.forEach((t) => (checked ? n.add(t.id) : n.delete(t.id)));
                      return n;
                    })}
                    onAddTask={() => addTask(seedForGroup(grp))}
                    newTaskRow={creatingNew && gi === 0 ? {
                      defaultName: 'משימה חדשה',
                      onCommit: commitNewTask,
                      onCancel: cancelNewTask,
                    } : null}
                  />
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <div className={styles.loadMore}>
              <button type="button" className={styles.pill} disabled={loadingMore} onClick={loadMore}>
                <span>{t('myTasks.loadMore')}</span>
              </button>
            </div>
          )}
        </div>
      )}
      </div>

    </div>
  );
}

export default MyTasksView;
