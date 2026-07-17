import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton, Button, Checkbox } from '@vibe/core';
import { DropdownChevronDown, Filter } from '@vibe/icons';
import { SelectionActionBar } from '@generated/components/SelectionActionBar';
import { useColumnOrder } from '@generated/hooks/useColumnOrder.js';
import { ColumnHeaderDnd, SortableHeaderCell } from '@generated/components/SortableColumnHeader';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { SearchPill, matchesSearch } from '@generated/components/SearchPill';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { GroupByBuilder, GROUP_STATUS_ORDERS, GROUP_AZ_ORDERS, sortGroupsByOrder } from '@generated/components/GroupByBuilder';
// Varied stable group-title colors (owner request 2026-07-14) — shared engine.
import { ensureGroupColors } from '@generated/components/MyTasksView/grouping.js';
import { useGroupColors } from '@generated/hooks/useGroupColors.jsx';
import { SortByBuilder, SORT_STATUS_DIRS, SORT_DATE_DIRS, SORT_TEXT_DIRS } from '@generated/components/SortByBuilder';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '@generated/components/MyTasksView/controls/Segment.jsx';
import { BuilderIcon } from '@generated/components/MyTasksView/controls/BuilderIcon.jsx';
import { HideColumnsControl } from '@generated/components/MyTasksView/controls/HideColumnsControl.jsx';
import {
  filterTasks, filterCount, serializeFilter, sortTasks,
  FILTER_COLUMNS, FILTER_COLUMN_PERSON, OP_LABEL, DEADLINE_RANGES,
} from '@generated/components/MyTasksView/controls/controls.js';
import bs from '@generated/components/MyTasksView/controls/builder.module.css';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import { useFilterBuilder } from '@generated/hooks/useFilterBuilder.js';
import { useEscToClearSelection } from '@generated/hooks/useEscToClearSelection.js';
import { useBatchTargets } from '@generated/hooks/useBatchTargets.js';
import { useColumnWidths } from '@generated/hooks/useColumnWidths.js';
import { useViewport } from '@generated/hooks/useViewport.js';
import { ResizeHandle } from '@generated/components/ResizeHandle';
import { DECISIONS_COLUMN_WIDTHS as W } from '@generated/constants/columnWidths.js';
import { isValidStatus } from '@generated/constants/statusConfig';
import { getBoardId } from '@api/board-config-store.js';
import { useColumnRenameMenu } from '@generated/components/ColumnRenameMenu';
// Row-level building blocks — extracted to DecisionRow.jsx (round145 split):
// LabelPickerCell/DecisionRow live there; the tab renders groups via
// DecisionRows and the inline add-row.
import { DecisionRows, InlineAddDecisionRow } from './DecisionRow.jsx';
import styles from './DecisionsTab.module.css';


// DEFAULT column order for the decisions table (עדיפות removed — product
// decision). `name` (החלטה) is the pinned/frozen leading column; the rest
// resize AND reorder (owner drag) under the 'decisions' tableId (Round 7). A
// leading 'sel' checkbox column is prepended at the call site when selectable.
const DECISION_COLUMN_KEYS = ['name', 'decider', 'affected', 'status', 'date'];


// Group-by options for decisions — סטאטוס + מחליט (person). Mirrors the Tasks /
// Previous tabs' GroupByBuilder chrome (English structural labels, Hebrew column
// name in the segment).
const GROUP_OPTIONS = [
  { value: 'none', label: 'ללא קיבוץ' },
  { value: 'status', label: 'סטאטוס', icon: 'status', orders: GROUP_STATUS_ORDERS },
  { value: 'decider', label: 'מחליט', icon: 'person', orders: GROUP_AZ_ORDERS },
];
// Sort columns for the decisions table — החלטה (name) / סטאטוס / תאריך. `value`
// keys map to sortTasks() (deadline == the decision date); a decision is mapped
// to that shape before sorting (see sortedDecisions), mirroring the filter path.
const SORT_OPTIONS = [
  { value: 'name', label: 'החלטה', icon: 'text', dirs: SORT_TEXT_DIRS },
  { value: 'status', label: 'סטאטוס', icon: 'status', dirs: SORT_STATUS_DIRS },
  { value: 'deadline', label: 'תאריך', icon: 'date', dirs: SORT_DATE_DIRS },
];
const firstDecSortDir = (col) => (SORT_OPTIONS.find((o) => o.value === col) || SORT_OPTIONS[0])?.dirs?.[0]?.key;
const NO_STATUS = '__none__';
const NO_DECIDER = '__nodecider__';

