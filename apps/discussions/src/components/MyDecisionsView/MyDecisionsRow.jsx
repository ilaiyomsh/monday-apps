import React, { useRef, useState } from 'react';
import { Dialog, DialogContentContainer } from '@vibe/core';
import { Update, CloseSmall } from '@vibe/icons';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { PersonList } from '@generated/components/PersonAvatar';
import { isValidStatus } from '@generated/constants/statusConfig';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { monday } from '@api/monday-client.js';
import { getDecisionDiscussion } from './decisionPipeline.js';
import grid from './MyDecisionsTable.module.css';
import row from '../TaskTableRow/TaskTableRow.module.css';
import styles from './MyDecisionsRow.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// Open the monday item card on the "updates" pane — clicking the decision text
// (only) opens the card; inline-edit controls stop propagation.
function openItemCard(itemId) {
  if (!itemId) return;
  monday.execute('openItemCard', { itemId: Number(itemId), kind: 'updates' });
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
  // Label picker opens UPWARD by default; flips down only if there's no room.
  const [position, setPosition] = useState('top-start');
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
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'top-start',
      popupWidth: 184,
      popupHeight: Math.max(180, options.length * 46 + 24),
      offset: 4,
    });
    if (next?.placement) setPosition(next.placement);
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
        zIndex={1000}
        content={() => (
          <DialogContentContainer>
            <div className={row.statusMenu}>
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
  showDate = true,
  showDiscussion = true,
  onStatusChange,
  onPriorityChange,
  onDateChange,
}) {
  const statusOpts = useStatusOptions('decisions', 'decisionStatusID');
  const priorityOpts = useStatusOptions('decisions', 'decisionPriorityID');

  const date = decision.decisionDateID;
  const discussion = getDecisionDiscussion(decision);

  // One renderer per column key — header (MyDecisionsTable) and body cells
  // render from the SAME `columns` order array.
  const cellByKey = {
    // decision text — clicking opens the item card on the Updates pane.
    name: (
      <div key="name" className={`${grid.taskCell} ${grid.taskFirst} ${styles.name}`}>
        <button
          type="button"
          className={styles.nameText}
          title={decision.name}
          onClick={(e) => { e.stopPropagation(); openItemCard(decision.id); }}
        >
          {decision.name}
        </button>
        <button
          type="button"
          className={styles.updatesBtn}
          title="עדכונים"
          aria-label="פתח עדכונים"
          onClick={(e) => { e.stopPropagation(); openItemCard(decision.id); }}
        >
          <Update size={18} />
        </button>
      </div>
    ),
    // decider — compact avatar(s), click-to-expand list (PersonList).
    decider: showDecider ? (
      <div key="decider" className={`${grid.taskCell} ${styles.peopleCell}`} onClick={stop}>
        <PersonList people={decision.deciderID || []} size="sm" showNames={false} max={2} />
      </div>
    ) : null,
    // affected — 3 avatars + "+N" overflow counter (monday people-column idiom).
    affected: showAffected ? (
      <div key="affected" className={`${grid.taskCell} ${styles.peopleCell}`} onClick={stop}>
        <PersonList people={decision.affectedID || []} size="sm" showNames={false} max={3} />
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
    // date — inline date picker when permitted, read-only text otherwise
    // (mirrors MyTasksRow's deadline cell: full-cell picker + hover clear-X).
    date: showDate ? (
      <div key="date" className={`${grid.taskCell} ${styles.dateCell}`} onClick={onDateChange ? stop : undefined}>
        {onDateChange ? (
          <div className={styles.cellCenter}>
            <DatePickerPopover value={date} onChange={(d) => onDateChange(decision.id, d)} />
          </div>
        ) : date ? (
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

  const orderedKeys = columns || ['name', 'decider', 'affected', 'priority', 'status', 'date', 'discussion'];

  return (
    <div className={`${grid.taskRow} ${styles.bodyRow}`} style={rowStyle}>
      {orderedKeys.map((k) => cellByKey[k]).filter(Boolean)}
    </div>
  );
}

export default MyDecisionsRow;
