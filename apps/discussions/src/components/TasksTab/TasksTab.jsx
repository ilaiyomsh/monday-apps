import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Skeleton, Button, Text } from '@vibe/core';
import { DropdownChevronDown, CloseSmall, Filter } from '@vibe/icons';
import { TaskTable } from '@generated/components/TaskTable';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { GroupByBuilder, GROUP_STATUS_ORDERS, GROUP_AZ_ORDERS, sortGroupsByOrder } from '@generated/components/GroupByBuilder';
// Varied stable group-title colors (owner request 2026-07-14) — shared engine.
import { ensureGroupColors } from '@generated/components/MyTasksView/grouping.js';
import { SortByBuilder, SORT_STATUS_DIRS, SORT_DATE_DIRS, SORT_TEXT_DIRS } from '@generated/components/SortByBuilder';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '@generated/components/MyTasksView/controls/Segment.jsx';
import { BuilderIcon } from '@generated/components/MyTasksView/controls/BuilderIcon.jsx';
import { HideColumnsControl } from '@generated/components/MyTasksView/controls/HideColumnsControl.jsx';
import {
  filterTasks, filterCount, emptyFilter, serializeFilter, deserializeFilter, sortTasks,
  FILTER_COLUMNS, FILTER_COLUMN_PERSON, OP_LABEL, DEADLINE_RANGES,
} from '@generated/components/MyTasksView/controls/controls.js';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import bs from '@generated/components/MyTasksView/controls/builder.module.css';
import { useViewport } from '@generated/hooks/useViewport.js';
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { isValidStatus } from '@generated/constants/statusConfig';
import { getColumns } from '@api/board-config-store.js';
import styles from './TasksTab.module.css';

// Client-side Filter config for the Tasks tab (mirrors PreviousTasksTab): the
// filterable columns are status + deadline + person (assignee). Reuses the
// shared controls.js engine + BuilderControl UI. Priority is intentionally NOT
// a filter column here (it's an optional read-only column, matching Previous).
const TASKS_FILTER_COLUMNS = [
  FILTER_COLUMNS.find((c) => c.key === 'status'),
  FILTER_COLUMNS.find((c) => c.key === 'deadline'),
  FILTER_COLUMN_PERSON,
];
const FILTER_TYPE_ICON = { status: 'status', date: 'date', person: 'person' };
const FILTER_COL_NAME = { status: 'סטטוס', deadline: 'דד ליין', person: 'אחראי' };
const rangeLabel = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.label || 'Choose a date range';
const rangeIcon = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.icon || 'date';

// Column-name style options (nouns, no "לפי" prefix) + per-column order sets, so
// the builder matches the My Tasks Group module (English chrome, Hebrew column
// name in the segment, e.g. "סטאטוס" / "Z → A").
const GROUP_OPTIONS = [
  { value: 'none', label: 'ללא קיבוץ' },
  { value: 'status', label: 'סטאטוס', icon: 'status', orders: GROUP_STATUS_ORDERS },
  { value: 'person', label: 'אחראי', icon: 'person', orders: GROUP_AZ_ORDERS },
];
// Sort columns for the Tasks tab (mirrors the filter columns: status + deadline
// + name). `value` is a sortTasks() column key; the direction sets come from the
// shared My Tasks sort config so labels/icons/keys match everywhere.
const SORT_OPTIONS = [
  { value: 'status', label: 'סטטוס', icon: 'status', dirs: SORT_STATUS_DIRS },
  { value: 'deadline', label: 'דד ליין', icon: 'date', dirs: SORT_DATE_DIRS, note: 'Tasks with no deadline always sort last' },
  { value: 'name', label: 'שם', icon: 'text', dirs: SORT_TEXT_DIRS },
];
const firstSortDir = (col) => (SORT_OPTIONS.find((o) => o.value === col) || SORT_OPTIONS[0])?.dirs?.[0]?.key;
const NO_STATUS = '__none__';
const NO_ASSIGNEE = '__unassigned__';