// Client-side Filter columns for decisions: status + date + decider (person).
// The shared controls.js engine reads fixed field names (statusID /
// responsibilityID / deadlineID), so we map each decision to that shape before
// filtering (see `filterView` below) and match ids back. Reuses FILTER_COLUMNS'
// status + deadline configs and FILTER_COLUMN_PERSON for the person column.
const DEC_FILTER_COLUMNS = [
  FILTER_COLUMNS.find((c) => c.key === 'status'),
  FILTER_COLUMNS.find((c) => c.key === 'deadline'),
  FILTER_COLUMN_PERSON,
];
const DEC_FILTER_TYPE_ICON = { status: 'status', date: 'date', person: 'person' };
const DEC_FILTER_COL_NAME = { status: 'סטאטוס', deadline: 'תאריך', person: 'מחליט' };
const decRangeLabel = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.label || 'Choose a date range';
const decRangeIcon = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.icon || 'date';




/*
 * החלטות tab — monday-style decisions table for the current discussion.
 * `data` is the shared useDecisions() result (prefetched by DiscussionCard).
 * Editing is gated PER ROW via `canDecision(capId, decision)` (decision-tier
 * capabilities, mirroring TasksTab's canTask); `canCreateDecision` gates the
 * "החלטה חדשה" button and the add-row.
 *
 * ADD FLOW: the add-row is now an INLINE add (native monday "add item") — click
 * it, type a name, Enter creates the decision immediately via `onInlineCreate`
 * (wired to useDecisions.createDecision in DiscussionCard); the other columns
 * (מחליט/מושפעים/סטאטוס/תאריך) are filled inline on the new row afterward. The
 * "החלטה חדשה" toolbar button still opens the quick-create modal (secondary path)
 * via onNewDecision.
 *
 * ROUND 7 additions: whole-row drag-reorder (persisted per discussion+group via
 * useRowOrder — monday has no item-position API), owner column drag-reorder
 * (useColumnOrder, like TaskTable) + an editable "מחליט" cell, and multi-select
 * with a floating bulk-delete bar (mirrors TasksTab).
 */
