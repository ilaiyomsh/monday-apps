import React, { memo, useRef, useState } from 'react';
import { Dialog, DialogContentContainer, Checkbox } from '@vibe/core';
import { CloseSmall, Update, Edit } from '@vibe/icons';
import { Trash2, Check, X } from 'lucide-react';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { PersonList } from '@generated/components/PersonAvatar';
import { isValidStatus } from '@generated/constants/statusConfig';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import { openOrToggleItemCard } from '@generated/utils/itemCard.js';
import grid from '../TaskTable/TaskTable.module.css';
import styles from './TaskTableRow.module.css';

const NEUTRAL = 'hsl(var(--status-default))';

// Open a discussion's item card (used by the "by type" source-discussion chip).
// kind:'updates' makes monday render it as the SIDE PANEL (verified live) — the
// same presentation as the task card from My Tasks. Without a kind (default
// 'columns') the same call opened as a centered modal; the kind, not the item's
// board, is what drives panel-vs-modal here.
// Open the item card via the shared helper. monday's SDK has no programmatic
// close (see utils/itemCard.js), so every click reliably (re)opens — open-only.
function openItemCard(itemId) {
  if (!itemId) return;
  openOrToggleItemCard(itemId);
}

// Show the task's creation date from monday's built-in created_at — an ISO
// string present on every item, so a date always shows (no mapped column
// needed). Renders DD/MM; swallows bad/empty input.
function formatCreatedAt(nativeCreatedAt) {
  if (!nativeCreatedAt) return null;
  const d = new Date(nativeCreatedAt);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

// round136 (perf audit stage 3) — the row is MEMOIZED: with the tab-level
// handlers stabilized (useStableHandler) and the status/priority option maps
// hoisted to TaskTable, a selection toggle / search keystroke / single-row
// edit no longer re-renders every other row in the table.
export const TaskTableRow = memo(function TaskTableRow({
  task,
  // Status/priority option state, hoisted to TaskTable (ONE hook pair per
  // table instead of two per row — round136). The objects are the hook's
  // state values, so their identity is stable between option loads.
  statusOpts,
  priorityOpts,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  // round306 — שותפים inline edit (gated per row by editTaskPartners).
  onPartnersChange,
  onDeadlineChange,
  onRenameTask,
  onDeleteTask,
  // Optimistic-create error affordance (a temp row whose create failed): retry
  // re-runs the create; dismiss removes the row locally. Provided by TaskTable.
  onRetryCreate,
  onDismissRow,
  selectable = false,
  selected = false,
  onToggleSelect,
  showSourceDiscussion = false,
  // Read-only priority column (a SECOND status column, aliased priorityID).
  // Shown only when the owner mapped priorityID in Settings — see TaskTable.
  showPriority = false,
  // Ordered column keys (incl. 'sel'/'name') + the grid template, both supplied
  // by TaskTable so header and body honor the same drag-reorder order.
  columns,
  rowStyle,
  // When provided (and the row is read-only, i.e. no inline rename), clicking the
  // task name opens its item card via this callback (Previous-tasks tab → Updates).
  onOpenCard,
  // Whole-row drag-reorder (native monday feel) — supplied by TaskTable when
  // reordering is enabled. `dragRef`/`dragProps` ride on the row root; `dragStyle`
  // merges the sortable transform into rowStyle. Omitted → the row isn't draggable.
  dragRef,
  dragStyle,
  dragProps,
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  // Label pickers open DOWNWARD and CENTERED on the cell (monday parity, round 94:
  // @vibe 'bottom'/'top' center the popover under/над the trigger). computeFloatingPosition
  // still decides the flip; we map its result to the centered variant.
  const [statusPosition, setStatusPosition] = useState('bottom');
  // round98: the picker matches the COLUMN label width — measured from the
  // trigger cell so the open labels are as wide as the cell's fill (not a fixed
  // 206px). Defaults to 206 until first measured.
  const [statusMenuWidth, setStatusMenuWidth] = useState(206);
  const statusTriggerRef = useRef(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityPosition, setPriorityPosition] = useState('bottom');
  const [priorityMenuWidth, setPriorityMenuWidth] = useState(206);
  const priorityTriggerRef = useRef(null);
  const [editingName, setEditingName] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.name || '');
  // A freshly-added task still carrying a `temp-…` id has no monday item yet, but
  // it is FULLY EDITABLE right away — edits are queued in useTasks and flushed the
  // moment the real id arrives. `pending` now only drives aria-busy (no locking).
  const pending = String(task.id).startsWith('temp-');
  // The background create failed: keep the row (never silently drop it) and show
  // a clear error + retry/dismiss affordance instead of a blocked/faded row.
  const failed = task._createFailed === true;
  const deadline = task.deadlineID;
  const { options: statusOptions, colorById, labelById, doneId } = statusOpts;
  // Status is the stable label id. "Done" is the is_done label (doneId); only
  // flag overdue when we actually know the done id, otherwise stay safe.
  const isOverdue = deadline && deadline < new Date() && doneId != null && task.statusID !== doneId;
  const status = task.statusID;
  const createdAt = formatCreatedAt(task.created_at);
  // Source discussion(s) for the "by discussion type" view — the task's
  // discussionLinkID board_relation carries { linkedItems:[{id,name}] }.
  const sourceDiscussions = (task.discussionLinkID?.linkedItems || []).filter((d) => d?.name || d?.id);
  // Hover tooltip on the name cell — the creation date lives here only, no
  // longer shown inline in the column. Format: "name | נוצרה: DD/MM".
  const nameTitle = createdAt ? `${task.name} | נוצרה: ${createdAt}` : task.name;
  const statusLabel = labelById[status];
  // Show the fill only for a known label id (handles id 0 correctly).
  const showStatus = isValidStatus(status) && statusLabel != null;
  const statusFill = showStatus ? (colorById[status] || NEUTRAL) : null;
  const priority = task.priorityID;
  const priorityLabel = priorityOpts.labelById[priority];
  const showPriorityValue = isValidStatus(priority) && priorityLabel != null;
  const priorityFill = showPriorityValue ? (priorityOpts.colorById[priority] || NEUTRAL) : null;

  const startEditName = () => {
    if (!onRenameTask) return;
    setNameDraft(task.name || '');
    setEditingName(true);
  };
  const saveName = () => {
    const t = nameDraft.trim();
    if (t && t !== task.name) onRenameTask(task.id, t);
    setEditingName(false);
  };
  const deleteTask = () => {
    if (!onDeleteTask) return;
    onDeleteTask(task.id);
    setConfirmDel(false);
  };
  const updateStatusPosition = () => {
    const rect = statusTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = Math.round(rect.width);
    setStatusMenuWidth(w);
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: w,
      popupHeight: Math.max(180, statusOptions.length * 40 + 28),
      offset: 4,
    });
    // Centered variant: keep only the vertical (bottom/top); @vibe centers it.
    if (next?.placement) setStatusPosition(next.placement.startsWith('top') ? 'top' : 'bottom');
  };
  const updatePriorityPosition = () => {
    const rect = priorityTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = Math.round(rect.width);
    setPriorityMenuWidth(w);
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: w,
      popupHeight: Math.max(180, (priorityOpts.options?.length || 0) * 40 + 28),
      offset: 4,
    });
    if (next?.placement) setPriorityPosition(next.placement.startsWith('top') ? 'top' : 'bottom');
  };

  const cellByKey = {
    // selection checkbox (selectable tabs only)
    sel: (
      <div key="sel" className={`${grid.taskCell} ${grid.selectCell} ${styles.selFrozen}`} onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onChange={(e) => onToggleSelect?.(task.id, e.target.checked)}
          ariaLabel={`בחר משימה ${task.name}`}
        />
      </div>
    ),
    // name
    name: (
      <div key="name" className={`${grid.taskCell} ${grid.taskFirst} ${styles.name}`}>
        <div className={styles.nameInner}>
          {editingName ? (
            <input
              className={styles.nameInput}
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveName(); }
                if (e.key === 'Escape') { setEditingName(false); }
              }}
              onBlur={saveName}
            />
          ) : onOpenCard ? (
            // When the row can open a card (Previous-tasks tab), the NAME opens
            // the card and the hover pencil below does the rename (mirrors
            // MyTasksRow). onRenameTask alone (Tasks tab, no onOpenCard) keeps the
            // name-as-rename click too.
            <button
              type="button"
              className={styles.nameBtn}
              onClick={(e) => { e.stopPropagation(); onOpenCard(task.id); }}
              title={nameTitle}
              aria-label={`פתח כרטיס משימה: ${task.name}`}
            >
              {task.name}
            </button>
          ) : onRenameTask ? (
            <button
              type="button"
              className={styles.nameBtn}
              onClick={startEditName}
              title={nameTitle}
              aria-label={`ערוך שם משימה: ${task.name}`}
            >
              {task.name}
            </button>
          ) : (
            <span className={styles.nameText} title={nameTitle}>{task.name}</span>
          )}
          {/* Hover rename pencil — the same inline-rename affordance as clicking
              the name, made explicit + discoverable on every row (like MyTasksRow). */}
          {onRenameTask && !editingName && (
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
          {onDeleteTask && (
            confirmDel ? (
              <span className={styles.confirmDel} onClick={(e) => e.stopPropagation()}>
                <span className={styles.confirmText}>למחוק?</span>
                <button
                  type="button"
                  className={`${styles.confirmBtn} ${styles.confirmYes}`}
                  onClick={(e) => { e.stopPropagation(); deleteTask(); }}
                  aria-label="אישור מחיקה"
                  title="אישור"
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  className={styles.confirmBtn}
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
                className={styles.deleteBtn}
                onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }}
                aria-label="מחק משימה"
                title="מחק משימה"
              >
                <Trash2 size={18} />
              </button>
            )
          )}
          {failed && (
            <span className={styles.createFailedActions} onClick={(e) => e.stopPropagation()}>
              <span className={styles.createFailedText}>שמירה נכשלה</span>
              {onRetryCreate && (
                <button
                  type="button"
                  className={styles.retryBtn}
                  onClick={(e) => { e.stopPropagation(); onRetryCreate(task.id); }}
                >
                  נסה שוב
                </button>
              )}
              {onDismissRow && (
                <button
                  type="button"
                  className={styles.dismissBtn}
                  onClick={(e) => { e.stopPropagation(); onDismissRow(task.id); }}
                  aria-label="הסר שורה"
                  title="הסר"
                >
                  <X size={14} />
                </button>
              )}
            </span>
          )}
          {/* monday "updates" icon — opens the task's item card on the Updates pane */}
          <button
            type="button"
            className={styles.updatesBtn}
            title="עדכונים"
            aria-label="פתח עדכונים"
            onClick={(e) => { e.stopPropagation(); openItemCard(task.id); }}
          >
            <Update size={18} />
          </button>
        </div>
      </div>
    ),
    // assignee
    assignee: (
      <div key="assignee" className={grid.taskCell}>
        <div className={styles.assigneeCell}>
          {onAssigneeChange ? (
            <PersonPicker
              selected={task.responsibilityID || []}
              onChange={(p) => onAssigneeChange(task.id, p)}
              closeOnSelect
              single
              boardKey="tasks"
              accountWide
            />
          ) : (
            <PersonList people={task.responsibilityID} size="sm" showNames max={2} />
          )}
        </div>
      </div>
    ),
    // round306 — שותפים (partnersID): the SAME cell as אחראי above, minus `single`
    // (a task has several partners). Editable only when the permission gate
    // handed the handler down; read-only avatars otherwise.
    partners: (
      <div key="partners" className={grid.taskCell}>
        <div className={styles.assigneeCell}>
          {onPartnersChange ? (
            <PersonPicker
              selected={task.partnersID || []}
              onChange={(p) => onPartnersChange(task.id, p)}
              boardKey="tasks"
              accountWide
            />
          ) : (
            <PersonList people={task.partnersID} size="sm" showNames max={2} />
          )}
        </div>
      </div>
    ),
    // deadline — with a hover X to clear the column
    deadline: (
      <div key="deadline" className={`${grid.taskCell} ${styles.deadlineCell}`}>
        <div className={styles.cellCenter}>
          {onDeadlineChange ? (
            <DatePickerPopover value={deadline} onChange={(d) => onDeadlineChange(task.id, d)} />
          ) : deadline ? (
            <span className={isOverdue ? styles.overdue : styles.muted}>
              {deadline.toLocaleDateString('en-GB') /* DD/MM/YYYY */}
            </span>
          ) : (
            <span className={styles.muted}>—</span>
          )}
        </div>
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
    ),
    // status — full-width colored fill (monday native)
    status: (
      <div key="status" className={`${grid.taskCell} ${styles.statusCell}`}>
        {onStatusChange ? (
          <Dialog
            open={statusOpen}
            showTrigger={['click']}
            hideTrigger={['clickoutside', 'esc', 'onContentClick']}
            onDialogDidShow={() => { updateStatusPosition(); setStatusOpen(true); }}
            onDialogDidHide={() => setStatusOpen(false)}
            position={statusPosition}
            zIndex={10000}
            content={() => (
              <DialogContentContainer>
                <div className={styles.statusMenu} style={{ width: statusMenuWidth + 20 }}>
                  {statusOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={styles.statusOption}
                      style={{ background: opt.color || NEUTRAL }}
                      onClick={() => { onStatusChange(task.id, opt.id); setStatusOpen(false); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </DialogContentContainer>
            )}
          >
            <button
              ref={statusTriggerRef}
              type="button"
              className={styles.statusTrigger}
              onMouseDown={updateStatusPosition}
            >
              {showStatus ? (
                <span className={styles.statusFill} style={{ background: statusFill }}>{statusLabel}</span>
              ) : (
                <span className={styles.statusEmpty}>בחר סטאטוס</span>
              )}
            </button>
          </Dialog>
        ) : showStatus ? (
          <span className={styles.statusFill} style={{ background: statusFill }}>{statusLabel}</span>
        ) : (
          <span className={styles.statusEmpty} />
        )}
      </div>
    ),
    // priority — a second status column; editable like status, shown only when
    // priorityID is mapped. Read-only (no onPriorityChange) renders just the fill.
    priority: showPriority ? (
      <div key="priority" className={`${grid.taskCell} ${styles.statusCell}`}>
        {onPriorityChange ? (
            <Dialog
              open={priorityOpen}
              showTrigger={['click']}
              hideTrigger={['clickoutside', 'esc', 'onContentClick']}
              onDialogDidShow={() => { updatePriorityPosition(); setPriorityOpen(true); }}
              onDialogDidHide={() => setPriorityOpen(false)}
              position={priorityPosition}
              zIndex={10000}
              content={() => (
                <DialogContentContainer>
                  <div className={styles.statusMenu} style={{ width: priorityMenuWidth + 20 }}>
                    {(priorityOpts.options || []).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={styles.statusOption}
                        style={{ background: opt.color || NEUTRAL }}
                        onClick={() => { onPriorityChange(task.id, opt.id); setPriorityOpen(false); }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </DialogContentContainer>
              )}
            >
              <button
                ref={priorityTriggerRef}
                type="button"
                className={styles.statusTrigger}
                onMouseDown={updatePriorityPosition}
              >
                {showPriorityValue ? (
                  <span className={styles.statusFill} style={{ background: priorityFill }}>{priorityLabel}</span>
                ) : (
                  <span className={styles.statusEmpty}>בחר עדיפות</span>
                )}
              </button>
            </Dialog>
          ) : showPriorityValue ? (
            <span className={styles.statusFill} style={{ background: priorityFill }}>{priorityLabel}</span>
          ) : (
            <span className={styles.statusEmpty} />
          )}
      </div>
    ) : null,
    // source discussion — connected-board-style chip(s); "by type" view only
    source: showSourceDiscussion ? (
      <div key="source" className={`${grid.taskCell} ${styles.sourceCell}`}>
        {sourceDiscussions.length === 0 ? (
          <span className={styles.muted}>—</span>
        ) : (
          <span className={styles.sourceChips}>
            <button
              type="button"
              className={styles.sourceChip}
              title={sourceDiscussions[0].name || ''}
              onClick={(e) => { e.stopPropagation(); openItemCard(sourceDiscussions[0].id); }}
            >
              {sourceDiscussions[0].name || sourceDiscussions[0].id}
            </button>
            {sourceDiscussions.length > 1 && (
              <span
                className={styles.sourceMore}
                title={sourceDiscussions.slice(1).map((d) => d.name || d.id).join(', ')}
              >
                +{sourceDiscussions.length - 1}
              </span>
            )}
          </span>
        )}
      </div>
    ) : null,
  };

  const orderedKeys = columns || [
    ...(selectable ? ['sel'] : []),
    'name', 'assignee', 'partners', 'deadline', 'status',
    ...(showPriority ? ['priority'] : []),
    ...(showSourceDiscussion ? ['source'] : []),
  ];

  return (
    <div
      ref={dragRef}
      className={`${grid.taskRow} ${styles.bodyRow} ${failed ? styles.createFailed : ''} ${dragProps ? styles.draggableRow : ''}`}
      style={dragStyle ? { ...rowStyle, ...dragStyle } : rowStyle}
      aria-busy={(pending && !failed) || undefined}
      {...(dragProps || {})}
    >
      {orderedKeys.map((k) => cellByKey[k]).filter(Boolean)}
    </div>
  );
});

export default TaskTableRow;
