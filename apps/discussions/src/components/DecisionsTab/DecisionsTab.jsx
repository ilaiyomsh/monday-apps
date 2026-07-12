import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton, Button, Dialog, DialogContentContainer, Checkbox, Text } from '@vibe/core';
import { DropdownChevronDown, Filter, CloseSmall, Update, Edit } from '@vibe/icons';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableRow } from '@generated/components/SortableRow';
import { useColumnOrder } from '@generated/hooks/useColumnOrder.js';
import { useRowOrder } from '@generated/hooks/useRowOrder.js';
import { ColumnHeaderDnd, SortableHeaderCell } from '@generated/components/SortableColumnHeader';
import { X, Plus } from 'lucide-react';
import { PersonAvatar, PersonList } from '@generated/components/PersonAvatar';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { GroupByBuilder, GROUP_STATUS_ORDERS, GROUP_AZ_ORDERS, sortGroupsByOrder } from '@generated/components/GroupByBuilder';
import { SortByBuilder, SORT_STATUS_DIRS, SORT_DATE_DIRS, SORT_TEXT_DIRS } from '@generated/components/SortByBuilder';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '@generated/components/MyTasksView/controls/Segment.jsx';
import { BuilderIcon } from '@generated/components/MyTasksView/controls/BuilderIcon.jsx';
import { HideColumnsControl } from '@generated/components/MyTasksView/controls/HideColumnsControl.jsx';
import {
  filterTasks, filterCount, emptyFilter, serializeFilter, deserializeFilter, sortTasks,
  FILTER_COLUMNS, FILTER_COLUMN_PERSON, OP_LABEL, DEADLINE_RANGES,
} from '@generated/components/MyTasksView/controls/controls.js';
import bs from '@generated/components/MyTasksView/controls/builder.module.css';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import { useColumnWidths } from '@generated/hooks/useColumnWidths.js';
import { useViewport } from '@generated/hooks/useViewport.js';
import { ResizeHandle } from '@generated/components/ResizeHandle';
import { DECISIONS_COLUMN_WIDTHS as W } from '@generated/constants/columnWidths.js';
import { isValidStatus } from '@generated/constants/statusConfig';
import { getBoardId } from '@api/board-config-store.js';
import { monday } from '@api/monday-client.js';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import styles from './DecisionsTab.module.css';

// Open a decision's item card on the Updates pane — identical affordance to the
// Tasks name cell (kind:'updates' renders monday's side panel). A decision is a
// board item, so decision.id is a real monday item id; guard the temp id of an
// optimistic (not-yet-saved) decision so it never targets a bogus id.
function openItemCard(itemId) {
  if (!itemId || String(itemId).startsWith('temp-')) return;
  monday.execute('openItemCard', { itemId: Number(itemId), kind: 'updates' });
}

// DEFAULT column order for the decisions table (עדיפות removed — product
// decision). `name` (החלטה) is the pinned/frozen leading column; the rest
// resize AND reorder (owner drag) under the 'decisions' tableId (Round 7). A
// leading 'sel' checkbox column is prepended at the call site when selectable.
const DECISION_COLUMN_KEYS = ['name', 'decider', 'affected', 'status', 'date'];

const NEUTRAL = 'hsl(var(--status-default))';

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

