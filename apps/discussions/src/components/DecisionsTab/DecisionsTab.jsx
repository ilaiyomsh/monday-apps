import React, { useMemo, useRef, useState } from 'react';
import { Skeleton, Button, Dialog, DialogContentContainer } from '@vibe/core';
import { DropdownChevronDown, Filter } from '@vibe/icons';
import { Trash2, Check, X, Plus } from 'lucide-react';
import { PersonAvatar, PersonList } from '@generated/components/PersonAvatar';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { CollapseAllButton } from '@generated/components/CollapseAllButton';
import { GroupByBuilder, GROUP_STATUS_ORDERS, GROUP_AZ_ORDERS, sortGroupsByOrder } from '@generated/components/GroupByBuilder';
import { BuilderControl } from '@generated/components/MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '@generated/components/MyTasksView/controls/Segment.jsx';
import { BuilderIcon } from '@generated/components/MyTasksView/controls/BuilderIcon.jsx';
import {
  filterTasks, filterCount, emptyFilter, serializeFilter, deserializeFilter,
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
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import styles from './DecisionsTab.module.css';

// Column order for the decisions table (עדיפות removed — product decision).
// `name` (החלטה) is a FILL track; the rest resize under the 'decisions' tableId.
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
      zIndex={1000}
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

function DecisionRow({ decision, statusOpts, can, onRename, onStatus, onDate, onAffected, onDelete, rowStyle }) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(decision.name || '');
  const [confirmDel, setConfirmDel] = useState(false);

  // Optimistic row whose monday item isn't saved yet (useDecisions temp id):
  // faded + locked until createDecision swaps in the server id (mirrors
  // TaskTableRow's pending state).
  const pending = String(decision.id).startsWith('temp-');

  const deciderPeople = Array.isArray(decision.deciderID) ? decision.deciderID : [];
  const affected = Array.isArray(decision.affectedID) ? decision.affectedID : [];
  const date = decision.decisionDateID instanceof Date ? decision.decisionDateID : null;

  const canRename = can('editDecisionName', decision);
  const canDelete = can('deleteDecision', decision);

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

  return (
    <div className={`${styles.decRow} ${styles.decBodyRow} ${pending ? styles.decPending : ''}`} style={rowStyle} aria-busy={pending || undefined}>
      {/* החלטה — inset purple accent bar, inline rename (gated), hover delete */}
      <div className={`${styles.decCell} ${styles.decNameCell}`}>
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
        {canDelete && (
          confirmDel ? (
            <span className={styles.decConfirmDel} onClick={(e) => e.stopPropagation()}>
              <span className={styles.decConfirmText}>למחוק?</span>
              <button
                type="button"
                className={`${styles.decConfirmBtn} ${styles.decConfirmYes}`}
                onClick={(e) => { e.stopPropagation(); setConfirmDel(false); onDelete(decision.id); }}
                aria-label="אישור מחיקה"
                title="אישור"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                className={styles.decConfirmBtn}
                onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }}
                aria-label="ביטול מחיקה"
                title="ביטול"
              >
                <X size={14} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={styles.decDeleteBtn}
              onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }}
              aria-label="מחק החלטה"
              title="מחק החלטה"
            >
              <Trash2 size={18} />
            </button>
          )
        )}
      </div>

      {/* מחליט — single avatar (display-only; no edit capability for decider) */}
      <div className={styles.decCell}>
        {deciderPeople.length > 0 ? (
          <PersonAvatar person={deciderPeople[0]} showName={false} />
        ) : (
          <span className={styles.decMuted}>—</span>
        )}
      </div>

      {/* מושפעים — up to 3 overlapping avatars + "+N"; PersonPicker when editable */}
      <div className={styles.decCell}>
        {can('editDecisionAffected', decision) ? (
          <PersonPicker
            selected={affected}
            onChange={(people) => onAffected(decision.id, people)}
          />
        ) : (
          <PersonList people={affected} size="sm" showNames={false} max={3} />
        )}
      </div>

      {/* סטאטוס — full-fill cell + inline picker (auto-closes on select) */}
      <div className={`${styles.decCell} ${styles.decStatusCell}`}>
        <LabelPickerCell
          value={decision.decisionStatusID}
          opts={statusOpts}
          canEdit={can('editDecisionStatus', decision)}
          onPick={(id) => onStatus(decision.id, id)}
          placeholder="בחר סטאטוס"
        />
      </div>

      {/* תאריך — dd/mm; DatePickerPopover when editable */}
      <div className={styles.decCell}>
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
 * via onNewDecision. Selection / bulk actions are deliberately NOT part of v1.
 */
