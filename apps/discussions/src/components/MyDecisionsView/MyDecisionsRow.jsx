import React, { useRef, useState } from 'react';
import { Dialog, DialogContentContainer, Checkbox } from '@vibe/core';
import { Update, CloseSmall, Edit } from '@vibe/icons';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { PersonList } from '@generated/components/PersonAvatar';
import { PersonPicker } from '@generated/components/PersonPicker';
import { isValidStatus } from '@generated/constants/statusConfig';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { openOrToggleItemCard } from '@generated/utils/itemCard.js';
import { HighlightedText } from '@generated/components/HighlightedText';
import { getDecisionDiscussion, getEffectiveDecider } from './decisionPipeline.js';
import grid from './MyDecisionsTable.module.css';
import row from '../TaskTableRow/TaskTableRow.module.css';
import styles from './MyDecisionsRow.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// Open the monday item card on the "updates" pane — clicking the decision text
// (only) opens the card; inline-edit controls stop propagation.
// Open the monday item card via the shared helper. monday's SDK has no
// programmatic close (see utils/itemCard.js), so every click reliably (re)opens.
function openItemCard(itemId) {
  if (!itemId) return;
  openOrToggleItemCard(itemId);
}

const stop = (e) => e.stopPropagation();

// Inline-editable status-shaped cell (status + priority columns). A colored
// label pill opens a Dialog menu of the column's labels; picking one calls
// onChange(decisionId, labelId) and the menu AUTO-CLOSES on pick
// (hideTrigger 'onContentClick' — @vibe ORs its internal open state with
// `open`, so controlled setOpen(false) alone won't hide it).
// Minimal duplicate of MyTasksRow's private StatusEditCell — it isn't exported,
// and threading an export through MyTasksView files is out of scope here.
function StatusEditCell({ decisionId, value, options, labelById, colorById, emptyLabel, onChange }) {
  const [open, setOpen] = useState(false);
  // Status picker opens DOWNWARD and CENTERED on the cell (monday parity, round 94);
  // flips up only if there's no room below.
  const [position, setPosition] = useState('bottom');
  // round98: picker width tracks the column label (cell) width, not a fixed 206px.
  const [menuWidth, setMenuWidth] = useState(206);
  const triggerRef = useRef(null);

  const show = isValidStatus(value) && labelById[value] != null;
  const label = labelById[value];
  const fill = show ? (colorById[value] || NEUTRAL) : null;

  // No handler = the permission gate withheld editing for this decision —
  // render the same pill without the picker (read-only display).
  if (!onChange) {
    return (
      <div className={`${grid.taskCell} ${row.statusCell} ${styles.statusCellBleed}`} onClick={stop}>
        {show ? (
          <span className={row.statusFill} style={{ background: fill }}>{label}</span>
        ) : (
          <span className={row.statusEmpty}>{emptyLabel}</span>
        )}
      </div>
    );
  }

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = Math.round(rect.width);
    setMenuWidth(w);
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: w,
      popupHeight: Math.max(180, options.length * 40 + 28),
      offset: 4,
    });
    if (next?.placement) setPosition(next.placement.startsWith('top') ? 'top' : 'bottom');
  };

  return (
    <div className={`${grid.taskCell} ${row.statusCell} ${styles.statusCellBleed}`} onClick={stop}>
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
            <div className={row.statusMenu} style={{ width: menuWidth + 20 }}>
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={row.statusOption}
                  style={{ background: opt.color || NEUTRAL }}
                  onClick={() => { onChange?.(decisionId, opt.id); setOpen(false); }}
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
          className={row.statusTrigger}
          onMouseDown={updatePosition}
        >
          {show ? (
            <span className={row.statusFill} style={{ background: fill }}>{label}</span>
          ) : (
            <span className={row.statusEmpty}>{emptyLabel}</span>
          )}
        </button>
      </Dialog>
    </div>
  );
}

/*
 * One "My Decisions" table row. Columns (LTR grid, header order in
 * MyDecisionsTable):
 *   name (frozen) | decider | affected | priority | status | date | discussion
 * Status / priority / date are inline-editable PER ROW — the table withholds the
 * handler when the permission gate denies, and the cell renders read-only.
 */