// dd/mm for the תאריך column (mockup format; DatePickerPopover's default is
// DD/MM/YYYY so we pass this via its formatDate prop).
function formatDayMonth(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/*
 * Inline label picker cell shared by the סטאטוס (full-fill) and עדיפות (pill)
 * columns. Mirrors TaskTableRow's Dialog pattern: opens upward by default
 * (flips when there's no room) and AUTO-CLOSES on select — both via the
 * explicit setOpen(false) in the option's onClick and via the
 * 'onContentClick' hideTrigger (the recent TasksTab auto-close behavior).
 * Options/labels/colors come from the MAPPED status column (useStatusOptions),
 * never hardcoded. When the picker isn't editable (or the column has no
 * options because it's unmapped) it degrades to a display-only cell.
 */
function LabelPickerCell({ value, opts, canEdit, onPick, pill = false, placeholder }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('top-start');
  const triggerRef = useRef(null);

  const label = opts.labelById[value];
  const hasValue = isValidStatus(value) && label != null;
  const fill = hasValue ? (opts.colorById[value] || NEUTRAL) : null;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'top-start',
      popupWidth: 184,
      popupHeight: Math.max(180, (opts.options?.length || 0) * 46 + 24),
      offset: 4,
    });
    if (next?.placement) setPosition(next.placement);
  };

  const display = pill ? (
    hasValue ? (
      <span className={`${styles.decPill} ${styles.decPillFilled}`} style={{ background: fill }}>{label}</span>
    ) : (
      <span className={styles.decPill}>{placeholder}</span>
    )
  ) : hasValue ? (
    <span className={styles.decFill} style={{ background: fill }}>{label}</span>
  ) : (
    <span className={styles.decFillEmpty}>{placeholder}</span>
  );

  // Editable only with the capability AND an actual label set to pick from
  // (an unmapped column yields zero options — degrade to display).
  if (!canEdit || (opts.options?.length || 0) === 0) return display;

  return (
    <Dialog
      open={open}
      showTrigger={['click']}
      hideTrigger={['clickoutside', 'esc', 'onContentClick']}
      onDialogDidShow={() => { updatePosition(); setOpen(true); }}
      onDialogDidHide={() => setOpen(false)}
      position={position}
      zIndex={10000}
      content={() => (
        <DialogContentContainer>
          <div className={styles.decMenu}>
            {(opts.options || []).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={styles.decMenuOption}
                style={{ background: opt.color || NEUTRAL }}
                onClick={() => { onPick(opt.id); setOpen(false); }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </DialogContentContainer>
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        className={pill ? styles.decPillTrigger : styles.decFillTrigger}
        onMouseDown={updatePosition}
      >
        {display}
      </button>
    </Dialog>
  );
}

function DecisionRow({
  decision, statusOpts, can, onRename, onStatus, onDate, onDecider, onAffected, rowStyle,
  // Optimistic-create error affordance (a temp row whose create failed): retry
  // re-runs the create; dismiss removes the row locally.
  onRetryCreate, onDismissRow,
  deciderCanEdit = false, deciderPickerProps,
  // Ordered column keys (incl. 'sel'/'name'), supplied by DecisionsTab so header
  // and body honor the same drag-reorder order.
  columns,
  // Selection (Round 7 multi-select) — a leading checkbox cell when selectable.
  selectable = false, selected = false, onToggleSelect,
  // Whole-row drag-reorder (Round 7) — ride the sortable bits onto the row root.
  dragRef, dragStyle, dragProps,
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(decision.name || '');

  // A freshly-added decision still carrying a temp id has no monday item yet, but
  // it is FULLY EDITABLE right away — edits are queued in useDecisions and flushed
  // when the real id arrives. `pending` now only drives aria-busy (no locking).
  const pending = String(decision.id).startsWith('temp-');
  // Background create failed: keep the row (never silently drop it) and show a
  // clear error + retry/dismiss affordance instead of a blocked/faded row.
  const failed = decision._createFailed === true;

  const deciderPeople = Array.isArray(decision.deciderID) ? decision.deciderID : [];
  const affected = Array.isArray(decision.affectedID) ? decision.affectedID : [];
  const date = decision.decisionDateID instanceof Date ? decision.decisionDateID : null;

  const canRename = can('editDecisionName', decision);

  const startEditName = () => {
    if (!canRename) return;
    setNameDraft(decision.name || '');
    setEditingName(true);
  };
  const saveName = () => {
    const t = nameDraft.trim();
    if (t && t !== decision.name) onRename(decision.id, t);
    setEditingName(false);
  };

  const cellByKey = {
    // selection checkbox (multi-select tabs only) — pinned leading cell
    sel: (
      <div key="sel" className={`${styles.decCell} ${styles.decSelectCell}`} onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onChange={(e) => onToggleSelect?.(decision.id, e.target.checked)}
          ariaLabel={`בחר החלטה ${decision.name}`}
        />
      </div>
    ),
    // החלטה — inset purple accent bar, inline rename (gated), hover delete
    name: (
      <div key="name" className={`${styles.decCell} ${styles.decNameCell}`}>
        {editingName ? (
          <input
            className={styles.decNameInput}
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveName(); }
              if (e.key === 'Escape') { setEditingName(false); }
            }}
            onBlur={saveName}
          />
        ) : canRename ? (
          <button
            type="button"
            className={styles.decNameBtn}
            onClick={startEditName}
            title={decision.name}
            aria-label={`ערוך החלטה: ${decision.name}`}
          >
            {decision.name}
          </button>
        ) : (
          <span className={styles.decNameText} title={decision.name}>{decision.name}</span>
        )}
        {/* Hover rename pencil — same inline rename as clicking the name, made
            explicit + discoverable on every row (mirrors the tasks pencil). */}
        {canRename && !editingName && (
          <button
            type="button"
            className={styles.decRenameBtn}
            title="עריכת שם"
            aria-label={`ערוך החלטה: ${decision.name}`}
            onClick={(e) => { e.stopPropagation(); startEditName(); }}
          >
            <Edit size={16} />
          </button>
        )}
        {failed && (
          <span className={styles.decCreateFailedActions} onClick={(e) => e.stopPropagation()}>
            <span className={styles.decCreateFailedText}>שמירה נכשלה</span>
            {onRetryCreate && (
              <button
                type="button"
                className={styles.decRetryBtn}
                onClick={(e) => { e.stopPropagation(); onRetryCreate(decision.id); }}
              >
                נסה שוב
              </button>
            )}
            {onDismissRow && (
              <button
                type="button"
                className={styles.decDismissBtn}
                onClick={(e) => { e.stopPropagation(); onDismissRow(decision.id); }}
                aria-label="הסר שורה"
                title="הסר"
              >
                <X size={14} />
              </button>
            )}
          </span>
        )}
        {/* monday "updates" speech-bubble icon at the trailing edge of the name
            cell — identical affordance to the Tasks name cell (opens the
            decision's item card on the Updates pane). */}
        <button
          type="button"
          className={styles.decUpdatesBtn}
          title="עדכונים"
          aria-label="פתח עדכונים"
          onClick={(e) => { e.stopPropagation(); openItemCard(decision.id); }}
        >
          <Update size={18} />
        </button>
      </div>
    ),
    // מחליט — single-person picker when editable (Round 7: was display-only, so
    // the decider couldn't be changed after creation); read-only avatar otherwise.
    decider: (
      <div key="decider" className={styles.decCell} onClick={(e) => e.stopPropagation()}>
        {deciderCanEdit ? (
          <PersonPicker
            selected={deciderPeople}
            onChange={(people) => onDecider(decision.id, people)}
            single
            closeOnSelect
            boardKey="decisions"
            {...(deciderPickerProps || {})}
          />
        ) : deciderPeople.length > 0 ? (
          <PersonAvatar person={deciderPeople[0]} showName={false} />
        ) : (
          <span className={styles.decMuted}>—</span>
        )}
      </div>
    ),
    // מושפעים — up to 3 overlapping avatars + "+N"; PersonPicker when editable
    affected: (
      <div key="affected" className={styles.decCell} onClick={(e) => e.stopPropagation()}>
        {can('editDecisionAffected', decision) ? (
          <PersonPicker
            selected={affected}
            onChange={(people) => onAffected(decision.id, people)}
            boardKey="decisions"
          />
        ) : (
          <PersonList people={affected} size="sm" showNames={false} max={3} />
        )}
      </div>
    ),
    // סטאטוס — full-fill cell + inline picker (auto-closes on select)
    status: (
      <div key="status" className={`${styles.decCell} ${styles.decStatusCell}`}>
        <LabelPickerCell
          value={decision.decisionStatusID}
          opts={statusOpts}
          canEdit={can('editDecisionStatus', decision)}
          onPick={(id) => onStatus(decision.id, id)}
          placeholder="בחר סטאטוס"
        />
      </div>
    ),
    // תאריך — dd/mm; DatePickerPopover when editable
    date: (
      <div key="date" className={styles.decCell} onClick={(e) => e.stopPropagation()}>
        {can('editDecisionDate', decision) ? (
          <DatePickerPopover
            value={date}
            onChange={(d) => onDate(decision.id, d)}
            formatDate={formatDayMonth}
          />
        ) : date ? (
          <span className={styles.decMuted}>{formatDayMonth(date)}</span>
        ) : (
          <span className={styles.decMuted}>—</span>
        )}
      </div>
    ),
  };

  const orderedKeys = columns || [
    ...(selectable ? ['sel'] : []),
    'name', 'decider', 'affected', 'status', 'date',
  ];

  return (
    <div
      ref={dragRef}
      className={`${styles.decRow} ${styles.decBodyRow} ${failed ? styles.decCreateFailed : ''} ${dragProps ? styles.decDraggable : ''}`}
      style={dragStyle ? { ...rowStyle, ...dragStyle } : rowStyle}
      aria-busy={(pending && !failed) || undefined}
      {...(dragProps || {})}
    >
      {orderedKeys.map((k) => cellByKey[k]).filter(Boolean)}
    </div>
  );
}

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
  const [filter, setFilter] = useState(() => (savedView?.filter ? deserializeFilter(savedView.filter) : emptyFilter()));
  // Filter opens with a default STATUS row (empty values ⇒ shows all) when no
  // saved view exists; a saved view's own rows win (incl. an explicitly empty set).
  const [filterRows, setFilterRows] = useState(() => (
    Array.isArray(savedView?.filterRows)
      ? savedView.filterRows.filter((k) => DEC_FILTER_COLUMNS.some((c) => c.key === k))
      : ['status']
  ));

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
  }, [items, filter, sort, statusOpts.orderById, statusOpts.labelById]);

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
  const grouped = useMemo(() => {
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
      return sortGroupsByOrder(list, { order: groupOrder, orderById: statusOpts.orderById, noKey: NO_STATUS });
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
      return sortGroupsByOrder([...groups.values()], { order: groupOrder, noKey: NO_DECIDER });
    }
    return [{ key: '__all__', label: '', color: null, items: filteredDecisions }];
  }, [filteredDecisions, groupBy, groupOrder, statusOpts.labelById, statusOpts.colorById, statusOpts.orderById]);

  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed[g.key]);
  const toggleAll = () => {
    if (allCollapsed) setCollapsed({});
    else { const c = {}; grouped.forEach((g) => { c[g.key] = true; }); setCollapsed(c); }
  };

  // ---- Selection helpers (Round 7) ----
  const toggleSelect = (id, checked) =>
    setSelectedIds((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; });
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
  const resolveDecisionTargets = (originId, cap) => {
    const base = selectedIds.size > 1 && selectedIds.has(originId) ? [...selectedIds] : [originId];
    return cap ? base.filter((id) => canDecision(cap, decById.get(String(id)))) : base;
  };
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

  // Filter mutators (mirror the Tasks / Previous tabs).
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
    const next = DEC_FILTER_COLUMNS.map((c) => c.key).find((k) => !rows.includes(k));
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
          {DEC_TITLE.name}
          {decHandle('name')}
        </div>
      );
    }
    const inner = (<>{DEC_TITLE[key]}{decHandle(key)}</>);
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
        <ColumnHeaderDnd enabled={canReorderCols} ids={movableColIds} labels={DEC_TITLE} onReorder={reorder}>
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
      <div className={styles.decToolbar}>
        <div className={styles.decToolbarLeft}>
          {canCreateDecision && (
            <Button kind={"primary"} size={"small"} onClick={() => onNewDecision?.()}>החלטה חדשה</Button>
          )}
        </div>
        <div className={styles.decToolbarRight}>
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

      {/* Floating bulk-action bar (Round 7) — mirrors TasksTab's action bar:
          left = selected count, center = actions (delete), right = close/X. */}
      {selectedIds.size > 0 && (
        <div className={styles.decActionBar} role="region" aria-label="פעולות על החלטות נבחרות">
          <div className={styles.decActionBarLeft}>
            <Text type={"text2"} element="span">{selectedIds.size} נבחרו</Text>
          </div>
          <div className={styles.decActionBarCenter}>
            <Button kind={"secondary"} size={"small"} disabled={deletableSelectedIds.length === 0} onClick={deleteSelected}>
              מחיקה
            </Button>
          </div>
          <div className={styles.decActionBarRight}>
            <button type="button" className={styles.decCloseSelectionBtn} onClick={clearSelection} aria-label="בטל בחירה">
              <CloseSmall size={18} />
            </button>
          </div>
        </div>
      )}

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

