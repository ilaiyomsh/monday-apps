import React, { useRef, useState } from 'react';
import { Checkbox, Dialog, DialogContentContainer } from '@vibe/core';
import { Update, Edit } from '@vibe/icons';
import { X, Plus } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableRow } from '@generated/components/SortableRow';
import { useRowOrder } from '@generated/hooks/useRowOrder.js';
import { PersonAvatar, PersonList } from '@generated/components/PersonAvatar';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { isValidStatus } from '@generated/constants/statusConfig';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { openOrToggleItemCard } from '@generated/utils/itemCard.js';
import styles from './DecisionsTab.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// Open a decision's item card on the Updates pane — identical affordance to the
// Tasks name cell (kind:'updates' renders monday's side panel). A decision is a
// board item, so decision.id is a real monday item id; guard the temp id of an
// optimistic (not-yet-saved) decision so it never targets a bogus id.
// Open a decision's item card via the shared helper. monday's SDK has no
// programmatic close (see utils/itemCard.js), so every click reliably (re)opens.
// A decision is a board item, so guard the temp id of an optimistic decision.
function openItemCard(itemId) {
  if (!itemId || String(itemId).startsWith('temp-')) return;
  openOrToggleItemCard(itemId);
}

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
  // Status picker opens DOWNWARD and CENTERED on the cell (monday parity,
  // round 94); flips up only if there's no room below.
  const [position, setPosition] = useState('bottom');
  // round98: picker width tracks the column label (cell) width, not a fixed 206px.
  const [menuWidth, setMenuWidth] = useState(206);
  const triggerRef = useRef(null);

  const label = opts.labelById[value];
  const hasValue = isValidStatus(value) && label != null;
  const fill = hasValue ? (opts.colorById[value] || NEUTRAL) : null;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = Math.round(rect.width);
    setMenuWidth(w);
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: w,
      popupHeight: Math.max(180, (opts.options?.length || 0) * 40 + 28),
      offset: 4,
    });
    if (next?.placement) setPosition(next.placement.startsWith('top') ? 'top' : 'bottom');
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
          <div className={styles.decMenu} style={{ width: menuWidth + 20 }}>
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
  decision, statusOpts, trackingOpts, can, onRename, onStatus, onTracking, onDate, onDecider, onAffected, rowStyle,
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
            accountWide
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
    // מעקב החלטה — second status column (round153); same inline picker as status.
    tracking: (
      <div key="tracking" className={`${styles.decCell} ${styles.decStatusCell}`}>
        <LabelPickerCell
          value={decision.decisionTrackingID}
          opts={trackingOpts}
          canEdit={can('editDecisionStatus', decision)}
          onPick={(id) => onTracking(decision.id, id)}
          placeholder="בחר מעקב"
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
    'name', 'decider', 'affected', 'status', 'tracking', 'date',
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
 * One group's decision rows, wrapped in a dnd-kit sortable context for whole-row
 * drag-reorder (Round 7). Split into its own component so it can call the
 * useRowOrder hook legally (groups are dynamic). When reorder is disabled it
 * renders the rows plainly (no DnD wrapper).
 */
function DecisionRows({
  list, scope, canReorderRows, columns, selectable, selectedIds, onToggleSelect,
  statusOpts, trackingOpts, canDecision, updateDecisionName, updateDecisionStatus, updateDecisionTracking, updateDecisionDate,
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
      trackingOpts={trackingOpts}
      can={canDecision}
      onRename={updateDecisionName}
      onStatus={updateDecisionStatus}
      onTracking={updateDecisionTracking}
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

export { LabelPickerCell, DecisionRow, DecisionRows, InlineAddDecisionRow, formatDayMonth };