export function MyDecisionsRow({
  decision,
  columns,
  rowStyle,
  showDecider = true,
  showAffected = true,
  showPriority = true,
  showTracking = true,
  showDate = true,
  showDiscussion = true,
  onStatusChange,
  onTrackingChange,
  onPriorityChange,
  onDateChange,
  // People edit handlers (round 74): when provided, the decider / affected
  // cells render the SAME PersonPicker the in-discussion decisions tab uses
  // (the table withholds them when the permission gate denies).
  onDeciderChange,
  onAffectedChange,
  // Inline rename handler (permission-gated by the table). When provided, a
  // hover pencil appears and inline name-editing is enabled.
  onRenameDecision,
  // Selection (round 27) — a leading checkbox cell when selectable.
  selectable = false,
  selected = false,
  onToggleSelect,
  // Active name-search term — the name highlights where it matched.
  searchTerm = '',
}) {
  const statusOpts = useStatusOptions('decisions', 'decisionStatusID');
  const trackingOpts = useStatusOptions('decisions', 'decisionTrackingID');
  const priorityOpts = useStatusOptions('decisions', 'decisionPriorityID');

  // Inline rename (hover pencil) — the pencil shows only when onRenameDecision is
  // provided. Clicking the NAME still opens the item card; rename is a separate
  // affordance (mirrors MyTasksRow).
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const startEditName = () => { setNameDraft(decision.name || ''); setEditingName(true); };
  const saveName = () => {
    const next = nameDraft.trim();
    if (next && next !== decision.name) onRenameDecision?.(decision.id, next);
    setEditingName(false);
  };

  const date = decision.decisionDateID;
  const discussion = getDecisionDiscussion(decision);
  // מחליט display: the real decider(s), or — when empty — the creator as the
  // default decider (round 27 creator-as-default-decider fallback).
  const effectiveDecider = getEffectiveDecider(decision);

  // One renderer per column key — header (MyDecisionsTable) and body cells
  // render from the SAME `columns` order array.
  const cellByKey = {
    // selection checkbox (multi-select) — pinned leading cell.
    sel: (
      <div key="sel" className={`${grid.taskCell} ${grid.selectCell}`} onClick={stop}>
        <Checkbox
          checked={selected}
          onChange={(e) => onToggleSelect?.(decision.id, e.target.checked)}
          ariaLabel={`בחר החלטה ${decision.name}`}
        />
      </div>
    ),
    // decision text — clicking opens the item card on the Updates pane.
    name: (
      <div key="name" className={`${grid.taskCell} ${grid.taskFirst} ${styles.name}`}>
        {editingName ? (
          <input
            className={styles.nameInput}
            autoFocus
            value={nameDraft}
            onClick={stop}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveName(); }
              if (e.key === 'Escape') setEditingName(false);
            }}
            onBlur={saveName}
          />
        ) : (
          <>
            <button
              type="button"
              className={styles.nameText}
              title={decision.name}
              onClick={(e) => { e.stopPropagation(); openItemCard(decision.id); }}
            >
              <HighlightedText text={decision.name} query={searchTerm} />
            </button>
            {/* Hover rename pencil — permission-gated (onRenameDecision). Opens
                inline name-editing; the name click still opens the card. */}
            {onRenameDecision && (
              <button
                type="button"
                className={styles.renameBtn}
                title="עריכת שם"
                aria-label={`ערוך החלטה: ${decision.name}`}
                onClick={(e) => { e.stopPropagation(); startEditName(); }}
              >
                <Edit size={16} />
              </button>
            )}
            <button
              type="button"
              className={styles.updatesBtn}
              title="עדכונים"
              aria-label="פתח עדכונים"
              onClick={(e) => { e.stopPropagation(); openItemCard(decision.id); }}
            >
              <Update size={18} />
            </button>
          </>
        )}
      </div>
    ),
    // decider — compact avatar(s), click-to-expand list (PersonList). Falls back
    // to the creator when no decider is set (creator-as-default-decider).
    decider: showDecider ? (
      <div key="decider" className={`${grid.taskCell} ${styles.peopleCell}`} onClick={stop}>
        {onDeciderChange ? (
          <PersonPicker
            selected={decision.deciderID || []}
            onChange={(people) => onDeciderChange(decision.id, people)}
            single
            closeOnSelect
            boardKey="decisions"
          />
        ) : (
          <PersonList people={effectiveDecider} size="sm" showNames={false} max={2} />
        )}
      </div>
    ) : null,
    // affected — 3 avatars + "+N" overflow counter (monday people-column idiom);
    // multi-person picker when the permission gate allows editing.
    affected: showAffected ? (
      <div key="affected" className={`${grid.taskCell} ${styles.peopleCell}`} onClick={stop}>
        {onAffectedChange ? (
          <PersonPicker
            selected={decision.affectedID || []}
            onChange={(people) => onAffectedChange(decision.id, people)}
            boardKey="decisions"
            accountWide
          />
        ) : (
          <PersonList people={decision.affectedID || []} size="sm" showNames={false} max={3} />
        )}
      </div>
    ) : null,
    // priority — inline editable; hidden when the column isn't mapped.
    priority: showPriority ? (
      <StatusEditCell
        key="priority"
        decisionId={decision.id}
        value={decision.decisionPriorityID}
        options={priorityOpts.options}
        labelById={priorityOpts.labelById}
        colorById={priorityOpts.colorById}
        emptyLabel="ללא עדיפות"
        onChange={onPriorityChange}
      />
    ) : null,
    // status — inline editable.
    status: (
      <StatusEditCell
        key="status"
        decisionId={decision.id}
        value={decision.decisionStatusID}
        options={statusOpts.options}
        labelById={statusOpts.labelById}
        colorById={statusOpts.colorById}
        emptyLabel="ללא סטאטוס"
        onChange={onStatusChange}
      />
    ),
    // מעקב החלטה — second status column (round153), same inline editor.
    tracking: showTracking ? (
      <StatusEditCell
        key="tracking"
        decisionId={decision.id}
        value={decision.decisionTrackingID}
        options={trackingOpts.options}
        labelById={trackingOpts.labelById}
        colorById={trackingOpts.colorById}
        emptyLabel="ללא מעקב"
        onChange={onTrackingChange}
      />
    ) : null,
    // date — inline date picker when permitted, read-only text otherwise
    // (mirrors MyTasksRow's deadline cell: full-cell picker + hover clear-X).
    date: showDate ? (
      <div key="date" className={`${grid.taskCell} ${styles.dateCell}`} onClick={onDateChange ? stop : undefined}>
        {onDateChange ? (
          <div className={styles.cellCenter}>
            <DatePickerPopover value={date} onChange={(d) => onDateChange(decision.id, d)} />
          </div>
        ) : (date instanceof Date) ? (
          <span className={styles.muted}>{date.toLocaleDateString('en-GB')}</span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
        {onDateChange && date && (
          <button
            type="button"
            className={styles.clearX}
            aria-label="נקה תאריך"
            title="נקה תאריך"
            onClick={(e) => { e.stopPropagation(); onDateChange(decision.id, null); }}
          >
            <CloseSmall size={14} />
          </button>
        )}
      </div>
    ) : null,
    // "דיון מקור" — connected-board chip (purple leading border) that opens the
    // linked discussion's item card. The name comes from the board_relation's
    // linked_items (fetched with the row — no extra lookup).
    discussion: showDiscussion ? (
      <div key="discussion" className={`${grid.taskCell} ${styles.sourceCell}`}>
        {discussion ? (
          <span className={styles.sourceChips}>
            <button
              type="button"
              className={styles.sourceChip}
              title={discussion.name}
              onClick={(e) => { e.stopPropagation(); openItemCard(discussion.id); }}
            >
              {discussion.name || discussion.id}
            </button>
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </div>
    ) : null,
  };

  const orderedKeys = columns || [
    ...(selectable ? ['sel'] : []),
    'name', 'decider', 'affected', 'priority', 'status', 'date', 'discussion',
  ];

  return (
    <div className={`${grid.taskRow} ${styles.bodyRow}`} style={rowStyle}>
      {orderedKeys.map((k) => cellByKey[k]).filter(Boolean)}
    </div>
  );
}

export default MyDecisionsRow;