export function DecisionsTab({ data, onNewDecision, onInlineCreate, onNotify, canDecision = () => true, canCreateDecision = true, canReorderColumns = false, canManageSettings = false }) {
  const {
    items,
    loading,
    updateDecisionName,
    updateDecisionStatus,
    updateDecisionDate,
    updateDecisionAffected,
    softDeleteDecisions,
  } = data;

  // Status label set comes from the MAPPED decisions status column —
  // useStatusOptions never fires when the board/column is unmapped. (עדיפות was
  // removed from the table, so decisionPriorityID is no longer read here.)
  const statusOpts = useStatusOptions('decisions', 'decisionStatusID');

  // Owner-resizable columns under the OWN 'decisions' tableId (persisted per
  // instance for all users). `name` is a fill track; the rest are fixed-px
  // resizable. Owners on a non-touch viewport get the drag handles; everyone
  // gets the stored widths applied. Header + rows share this one grid template.
  const { isMobile } = useViewport();
  const columnDefs = useMemo(
    () => DECISION_COLUMN_KEYS.map((k) => ({ key: k, ...W[k] })),
    []
  );
  const { gridTemplate, startResize } = useColumnWidths('decisions', columnDefs);
  const canResize = !!canReorderColumns && !isMobile;
  const rowStyle = useMemo(() => ({ gridTemplateColumns: gridTemplate }), [gridTemplate]);

  // ---- Filter + Group by (client-side, over the loaded decisions; same
  // builder UI as the Tasks / Previous tabs). Load-time state = the shared saved
  // view; in-session changes are local until someone with permission hits Save. ----
  const { view: savedView, canSave: canSaveView, saveView } = useSavedViews('decisionsTab', { canManageSettings });
  const savedGroup = GROUP_OPTIONS.some((o) => o.value === savedView?.group?.col) ? savedView.group : null;
  const [groupBy, setGroupBy] = useState(savedGroup ? savedGroup.col : 'none');
  const [groupOrder, setGroupOrder] = useState(savedGroup?.order || 'labelAsc');
  const [collapsed, setCollapsed] = useState({});
  const [filter, setFilter] = useState(() => (savedView?.filter ? deserializeFilter(savedView.filter) : emptyFilter()));
  const [filterRows, setFilterRows] = useState(() => (
    Array.isArray(savedView?.filterRows)
      ? savedView.filterRows.filter((k) => DEC_FILTER_COLUMNS.some((c) => c.key === k))
      : []
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
  const filteredDecisions = useMemo(() => {
    const fc = filterCount(filter);
    if (fc === 0) return items;
    const passing = new Set(filterTasks(items.map(filterView), filter).map((v) => String(v.id)));
    return items.filter((d) => passing.has(String(d.id)));
  }, [items, filter]);

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
  const clearFilter = () => { setFilter(emptyFilter()); setFilterRows([]); };
  const fc = filterCount(filter);

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

  // Deferred delete with an undo window (softDeleteDecisions): the row vanishes
  // now, the real delete fires when the toast's "בטל" expires.
  const handleDelete = (id) => {
    const { undo } = softDeleteDecisions(id);
    onNotify?.('ההחלטה נמחקה', 'info', 6000, { label: 'בטל', onClick: undo });
  };

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

  // Reusable table box for one group's decisions (header + rows). The add-row is
  // rendered only on the LAST group (or when ungrouped) so there's a single add
  // affordance at the bottom.
  const renderDecisionTable = (list, showAddRow) => (
    <div className={styles.decTable}>
      <div className={`${styles.decRow} ${styles.decHead}`} style={rowStyle}>
        {/* Frozen name header — sticky (its own positioning context) so it pins
            during horizontal scroll AND hosts the resize handle, exactly like
            TaskTable's frozen `.taskFirst`. */}
        <div className={`${styles.decCell} ${styles.decHeadCell} ${styles.decNameHead}`}>
          החלטה
          {canResize && <ResizeHandle onMouseDown={(e) => startResize('name', e)} />}
        </div>
        <div className={`${styles.decCell} ${styles.decHeadCell}`} style={canResize ? { position: 'relative' } : undefined}>
          מחליט
          {canResize && <ResizeHandle onMouseDown={(e) => startResize('decider', e)} />}
        </div>
        <div className={`${styles.decCell} ${styles.decHeadCell}`} style={canResize ? { position: 'relative' } : undefined}>
          מושפעים
          {canResize && <ResizeHandle onMouseDown={(e) => startResize('affected', e)} />}
        </div>
        <div className={`${styles.decCell} ${styles.decHeadCell}`} style={canResize ? { position: 'relative' } : undefined}>
          סטאטוס
          {canResize && <ResizeHandle onMouseDown={(e) => startResize('status', e)} />}
        </div>
        <div className={`${styles.decCell} ${styles.decHeadCell}`} style={canResize ? { position: 'relative' } : undefined}>
          תאריך
          {canResize && <ResizeHandle onMouseDown={(e) => startResize('date', e)} />}
        </div>
      </div>

      {list.map((d) => (
        <DecisionRow
          key={d.id}
          decision={d}
          statusOpts={statusOpts}
          can={canDecision}
          onRename={updateDecisionName}
          onStatus={updateDecisionStatus}
          onDate={updateDecisionDate}
          onAffected={updateDecisionAffected}
          onDelete={handleDelete}
          rowStyle={rowStyle}
        />
      ))}

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
    <div className={styles.decisionsRoot}>
      <div className={styles.decToolbar}>
        <div className={styles.decToolbarLeft}>
          {canCreateDecision && (
            <Button kind={"primary"} size={"small"} onClick={() => onNewDecision?.()}>החלטה חדשה</Button>
          )}
        </div>
        <div className={styles.decToolbarRight} dir="ltr">
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
          {isGrouped && filteredDecisions.length > 0 && (
            <CollapseAllButton collapsed={allCollapsed} onClick={toggleAll} />
          )}
        </div>
      </div>

      <div className={styles.decBoard}>
        {items.length === 0 && !canCreateDecision ? (
          <div className={styles.decEmptyRow}>אין החלטות עדיין</div>
        ) : !isGrouped ? (
          renderDecisionTable(filteredDecisions, true)
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
              {!collapsed[grp.key] && renderDecisionTable(grp.items, gi === grouped.length - 1)}
            </div>
          ))
        )}
      </div>
    </div>
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