export function DecisionsTab({ data, discussionId = null, onNewDecision, onInlineCreate, onNotify, canDecision = () => true, canCreateDecision = true, canReorderColumns = false, canManageSettings = false }) {
  const {
    items,
    loading,
    updateDecisionName,
    updateDecisionStatus,
    updateDecisionDate,
    updateDecisionAffected,
    updateDecisionDecider,
    softDeleteDecisions,
    retryCreate,
    dismissRow,
  } = data;

  // Status label set comes from the MAPPED decisions status column —
  // useStatusOptions never fires when the board/column is unmapped. (עדיפות was
  // removed from the table, so decisionPriorityID is no longer read here.)
  const statusOpts = useStatusOptions('decisions', 'decisionStatusID');

  // ---- Multi-select (Round 7) — a leading 'sel' checkbox column + a floating
  // bulk-action bar. Selection is offered when the user can act on at least one
  // loaded decision (edit any field OR delete); while permissions are off this
  // equals the legacy creator/decider/owner gate. ----
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const DEC_EDIT_CAPS = ['editDecisionStatus', 'editDecisionDate', 'editDecisionAffected', 'editDecisionName', 'deleteDecision'];
  const canSelect = items.some((d) => DEC_EDIT_CAPS.some((cap) => canDecision(cap, d)));

  // Owner-resizable + reorderable columns under the OWN 'decisions' tableId
  // (persisted per instance for all users). `name` is pinned/frozen (and 'sel'
  // when selectable); the rest resize + reorder. Owners on a non-touch viewport
  // get the drag handles; everyone gets the stored order/widths applied.
  const { isMobile } = useViewport();
  const baseKeys = useMemo(
    () => [...(canSelect ? ['sel'] : []), ...DECISION_COLUMN_KEYS],
    [canSelect]
  );
  const pinned = useMemo(() => (canSelect ? ['sel', 'name'] : ['name']), [canSelect]);
  const { order, reorder } = useColumnOrder('decisions', baseKeys, pinned);

  // Shared saved view (moved up so the round-47 Hide-columns state can read its
  // hiddenColumns at init; the group/sort/filter state below still reads it too).
  const { view: savedView, canSave: canSaveView, saveView } = useSavedViews('decisionsTab', { canManageSettings });

  // --- Hide columns (round 47) ------------------------------------------------
  // monday-style column show/hide, OWNER-gated (canManageSettings) at the render
  // site, persisted to the SHARED saved view
  // (settings.preferences.savedViews.decisionsTab.hiddenColumns) so an owner's
  // "Save to this view" applies for everyone. The primary name (החלטה) column is
  // never hideable; the leading selection track is not a listed column. Applied
  // at the render layer only — column order/width persistence is untouched.
  const columnList = [
    { key: 'name', label: 'החלטה', icon: 'text', locked: true },
    { key: 'decider', label: 'מחליט', icon: 'person' },
    { key: 'affected', label: 'מושפעים', icon: 'person' },
    { key: 'status', label: 'סטאטוס', icon: 'status' },
    { key: 'date', label: 'תאריך', icon: 'date' },
  ];
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

  // Drop hidden keys from the ORDER used to render (name + sel always kept). The
  // useColumnOrder input above stays on the full set, so a hidden column keeps
  // its stored order/width and returns in place when re-shown.
  const visibleOrder = useMemo(
    () => order.filter((k) => k === 'name' || k === 'sel' || !hiddenColumns.has(k)),
    [order, hiddenColumns]
  );
  const columnDefs = useMemo(
    () => visibleOrder.map((k) => (k === 'sel' ? { key: 'sel', fixed: 40 } : { key: k, ...W[k] })),
    [visibleOrder]
  );
  const { gridTemplate, startResize } = useColumnWidths('decisions', columnDefs);
  const canReorderCols = !!canReorderColumns && !isMobile;
  const canResize = canReorderCols;
  const rowStyle = useMemo(() => ({ gridTemplateColumns: gridTemplate }), [gridTemplate]);
  // Row-drag gate (same as selection: editors/creators; off on mobile). Reorder
  // is scoped per group, so it's fine in every group mode (within-group only).
  const canReorderRows = canSelect && !isMobile;
  const savedGroup = GROUP_OPTIONS.some((o) => o.value === savedView?.group?.col) ? savedView.group : null;
  const [groupBy, setGroupBy] = useState(savedGroup ? savedGroup.col : 'none');
  const [groupOrder, setGroupOrder] = useState(savedGroup?.order || 'labelAsc');
  const [collapsed, setCollapsed] = useState({});
  // Sort (client-side, over the loaded decisions; same saved-view contract as
  // the Tasks tab). Load-time = the shared saved sort; empty/inactive by default.
  const [sort, setSort] = useState(() => {
    const s = savedView?.sort;
    if (!s || !s.active || !SORT_OPTIONS.some((o) => o.value === s.col)) return { col: null, dir: null, active: false };
    return { col: s.col, dir: s.dir || firstDecSortDir(s.col), active: true };
  });
  // Filter opens with a default STATUS row (empty values ⇒ shows all) when no
  // saved view exists; a saved view's own rows win (incl. an explicitly empty set).
  // State + mutators come from the shared builder state machine (round137).
  const {
    filter, filterRows, setFilterOp, toggleFilterVal, setDeadlineRange, setDeadlineDate,
    addFilterRow, removeFilterRow, retargetFilterRow, clearFilter,
  } = useFilterBuilder({ columns: DEC_FILTER_COLUMNS, defaultRows: ['status'], savedView });
  // round132 — toolbar Search (shared SearchPill), client-side over the loaded decisions.
  const [search, setSearch] = useState('');

  // Map a decision to the shape controls.js' filter engine expects (statusID /
  // responsibilityID / deadlineID), so we can reuse filterTasks unchanged, then
  // match passing ids back to the real decisions. decider is the person column.
  const filterView = (d) => ({
    id: d.id,
    statusID: d.decisionStatusID,
    responsibilityID: Array.isArray(d.deciderID) ? d.deciderID : [],
    deadlineID: d.decisionDateID instanceof Date ? d.decisionDateID : null,
  });
  // Client pipeline: filter -> sort. Both reuse the shared controls.js engine by
  // mapping each decision to the { statusID, deadlineID, name } shape it expects
  // (decisionStatusID -> statusID, decisionDateID -> deadlineID), then matching
  // ids back to the real decisions. An inactive sort leaves the order untouched.
  const filteredDecisions = useMemo(() => {
    const fc = filterCount(filter);
    let list = items;
    if (fc > 0) {
      const passing = new Set(filterTasks(items.map(filterView), filter).map((v) => String(v.id)));
      list = items.filter((d) => passing.has(String(d.id)));
    }
    // round132 — toolbar Search (shared SearchPill): name "contains".
    if (search.trim()) list = list.filter((d) => matchesSearch(d.name, search));
    if (!sort.active || !sort.col) return list;
    const views = list.map((d) => ({
      id: d.id, name: d.name,
      statusID: d.decisionStatusID,
      deadlineID: d.decisionDateID instanceof Date ? d.decisionDateID : null,
    }));
    const orderIds = sortTasks(views, sort, { orderById: statusOpts.orderById, labelById: statusOpts.labelById })
      .map((v) => String(v.id));
    const byId = new Map(list.map((d) => [String(d.id), d]));
    return orderIds.map((id) => byId.get(id)).filter(Boolean);
  }, [items, filter, sort, statusOpts.orderById, statusOpts.labelById, search]);

  // Decider person options = the distinct deciders across the loaded decisions.
  const personOptions = useMemo(() => {
    const seen = new Map();
    (items || []).forEach((d) => (Array.isArray(d.deciderID) ? d.deciderID : []).forEach((p) => {
      if (p && p.id != null && !seen.has(String(p.id))) {
        seen.set(String(p.id), { id: String(p.id), label: p.name || String(p.id), color: null });
      }
    }));
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
  }, [items]);

  // Groups carry { key, label, color, items } — status groups key by the stable
  // label id and resolve label/color via useStatusOptions; decider groups key by
  // the sorted person-id set. (Same shape as the Tasks / Previous tabs.)
  // Right-click a group header → shared color palette (round 77).
  const { colorsByKey, openMenuFor, menu: groupColorMenu } = useGroupColors();
  const groupedRaw = useMemo(() => {
    if (groupBy === 'status') {
      const groups = new Map();
      filteredDecisions.forEach((d) => {
        const id = isValidStatus(d.decisionStatusID) && statusOpts.labelById[d.decisionStatusID] != null ? d.decisionStatusID : null;
        const key = id == null ? NO_STATUS : String(id);
        if (!groups.has(key)) groups.set(key, { key, statusId: id, items: [] });
        groups.get(key).items.push(d);
      });
      const list = [...groups.values()].map((g) => ({
        key: g.key,
        label: g.statusId == null ? 'ללא סטאטוס' : (statusOpts.labelById[g.statusId] ?? 'ללא סטאטוס'),
        color: g.statusId == null ? null : (statusOpts.colorById[g.statusId] || null),
        items: g.items,
      }));
      return ensureGroupColors(sortGroupsByOrder(list, { order: groupOrder, orderById: statusOpts.orderById, noKey: NO_STATUS }));
    }
    if (groupBy === 'decider') {
      const groups = new Map();
      filteredDecisions.forEach((d) => {
        const people = Array.isArray(d.deciderID) ? d.deciderID : [];
        const key = people.map((p) => String(p.id)).sort().join('|') || NO_DECIDER;
        const label = people.map((p) => p.name).filter(Boolean).join(', ') || 'ללא מחליט';
        if (!groups.has(key)) groups.set(key, { key, label: key, color: null, items: [] });
        groups.get(key).label = label;
        groups.get(key).items.push(d);
      });
      return ensureGroupColors(sortGroupsByOrder([...groups.values()], { order: groupOrder, noKey: NO_DECIDER }));
    }
    return [{ key: '__all__', label: '', color: null, items: filteredDecisions }];
  }, [filteredDecisions, groupBy, groupOrder, statusOpts.labelById, statusOpts.colorById, statusOpts.orderById]);
  // Apply the shared per-header color overrides as a final pass.
  const grouped = useMemo(() => ensureGroupColors(groupedRaw, colorsByKey), [groupedRaw, colorsByKey]);

  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed[g.key]);
  const toggleAll = () => {
    if (allCollapsed) setCollapsed({});
    else { const c = {}; grouped.forEach((g) => { c[g.key] = true; }); setCollapsed(c); }
  };

  // ---- Selection helpers (Round 7) ----
  const toggleSelect = (id, checked) =>
    setSelectedIds((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; });
  const clearSelection = () => setSelectedIds(new Set());
  // ESC clears this tab's multi-selection (shared hook — round135; guards:
  // visible view only, not while typing, not while an overlay is open).
  const rootRef = useRef(null);
  const hasSelection = selectedIds.size > 0;
  useEscToClearSelection(rootRef, hasSelection, clearSelection);
  // Drop selection ids that no longer exist (after a delete / refetch).
  const allIds = useMemo(() => items.map((d) => String(d.id)), [items]);
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const valid = new Set(allIds);
      const next = new Set();
      current.forEach((id) => { if (valid.has(String(id))) next.add(id); });
      return next.size === current.size ? current : next;
    });
  }, [allIds]);
  // Only the selected decisions the user may delete (mixed selection → the
  // allowed subset; a decision with no delete cap is silently skipped).
  const decById = useMemo(() => {
    const m = new Map(); items.forEach((d) => m.set(String(d.id), d)); return m;
  }, [items]);
  const deletableSelectedIds = useMemo(
    () => [...selectedIds].filter((id) => canDecision('deleteDecision', decById.get(String(id)))),
    [selectedIds, decById, canDecision]
  );
  const deleteSelected = () => {
    if (deletableSelectedIds.length === 0) return;
    const ids = deletableSelectedIds;
    setSelectedIds(new Set());
    const { undo } = softDeleteDecisions(ids);
    const msg = ids.length === 1 ? 'ההחלטה נמחקה' : `${ids.length} החלטות נמחקו`;
    onNotify?.(msg, 'success', 6000, { label: 'בטל', onClick: undo });
  };

  // Batch edit (Round 13): a column change on a SELECTED row applies to EVERY
  // selected row (monday behavior), mirroring TasksTab's resolveTargetIds — the
  // origin row alone unless it's part of a 2+ selection, then filtered to the
  // rows the user may edit for that capability. Single-row editing (nothing, or
  // only that row, selected) is unchanged. Applied per-row via the existing
  // optimistic single-row updaters (decisions have no dedicated batch endpoint,
  // same as TasksTab's priority path).
  // round143 — shared resolver; canDecision takes the ITEM, so adapt id→item.
  const resolveDecisionTargets = useBatchTargets(selectedIds, (cap, id) => canDecision(cap, decById.get(String(id))));
  const applyDecisionStatus = async (id, status) => {
    for (const t of resolveDecisionTargets(id, 'editDecisionStatus')) await updateDecisionStatus(t, status);
  };
  const applyDecisionDate = async (id, date) => {
    for (const t of resolveDecisionTargets(id, 'editDecisionDate')) await updateDecisionDate(t, date);
  };
  // מחליט + מושפעים are both gated by 'editDecisionAffected' (see DecisionRows'
  // deciderCanEdit), so batch decider/affected use that same capability.
  const applyDecisionDecider = async (id, people) => {
    for (const t of resolveDecisionTargets(id, 'editDecisionAffected')) await updateDecisionDecider(t, people);
  };
  const applyDecisionAffected = async (id, people) => {
    for (const t of resolveDecisionTargets(id, 'editDecisionAffected')) await updateDecisionAffected(t, people);
  };

  const fc = filterCount(filter);
  // Sort handlers (session-only until an owner hits Save, like the other builders).
  const onSortChange = ({ col, dir }) => setSort({ col, dir: dir || firstDecSortDir(col), active: true });
  const clearSort = () => setSort({ col: null, dir: null, active: false });

  // The decisions board is mapped MANUALLY in Settings (not wizard-created) —
  // unmapped is an EXPECTED state: render the empty state, fire nothing.
  const boardMapped = !!getBoardId('decisions');
  if (!boardMapped) {
    return (
      <div className={styles.decisionsRoot}>
        <div className={styles.decEmptyState}>לוח ההחלטות טרם הוגדר — מפו אותו בהגדרות</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.decSkeletonStack}>
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} type="rectangle" height={40} fullWidth />)}
      </div>
    );
  }

  // ---------- Filter panel body (mirrors the Tasks / Previous tabs) ----------
  const field = (mobile, label, seg) => (mobile
    ? <div className={bs.bField} key={label}><div className={bs.bFieldLabel}>{label}</div>{seg}</div>
    : seg);
  const valueChips = (col) => {
    const opts = col === 'person' ? personOptions : statusOpts.options;
    return (opts || []).filter((o) => filter[col].values.has(String(o.id))).map((o) => ({ color: o.color, text: o.label }));
  };
  const renderFilterRow = (col, i, mobile, openId, setOpenId) => {
    const fcfg = DEC_FILTER_COLUMNS.find((c) => c.key === col);
    const colSeg = (
      <Segment id={`fcol-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={DEC_FILTER_TYPE_ICON[fcfg.type]} text={DEC_FILTER_COL_NAME[col]}
        options={DEC_FILTER_COLUMNS.map((c) => ({
          key: c.key, label: DEC_FILTER_COL_NAME[c.key], icon: DEC_FILTER_TYPE_ICON[c.type],
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
            icon={f.range ? decRangeIcon(f.range) : 'date'} text={f.range ? decRangeLabel(f.range) : 'Choose a date range'} placeholder={!f.range}
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
      const opts = col === 'person' ? personOptions : statusOpts.options;
      valueCtl = (
        <Segment id={`fval-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle={DEC_FILTER_COL_NAME[col]} multi
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
      {filterRows.length === 0 ? <div className={bs.bEmpty}>No filters — showing all decisions</div> : null}
      {filterRows.length < DEC_FILTER_COLUMNS.length
        ? <button type="button" className={bs.bAddLink} onClick={addFilterRow}>+ New filter</button>
        : null}
    </>
  );

  // Header title per column key (name/decider/affected/status/date; 'sel' has none).
  const DEC_TITLE = { name: 'החלטה', decider: 'מחליט', affected: 'מושפעים', status: 'סטאטוס', date: 'תאריך' };
  // round140 — owner-only column display names (shared per-instance overrides).
  const { titles: decTitles, dots: decRenameDots, menu: decRenameMenu } =
    useColumnRenameMenu('decisions', DEC_TITLE, { canManageSettings, dotsClassName: styles.renameDots });
  const decRelStyle = canResize ? { position: 'relative' } : undefined;
  const decHandle = (key) => (canResize && key !== 'sel' ? <ResizeHandle onMouseDown={(e) => startResize(key, e)} /> : null);
  // Movable header cells = every VISIBLE column except the pinned name (+ sel).
  const movableColIds = visibleOrder.filter((k) => k !== 'name' && k !== 'sel');

  // Select-all checkbox state for ONE group's decisions.
  const groupSelectState = (list) => {
    const total = list.length;
    const sel = list.reduce((n, d) => n + (selectedIds.has(d.id) ? 1 : 0), 0);
    return { allChecked: total > 0 && sel === total, indeterminate: sel > 0 && sel < total };
  };
  const toggleSelectGroup = (list, checked) => setSelectedIds((prev) => {
    const next = new Set(prev);
    list.forEach((d) => { if (checked) next.add(d.id); else next.delete(d.id); });
    return next;
  });

  const renderHeadCell = (key, list) => {
    if (key === 'sel') {
      const { allChecked, indeterminate } = groupSelectState(list);
      return (
        <div key="sel" className={`${styles.decCell} ${styles.decHeadCell} ${styles.decSelectCell}`} onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={allChecked}
            indeterminate={indeterminate}
            onChange={(e) => toggleSelectGroup(list, e.target.checked)}
            ariaLabel={allChecked ? 'בטל בחירת קבוצה' : 'בחר את כל הקבוצה'}
          />
        </div>
      );
    }
    if (key === 'name') {
      // Frozen name header — sticky (own positioning context) so it pins during
      // horizontal scroll AND hosts the resize handle (like TaskTable .taskFirst).
      return (
        <div key="name" className={`${styles.decCell} ${styles.decHeadCell} ${styles.decNameHead}`}>
          {decTitles.name}
          {decRenameDots('name')}
          {decHandle('name')}
        </div>
      );
    }
    const inner = (<>{decTitles[key]}{decRenameDots(key)}{decHandle(key)}</>);
    return canReorderCols ? (
      <SortableHeaderCell key={key} id={key} className={`${styles.decCell} ${styles.decHeadCell}`} style={decRelStyle}>{inner}</SortableHeaderCell>
    ) : (
      <div key={key} className={`${styles.decCell} ${styles.decHeadCell}`} style={decRelStyle}>{inner}</div>
    );
  };

  // Reusable table box for one group's decisions (header + rows). The add-row is
  // rendered only on the LAST group (or when ungrouped) so there's a single add
  // affordance at the bottom. `scopeKey` identifies this group's row order.
  const renderDecisionTable = (list, showAddRow, scopeKey) => (
    <div className={`${styles.decTable} ${canSelect ? styles.decSelectable : ''}`}>
      <div className={`${styles.decRow} ${styles.decHead}`} style={rowStyle}>
        <ColumnHeaderDnd enabled={canReorderCols} ids={movableColIds} labels={decTitles} onReorder={reorder}>
          {visibleOrder.map((k) => renderHeadCell(k, list))}
        </ColumnHeaderDnd>
      </div>

      <DecisionRows
        list={list}
        scope={discussionId && scopeKey ? `decisions_${discussionId}_${scopeKey}` : null}
        canReorderRows={canReorderRows}
        columns={visibleOrder}
        selectable={canSelect}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        statusOpts={statusOpts}
        canDecision={canDecision}
        updateDecisionName={updateDecisionName}
        updateDecisionStatus={applyDecisionStatus}
        updateDecisionDate={applyDecisionDate}
        updateDecisionDecider={applyDecisionDecider}
        updateDecisionAffected={applyDecisionAffected}
        onRetryCreate={retryCreate}
        onDismissRow={dismissRow}
        rowStyle={rowStyle}
      />

      {showAddRow && canCreateDecision && (
        onInlineCreate ? (
          <InlineAddDecisionRow onCreate={onInlineCreate} />
        ) : (
          <button type="button" className={styles.decAddRow} onClick={() => onNewDecision?.()}>
            <span className={styles.decAddRowInner}>+ הוסף החלטה</span>
          </button>
        )
      )}
    </div>
  );

  const isGrouped = groupBy !== 'none';

  return (
    <div ref={rootRef} className={styles.decisionsRoot}>
      {groupColorMenu}
      {decRenameMenu}
      <div className={styles.decToolbar}>
        <div className={styles.decToolbarLeft}>
          {canCreateDecision && (
            <Button kind={"primary"} size={"small"} onClick={() => onNewDecision?.()}>החלטה חדשה</Button>
          )}
        </div>
        <div className={styles.decToolbarRight}>
          <SearchPill value={search} onChange={setSearch} />
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
              always get the saved config applied to the decisions table. */}
          {canManageSettings && (
            <HideColumnsControl
              columns={columnList}
              hidden={hiddenColumns}
              onToggle={toggleColumn}
              onToggleAll={showAllColumns}
              onSave={canSaveView ? saveHiddenColumns : null}
            />
          )}
          {isGrouped && filteredDecisions.length > 0 && (
            <CollapseAllButton collapsed={allCollapsed} onClick={toggleAll} />
          )}
        </div>
      </div>

      <SelectionActionBar count={selectedIds.size} onClear={clearSelection} ariaLabel="פעולות על החלטות נבחרות">
        <Button kind={"secondary"} size={"small"} disabled={deletableSelectedIds.length === 0} onClick={deleteSelected}>
          מחיקה
        </Button>
      </SelectionActionBar>

      <div className={styles.decBoard}>
        {items.length === 0 && !canCreateDecision ? (
          <div className={styles.decEmptyRow}>אין החלטות עדיין</div>
        ) : !isGrouped ? (
          renderDecisionTable(filteredDecisions, true, `${groupBy}_all`)
        ) : (
          grouped.map((grp, gi) => (
            <div key={grp.key} className={styles.decGroup}>
              {grp.label && (
                <button type="button" onClick={() => setCollapsed((p) => ({ ...p, [grp.key]: !p[grp.key] }))}
                  onContextMenu={(e) => openMenuFor(grp.key, e)}
                  className={styles.decGroupHeader}>
                  <DropdownChevronDown
                    className={`${styles.decGroupChevron} ${collapsed[grp.key] ? styles.decGroupChevronCollapsed : ''}`}
                    style={grp.color ? { color: grp.color } : undefined}
                  />
                  <span className={styles.decGroupTitle} style={grp.color ? { color: grp.color } : undefined}>{grp.label}</span>
                </button>
              )}
              {!collapsed[grp.key] && renderDecisionTable(grp.items, gi === grouped.length - 1, `${groupBy}_${grp.key}`)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}



export default DecisionsTab;