function buildPersonGroup(task) {
  const people = Array.isArray(task?.responsibilityID) ? task.responsibilityID : [];
  if (people.length === 0) return { key: NO_ASSIGNEE, label: 'לא הוקצה', assignee: [] };
  const normalized = people
    .map((p) => ({ id: String(p.id), name: p.name || '' }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    key: `people:${normalized.map((p) => p.id).join('|')}`,
    label: normalized.map((p) => p.name).join(', '),
    assignee: normalized.map((p) => ({ id: p.id, kind: 'person', name: p.name })),
  };
}

// `data` is the shared useTasks() result, prefetched in DiscussionCard.
// Phase 4: editing is gated by the TASK-TIER caps, resolved PER-TASK via
// `canTask(cap, task)` (passed from DiscussionCard, bound to the discussion).
// `canCreateTask` gates the "משימה חדשה"/add-row affordances. While the feature
// is off both resolve via the legacy creator/lead/owner gate, so behavior is
// byte-for-byte identical to the old single `canEdit` boolean.
export function TasksTab({ data, discussionId = null, onNewTask, onInlineCreateTask, onNotify, canTask = () => true, canCreateTask = true, canReorderColumns, canManageSettings = false }) {
  const {
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
    softDeleteTasks,
    retryCreate,
    dismissRow,
  } = data;
  // Load-time grouping/filter = the shared saved view (empty default otherwise);
  // in-session changes are local until someone with permission hits Save.
  const { view: savedView, canSave: canSaveView, saveView } = useSavedViews('tasksTab', { canManageSettings });
  const savedGroup = GROUP_OPTIONS.some((o) => o.value === savedView?.group?.col) ? savedView.group : null;
  const [groupBy, setGroupBy] = useState(savedGroup ? savedGroup.col : 'none');
  const [groupOrder, setGroupOrder] = useState(savedGroup?.order || 'labelAsc');
  const [collapsed, setCollapsed] = useState({});
  // Sort (client-side, over the loaded tasks; same engine + saved-view contract
  // as My Tasks). Load-time = the shared saved sort; empty/inactive by default.
  const [sort, setSort] = useState(() => {
    const s = savedView?.sort;
    if (!s || !s.active || !SORT_OPTIONS.some((o) => o.value === s.col)) return { col: null, dir: null, active: false };
    return { col: s.col, dir: s.dir || firstSortDir(s.col), active: true };
  });

  // ---- Filter (client-side, over the loaded tasks; same engine as My Tasks /
  // Previous tasks). status + deadline + person columns. ----
  const [filter, setFilter] = useState(() => (savedView?.filter ? deserializeFilter(savedView.filter) : emptyFilter()));
  // Filter opens with a default STATUS row (empty values ⇒ shows all) when no
  // saved view exists; a saved view's own rows win (incl. an explicitly empty set).
  const [filterRows, setFilterRows] = useState(() => (
    Array.isArray(savedView?.filterRows)
      ? savedView.filterRows.filter((k) => TASKS_FILTER_COLUMNS.some((c) => c.key === k))
      : ['status']
  ));
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const { colorById, labelById, orderById, options: statusOptions } = useStatusOptions();
  const { isMobile } = useViewport();

  // Filter mutators (mirror PreviousTasksTab).
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
    const next = TASKS_FILTER_COLUMNS.map((c) => c.key).find((k) => !rows.includes(k));
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
  const clearFilter = () => { setFilter(emptyFilter()); setFilterRows(['status']); };
  const fc = filterCount(filter);
  // Sort handlers (session-only until an owner hits Save, like the other builders).
  const onSortChange = ({ col, dir }) => setSort({ col, dir: dir || firstSortDir(col), active: true });
  const clearSort = () => setSort({ col: null, dir: null, active: false });
  // Show the read-only priority column only when the owner mapped priorityID.
  const showPriority = !!getColumns('tasks').priorityID?.id;

  // --- Hide columns (round 47) ------------------------------------------------
  // monday-style column show/hide, OWNER-gated (canManageSettings) at the render
  // site, persisted to the SHARED saved view
  // (settings.preferences.savedViews.tasksTab.hiddenColumns) so an owner's "Save
  // to this view" applies for everyone. The primary name column is never
  // hideable. The list mirrors the TaskTable columns actually shown for this tab
  // (priority only when mapped; no 'source' here). Applied live via the
  // hiddenColumns prop on every TaskTable below.
  const columnList = [
    { key: 'name', label: 'שם', icon: 'text', locked: true },
    showPriority && { key: 'priority', label: 'עדיפות', icon: 'status' },
    { key: 'assignee', label: 'אחראי', icon: 'person' },
    { key: 'deadline', label: 'דד ליין', icon: 'date' },
    { key: 'status', label: 'סטאטוס', icon: 'status' },
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

  // Each group is { key, label, color, status, items }:
  //   key    — stable react/collapse key (status id as string, person name, or sentinel)
  //   label  — display text (status label via labelById, or person name)
  //   color  — group accent (status color via colorById; null otherwise)
  //   status — the status id to seed when quick-adding inside the group
  //            (number, including 0; null = "no status" group; undefined = N/A)
  // Assignee options = the distinct people present across the loaded tasks.
  const personOptions = useMemo(() => {
    const seen = new Map();
    (items || []).forEach((t) => (t.responsibilityID || []).forEach((p) => {
      if (p && p.id != null && !seen.has(String(p.id))) {
        seen.set(String(p.id), { id: String(p.id), label: p.name || String(p.id), color: null });
      }
    }));
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
  }, [items]);

  // Client pipeline: filter -> sort (both instant, over the loaded page). An
  // inactive sort returns the list unchanged, so default order is untouched.
  const filteredTasks = useMemo(
    () => sortTasks(filterTasks(items, filter), sort, { orderById, labelById }),
    [items, filter, sort, orderById, labelById]
  );

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
        status: g.statusId,
        items: g.items,
      }));
      return ensureGroupColors(sortGroupsByOrder(list, { order: groupOrder, orderById, noKey: NO_STATUS }));
    }
    if (groupBy === 'person') {
      const groups = new Map();
      filteredTasks.forEach(t => {
        const personGroup = buildPersonGroup(t);
        if (!groups.has(personGroup.key)) {
          groups.set(personGroup.key, {
            key: personGroup.key,
            label: personGroup.label,
            color: null,
            status: undefined,
            assignee: personGroup.assignee,
            items: [],
          });
        }
        groups.get(personGroup.key).items.push(t);
      });
      return ensureGroupColors(sortGroupsByOrder([...groups.values()], { order: groupOrder, noKey: NO_ASSIGNEE }));
    }
    return [{ key: '__all__', label: '', color: null, status: undefined, items: filteredTasks }];
  }, [filteredTasks, groupBy, groupOrder, labelById, colorById, orderById]);

  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed[g.key]);
  const allIds = useMemo(() => items.map((t) => t.id), [items]);
  const toggleAll = () => {
    if (allCollapsed) { setCollapsed({}); }
    else { const c = {}; grouped.forEach((g) => { c[g.key] = true; }); setCollapsed(c); }
  };
  const toggleSelect = (id, checked) =>
    setSelectedIds(prev => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; });
  const clearSelection = () => setSelectedIds(new Set());
  // ESC clears this tab's multi-selection. The document-level listener is live
  // ONLY while something is selected, and it no-ops unless THIS view is actually
  // visible (offsetParent is null when a tab is hidden behind another) — so it
  // never clears a different tab's selection. ESC still closes an open editor /
  // overlay first: we bail when the event was already handled, when the user is
  // typing in a text field (inline rename / people-picker search), or when a
  // dialog / listbox / menu (status / date / person picker) is open.
  const rootRef = useRef(null);
  const hasSelection = selectedIds.size > 0;
  useEffect(() => {
    if (!hasSelection) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!rootRef.current || rootRef.current.offsetParent === null) return;
      const el = e.target;
      const tag = el && el.tagName;
      const typing = tag === 'TEXTAREA' || (el && el.isContentEditable)
        || (tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset)$/.test(el.type || ''));
      if (typing) return;
      if (document.querySelector('[role="dialog"],[role="listbox"],[role="menu"]')) return;
      setSelectedIds(new Set());
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hasSelection]);
  const itemById = useMemo(() => {
    const m = new Map();
    items.forEach((t) => m.set(String(t.id), t));
    return m;
  }, [items]);
  // Per-task capability check (cheap, at render). Used to gate row editors and to
  // filter batch/bulk targets down to the tasks the user may actually edit.
  const allow = useCallback(
    (cap, taskId) => canTask(cap, itemById.get(String(taskId))),
    [canTask, itemById]
  );
  // Resolve the set of tasks an action applies to, then keep only those the user
  // is permitted to act on for `cap`. A mixed selection (allowed + disallowed)
  // applies ONLY to the allowed subset (silently skips the rest).
  const resolveTargetIds = (originTaskId, cap) => {
    const base = selectedIds.size > 1 && selectedIds.has(originTaskId) ? [...selectedIds] : [originTaskId];
    return cap ? base.filter((id) => allow(cap, id)) : base;
  };
  const applyStatusChange = async (taskId, status) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskStatus');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1 && updateTasksStatusBatch) {
      await updateTasksStatusBatch(targetIds, status);
      return;
    }
    for (const id of targetIds) await updateTaskStatus(id, status);
  };
  // Priority has no batch endpoint; apply to each selected target sequentially.
  const applyPriorityChange = async (taskId, priority) => {
    for (const id of resolveTargetIds(taskId, 'editTaskPriority')) await updateTaskPriority(id, priority);
  };
  const applyAssigneeChange = async (taskId, people) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskAssignee');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1 && updateTasksAssigneeBatch) {
      await updateTasksAssigneeBatch(targetIds, people);
      return;
    }
    for (const id of targetIds) await updateTaskAssignee(id, people);
  };
  const applyDeadlineChange = async (taskId, date) => {
    const targetIds = resolveTargetIds(taskId, 'editTaskDeadline');
    if (targetIds.length === 0) return;
    if (targetIds.length > 1 && updateTasksDeadlineBatch) {
      await updateTasksDeadlineBatch(targetIds, date);
      return;
    }
    for (const id of targetIds) await updateTaskDeadline(id, date);
  };
  const applyRename = async (taskId, name) => {
    if (!allow('editTaskName', taskId)) return;
    await updateTaskName(taskId, name);
  };

  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const valid = new Set(allIds);
      const next = new Set();
      current.forEach((id) => { if (valid.has(id)) next.add(id); });
      return next.size === current.size ? current : next;
    });
  }, [allIds]);

  // Only the selected tasks the user may delete (mixed selection → delete the
  // allowed subset; if none are allowed the action is a no-op / disabled).
  const deletableSelectedIds = useMemo(
    () => [...selectedIds].filter((id) => allow('deleteTask', id)),
    [selectedIds, allow]
  );
  const deleteSelectedTasks = () => {
    if (deletableSelectedIds.length === 0 || deleting) return;
    const ids = deletableSelectedIds;
    setSelectedIds(new Set());
    // Deferred delete: rows vanish now, the real delete fires after the undo
    // window, and "בטל" cancels it and restores the rows.
    const { undo } = softDeleteTasks(ids);
    const msg = ids.length === 1 ? 'המשימה נמחקה' : `${ids.length} משימות נמחקו`;
    onNotify?.(msg, 'success', 6000, { label: 'בטל', onClick: undo });
  };

  // ---------- Filter panel body (mirrors PreviousTasksTab; status + deadline + person) ----------
  const field = (mobile, label, seg) => (mobile
    ? <div className={bs.bField} key={label}><div className={bs.bFieldLabel}>{label}</div>{seg}</div>
    : seg);
  const valueChips = (col) => {
    const opts = col === 'person' ? personOptions : statusOptions;
    return (opts || []).filter((o) => filter[col].values.has(String(o.id))).map((o) => ({ color: o.color, text: o.label }));
  };
  const renderFilterRow = (col, i, mobile, openId, setOpenId) => {
    const fcfg = TASKS_FILTER_COLUMNS.find((c) => c.key === col);
    const colSeg = (
      <Segment id={`fcol-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={FILTER_TYPE_ICON[fcfg.type]} text={FILTER_COL_NAME[col]}
        options={TASKS_FILTER_COLUMNS.map((c) => ({
          key: c.key, label: FILTER_COL_NAME[c.key], icon: FILTER_TYPE_ICON[c.type],
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
        <Segment id={`fval-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle={FILTER_COL_NAME[col]} multi
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
      {filterRows.length < TASKS_FILTER_COLUMNS.length
        ? <button type="button" className={bs.bAddLink} onClick={addFilterRow}>+ New filter</button>
        : null}
    </>
  );

  if (loading) return (
    <div className={styles.skeletonStack}>{[1, 2, 3, 4].map(i => <Skeleton key={i} type="rectangle" height={36} fullWidth />)}</div>
  );

  // Handlers are always wired; per-field/per-task gating happens INSIDE
  // TaskTableRow via the `canTask` prop (each editor degrades to a display cell
  // when the user lacks that task's cap) and inside the apply* handlers (which
  // filter batch/bulk targets to the allowed subset). Selection is offered when
  // the user can act on at least one loaded task (edit any field OR delete);
  // while the feature is off this equals the legacy creator/lead/owner gate.
  const editHandlers = {
    onStatusChange: applyStatusChange,
    onPriorityChange: applyPriorityChange,
    onAssigneeChange: applyAssigneeChange,
    onDeadlineChange: applyDeadlineChange,
    onRenameTask: applyRename,
    // Optimistic-create error recovery (temp row whose create failed).
    onRetryCreate: retryCreate,
    onDismissRow: dismissRow,
  };
  const TASK_EDIT_CAPS = ['editTaskStatus', 'editTaskPriority', 'editTaskDeadline', 'editTaskAssignee', 'editTaskName', 'deleteTask'];
  const canSelect = items.some((t) => TASK_EDIT_CAPS.some((cap) => canTask(cap, t)));

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={styles.toolbar}>
        {/* One left-aligned cluster (like My Tasks): primary action, then group-by + collapse-all. */}
        <div className={styles.toolbarLeft}>
          {canCreateTask && (
            <Button kind={"primary"} size={"small"} onClick={onNewTask}>משימה חדשה</Button>
          )}
        </div>
        <div className={styles.toolbarRight}>
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
            options={GROUP_OPTIONS}
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
              always get the saved config applied to the tables below. */}
          {canManageSettings && (
            <HideColumnsControl
              columns={columnList}
              hidden={hiddenColumns}
              onToggle={toggleColumn}
              onToggleAll={showAllColumns}
              onSave={canSaveView ? saveHiddenColumns : null}
            />
          )}
          {groupBy !== 'none' && (
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
            <Button kind={"secondary"} size={"small"} loading={deleting} disabled={deleting || deletableSelectedIds.length === 0} onClick={deleteSelectedTasks}>
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

      <div className={styles.board}>
      <div className={styles.groupScrollInner}>
      <div className={styles.groupStack}>
        {grouped.length === 0 ? (
          <TaskTable tasks={[]}
            onInlineCreate={canCreateTask && onInlineCreateTask ? (name, opts) => onInlineCreateTask(name, opts) : undefined}
            onOpenNewTask={canCreateTask && !onInlineCreateTask ? () => onNewTask?.({}) : undefined}
            {...editHandlers} canTask={canTask} showPriority={showPriority} hiddenColumns={hiddenColumns} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings}
            selectable={canSelect} selectedIds={selectedIds} onToggleSelect={toggleSelect}
            selectAllChecked={false}
            selectAllIndeterminate={false}
            onToggleSelectAll={() => {}} />
        ) : grouped.map((grp) => {
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
                  className={`${styles.chevron} ${collapsed[grp.key] ? styles.chevronCollapsed : ''}`}
                  style={groupColor ? { color: groupColor } : undefined}
                />
                <span
                  className={styles.groupTitle}
                  style={{ color: groupColor || 'var(--secondary-text-color)' }}
                >
                  {grp.label}
                </span>
              </button>
            )}
            {!collapsed[grp.key] && (
              <TaskTable tasks={grp.items} color={groupColor}
                {...editHandlers} canTask={canTask} showPriority={showPriority} hiddenColumns={hiddenColumns} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings}
                reorderScope={discussionId ? `tasks_${discussionId}_${groupBy}_${grp.key}` : null}
                canReorderRows={canCreateTask}
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
                }}
                onInlineCreate={canCreateTask && onInlineCreateTask ? (name, opts) => onInlineCreateTask(name, opts) : undefined}
                inlineCreateDefaults={(() => {
                  const opts = {};
                  if (groupBy === 'status') opts.status = grp.status ?? null;
                  if (groupBy === 'person') opts.assignee = grp.assignee || [];
                  return opts;
                })()}
                onOpenNewTask={canCreateTask && !onInlineCreateTask ? () => {
                  const opts = {};
                  if (groupBy === 'status') opts.status = grp.status ?? null;
                  if (groupBy === 'person') opts.assignee = grp.assignee || [];
                  onNewTask?.(opts);
                } : undefined} />
            )}
          </div>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}