/*
 * One group's decision rows, wrapped in a dnd-kit sortable context for whole-row
 * drag-reorder (Round 7). Split into its own component so it can call the
 * useRowOrder hook legally (groups are dynamic). When reorder is disabled it
 * renders the rows plainly (no DnD wrapper).
 */
function DecisionRows({
  list, scope, canReorderRows, columns, selectable, selectedIds, onToggleSelect,
  statusOpts, canDecision, updateDecisionName, updateDecisionStatus, updateDecisionDate,
  updateDecisionDecider, updateDecisionAffected, rowStyle,
  onRetryCreate, onDismissRow,
}) {
  const enabled = !!scope && !!canReorderRows;
  const { order: rowOrderIds, orderList, onDragEnd } = useRowOrder(scope, list, { enabled });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const displayList = enabled ? orderList : list;

  const renderRow = (d, drag) => (
    <DecisionRow
      key={d.id}
      decision={d}
      columns={columns}
      statusOpts={statusOpts}
      can={canDecision}
      onRename={updateDecisionName}
      onStatus={updateDecisionStatus}
      onDate={updateDecisionDate}
      onDecider={updateDecisionDecider}
      onAffected={updateDecisionAffected}
      onRetryCreate={onRetryCreate}
      onDismissRow={onDismissRow}
      rowStyle={rowStyle}
      deciderCanEdit={canDecision('editDecisionAffected', d)}
      selectable={selectable}
      selected={selectable ? !!selectedIds?.has(d.id) : false}
      onToggleSelect={onToggleSelect}
      dragRef={drag?.setNodeRef}
      dragStyle={drag?.style}
      dragProps={drag ? { ...drag.attributes, ...drag.listeners } : undefined}
    />
  );

  if (!enabled) return <>{displayList.map((d) => renderRow(d, null))}</>;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={rowOrderIds} strategy={verticalListSortingStrategy}>
        {displayList.map((d) => (
          <SortableRow key={d.id} id={d.id} disabled={String(d.id).startsWith('temp-')}>
            {(drag) => renderRow(d, drag)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

// Inline add-row for the Decisions tab: at rest it's the "+ הוסף החלטה"
// affordance; clicking swaps in a borderless inline input (mirrors the Topics
// add-point / Tasks add-task rows). Name + Enter creates the decision with just
// a name (מחליט defaults to the current user + מושפעים to participants inside
// the hook); the rest is filled inline on the new row. Focus stays for rapid
// entry; Escape / empty-blur collapses back to the label.
function InlineAddDecisionRow({ onCreate }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setText('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={styles.decAddRow}
        onClick={() => { setEditing(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
      >
        <span className={styles.decAddRowInner}>+ הוסף החלטה</span>
      </button>
    );
  }

  return (
    <div className={styles.decAddRow}>
      <span className={styles.decAddRowInner}>
        <Plus size={16} className={styles.decAddIcon} />
        <input
          ref={inputRef}
          className={styles.decAddInput}
          autoFocus
          value={text}
          placeholder="החלטה…"
          aria-label="החלטה חדשה"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setText(''); setEditing(false); e.currentTarget.blur(); }
          }}
          onBlur={() => { if (!text.trim()) setEditing(false); }}
        />
      </span>
    </div>
  );
}

export default DecisionsTab;
