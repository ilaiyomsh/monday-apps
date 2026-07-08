import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContentContainer, Checkbox } from '@vibe/core';
import { Update, Edit, CloseSmall } from '@vibe/icons';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { isValidStatus } from '@generated/constants/statusConfig';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { monday } from '@api/monday-client.js';
import { getTaskDiscussion } from './grouping.js';
import grid from './MyTasksTable.module.css';
import row from '../TaskTableRow/TaskTableRow.module.css';
import styles from './MyTasksRow.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// Open the monday item card on the "updates" pane — the My Tasks row's primary
// affordance (the row body is the click target; inline-edit controls stop
// propagation so editing a field doesn't pop the card).
function openItemCard(itemId) {
  if (!itemId) return;
  monday.execute('openItemCard', { itemId: Number(itemId), kind: 'updates' });
}

const stop = (e) => e.stopPropagation();

// Inline-editable status-shaped cell (shared by the status column (statusID) and
// the priority column (priorityID)). Renders a colored label pill that opens a Dialog menu of the
// column's labels; picking one calls onChange(taskId, labelId).
function StatusEditCell({ taskId, value, options, labelById, colorById, emptyLabel, onChange }) {
  const [open, setOpen] = useState(false);
  // Label picker opens UPWARD by default (video feedback #4) — used for both the
  // status and priority columns; flips down only if there's no room above.
  const [position, setPosition] = useState('top-start');
  const triggerRef = useRef(null);

  const show = isValidStatus(value) && labelById[value] != null;
  const label = labelById[value];
  const fill = show ? (colorById[value] || NEUTRAL) : null;

  // No handler = the permission gate withheld editing for this task — render
  // the same pill without the picker (read-only display, mirrors TaskTableRow).
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
        // 'onContentClick' closes the menu the instant a label is picked — @vibe ORs
        // its internal open-state with `open`, so controlled setOpen(false) alone won't hide it.
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
                  onClick={() => { onChange?.(taskId, opt.id); setOpen(false); }}
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

export function MyTasksRow({ task, columns, onStatusChange, onPriorityChange, onNotesChange, onDeadlineChange, onRenameTask, rowStyle, showDeadline = true, showPriority = true, showNotes = true, selectable = false, selected = false, onToggleSelect }) {
  const { t } = useTranslation();
  const [notesDraft, setNotesDraft] = useState(task.taskNotesID || '');
  const [editingNotes, setEditingNotes] = useState(false);
  // Inline rename (permission-gated: the pencil shows only when onRenameTask is
  // provided). Clicking the NAME itself still opens the item card — rename is a
  // separate affordance so the primary click behavior doesn't change.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // Keep the local notes draft in sync when the row's notes change from outside
  // (optimistic update / revert) and we're not actively editing.
  useEffect(() => {
    if (!editingNotes) setNotesDraft(task.taskNotesID || '');
  }, [task.taskNotesID, editingNotes]);

  const statusOpts = useStatusOptions('tasks', 'statusID');
  const priorityOpts = useStatusOptions('tasks', 'priorityID');

  const deadline = task.deadlineID;
  const discussion = getTaskDiscussion(task);

  const commitNotes = () => {
    setEditingNotes(false);
    const next = notesDraft;
    if ((task.taskNotesID || '') !== (next || '')) onNotesChange?.(task.id, next);
  };

  const startEditName = () => {
    setNameDraft(task.name || '');
    setEditingName(true);
  };
  const saveName = () => {
    const next = nameDraft.trim();
    if (next && next !== task.name) onRenameTask?.(task.id, next);
    setEditingName(false);
  };

  // One renderer per column key. The header (MyTasksTable) and these cells render
  // from the SAME `columns` order array, so column reordering stays in sync.
  const cellByKey = {
    // selection checkbox (selectable view only)
    sel: (
      <div key="sel" className={`${grid.taskCell} ${grid.selectCell} ${styles.selFrozen}`} onClick={stop}>
        <Checkbox
          checked={selected}
          onChange={(e) => onToggleSelect?.(task.id, e.target.checked)}
          ariaLabel="בחר משימה"
        />
      </div>
    ),
    // name — clicking it always opens the item card on the Updates tab; the
    // hover pencil (permission-gated via onRenameTask) switches to inline edit.
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
              title={task.name}
              onClick={(e) => { e.stopPropagation(); openItemCard(task.id); }}
            >
              {task.name}
            </button>
            {onRenameTask && (
              <button
                type="button"
                className={styles.renameBtn}
                title="עריכת שם"
                aria-label={`ערוך שם משימה: ${task.name}`}
                onClick={(e) => { e.stopPropagation(); startEditName(); }}
              >
                <Edit size={16} />
              </button>
            )}
            {/* monday "updates" icon — opens the item card on the Updates pane */}
            <button
              type="button"
              className={styles.updatesBtn}
              title="עדכונים"
              aria-label="פתח עדכונים"
              onClick={(e) => { e.stopPropagation(); openItemCard(task.id); }}
            >
              <Update size={18} />
            </button>
          </>
        )}
      </div>
    ),
    // deadline — inline date picker when permitted (onDeadlineChange present),
    // read-only text otherwise; hidden when the deadline column isn't mapped.
    // Mirrors TaskTableRow's deadline cell (full-cell picker + hover clear-X).
    deadline: showDeadline ? (
      <div key="deadline" className={`${grid.taskCell} ${styles.deadlineCell}`} onClick={onDeadlineChange ? stop : undefined}>
        {onDeadlineChange ? (
          <div className={styles.cellCenter}>
            <DatePickerPopover value={deadline} onChange={(d) => onDeadlineChange(task.id, d)} />
          </div>
        ) : deadline ? (
          <span className={styles.muted}>{deadline.toLocaleDateString('en-GB')}</span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
        {onDeadlineChange && deadline && (
          <button
            type="button"
            className={styles.clearX}
            aria-label="נקה תאריך"
            title="נקה תאריך"
            onClick={(e) => { e.stopPropagation(); onDeadlineChange(task.id, null); }}
          >
            <CloseSmall size={14} />
          </button>
        )}
      </div>
    ) : null,
    // priorityID — inline editable; hidden when the priority column isn't mapped
    priority: showPriority ? (
      <StatusEditCell
        key="priority"
        taskId={task.id}
        value={task.priorityID}
        options={priorityOpts.options}
        labelById={priorityOpts.labelById}
        colorById={priorityOpts.colorById}
        emptyLabel={t('myTasks.noPriority')}
        onChange={onPriorityChange}
      />
    ) : null,
    // status — inline editable
    status: (
      <StatusEditCell
        key="status"
        taskId={task.id}
        value={task.statusID}
        options={statusOpts.options}
        labelById={statusOpts.labelById}
        colorById={statusOpts.colorById}
        emptyLabel={t('myTasks.noStatus')}
        onChange={onStatusChange}
      />
    ),
    // notes — inline editable; hidden when the notes column isn't mapped
    notes: showNotes ? (
      <div key="notes" className={`${grid.taskCell} ${styles.notesCell}`} onClick={stop}>
        <textarea
          className={styles.notesInput}
          rows={1}
          value={notesDraft}
          placeholder={t('myTasks.notesPlaceholder')}
          onFocus={() => setEditingNotes(true)}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={commitNotes}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setNotesDraft(task.taskNotesID || ''); setEditingNotes(false); e.currentTarget.blur(); }
          }}
        />
      </div>
    ) : null,
    // discussion — a clickable connected-board chip that opens the discussion card.
    discussion: (
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
    ),
  };

  const orderedKeys = columns || [
    ...(selectable ? ['sel'] : []),
    'name', 'deadline', 'priority', 'status', 'notes', 'discussion',
  ];

  return (
    <div className={`${grid.taskRow} ${styles.bodyRow} ${selected ? styles.selected : ''}`} style={rowStyle}>
      {orderedKeys.map((k) => cellByKey[k]).filter(Boolean)}
    </div>
  );
}

export default MyTasksRow;
