import React, { memo, useState } from 'react';
import { Dialog, DialogContentContainer, Checkbox } from '@vibe/core';
import { CloseSmall, Update, Edit } from '@vibe/icons';
import { Trash2, Check, X } from 'lucide-react';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { PersonList } from '@generated/components/PersonAvatar';
import { isValidStatus } from '@generated/constants/statusConfig';
import { openOrToggleItemCard } from '@generated/utils/itemCard.js';
import { CustomColumnValue } from '@generated/components/CustomColumnValue';
import { StatusCell } from '@generated/components/StatusCell';
import { RelationPicker } from '@generated/components/RelationPicker';
import { customColumnKind } from '@generated/utils/customColumns.js';
import { NotesEditor } from '@generated/components/NotesEditor';
import grid from '../TaskTable/TaskTable.module.css';
import styles from './TaskTableRow.module.css';

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
/*
 * round366 — a custom column's cell: typed EDITOR when onChange is provided
 * (permission-gated upstream in TaskTable), read-only CustomColumnValue
 * otherwise.
 * round368 §4 — board_relation ("connected board") joined the editable types
 * (owner request); `file` is the only one still read-only, since uploading an
 * asset is not a table-cell interaction.
 */
/*
 * round373 — the cell WRAPPER a custom column gets, by kind. This is half of
 * "looks like a base column": a status fill has to bleed to all four cell edges,
 * so its cell carries no padding and lets the trigger stretch (`.statusCell`) —
 * the padded, centered `.customCell` is what left the white frame the owner
 * reported around a custom status chip. A date cell needs `position: relative`
 * for the hover clear-X, exactly like the deadline column.
 */
function customCellClass(type) {
  const kind = customColumnKind(type);
  if (kind === 'status') return styles.statusCell;
  if (kind === 'date') return `${styles.customCell} ${styles.deadlineCell}`;
  if (kind === 'relation') return `${styles.customCell} ${styles.sourceCell}`;
  return styles.customCell;
}

function CustomColumnCell({ col, value, onChange, dropdownOpts, relationOpts, statusOpts }) {
  const [ddOpen, setDdOpen] = useState(false);
  const [relOpen, setRelOpen] = useState(false);
  const t = col.type;
  const isRelation = t === 'board_relation' || t === 'connect_boards';
  const isStatus = t === 'status' || t === 'color';
  // file has no inline editor (asset upload is not a table-cell interaction).
  if (!onChange || t === 'file') {
    return <CustomColumnValue type={t} value={value} statusOpts={statusOpts} />;
  }
  /*
   * round372 — a custom STATUS column is editable with the same label menu the
   * built-in status column uses. The written value is the stable label ID (0 is a
   * real label, so every guard here tests the type, not truthiness), and picking
   * the already-set label CLEARS it — the only way to empty a status from a table
   * cell, matching the built-in column's behaviour.
   */
  if (isStatus) {
    return (
      <StatusCell
        value={typeof value === 'number' ? value : null}
        options={statusOpts?.options || []}
        labelById={statusOpts?.labelById || {}}
        colorById={statusOpts?.colorById || {}}
        /*
         * round375 (owner request) — an empty custom status cell shows the source
         * column's own GRAY DEFAULT label, with whatever text it carries. Only
         * when the column has no such text at all does it fall back to the
         * generic prompt. `grayLabel` is ungated by label position (see
         * useStatusOptions) — safe here because these are columns the owner just
         * mapped, not the old-scheme priority columns the gate protects.
         */
        emptyLabel={statusOpts?.emptyLabel || statusOpts?.grayLabel || 'בחר סטאטוס'}
        onChange={onChange}
        ariaLabel={`עריכת ${col.title || col.alias}`}
      />
    );
  }
  /*
   * round368 §4 (owner request) — a CONNECTED BOARD custom column is editable:
   * pick items of the linked board to link, click a linked one to unlink. Writes
   * REPLACE the whole set, so onChange always emits the full desired list; an
   * empty list genuinely clears the column (see monday-client's sanitizer).
   */
  if (isRelation) {
    const linked = Array.isArray(value?.linkedItems) ? value.linkedItems : [];
    const linkedIds = new Set(linked.map((it) => String(it.id)));
    const candidates = relationOpts?.items || [];
    const allowMultiple = relationOpts?.allowMultiple !== false;
    const emit = (ids) => onChange({ linkedItems: [...ids].map((id) => ({ id })) });
    const toggle = (id) => {
      const next = new Set(linkedIds);
      if (next.has(id)) next.delete(id);
      else if (allowMultiple) next.add(id);
      else { next.clear(); next.add(id); }
      emit(next);
      if (!allowMultiple) setRelOpen(false);
    };
    return (
      <Dialog
        open={relOpen}
        showTrigger={['click']}
        hideTrigger={['clickoutside', 'esc']}
        onDialogDidShow={() => setRelOpen(true)}
        onDialogDidHide={() => setRelOpen(false)}
        position="bottom"
        zIndex={10000}
        content={() => (
          <DialogContentContainer>
            {/*
              * round378 — the panel is monday's own "Choose items" layout
              * (RelationPicker): board name, search, and the candidates as
              * coloured GROUP sections. It owns its search and sort state, so the
              * cell only supplies data and the two write callbacks.
              */}
            <RelationPicker
              boardName={relationOpts?.boardName || ''}
              candidates={candidates}
              linkedIds={linkedIds}
              loading={!!relationOpts?.loading}
              allowMultiple={allowMultiple}
              columnTitle={col.title}
              onToggle={toggle}
              onClearAll={() => { emit(new Set()); setRelOpen(false); }}
            />
          </DialogContentContainer>
        )}
      >
        <button type="button" className={styles.relTrigger} aria-label={`עריכת ${col.title}`}>
          {/*
            * round373 — the trigger renders the SAME connected-board chip the
            * built-in "דיון מקור" column uses (blue bar, 32px, centered, +N
            * overflow) instead of a comma-joined string, so a custom relation
            * column is visually indistinguishable from the base one.
            */}
          {linked.length ? (
            <span className={styles.sourceChips}>
              <span className={styles.sourceChip} title={linked[0].name || ''}>
                {linked[0].name || linked[0].id}
              </span>
              {linked.length > 1 && (
                <span
                  className={styles.sourceMore}
                  title={linked.slice(1).map((it) => it.name || it.id).join(', ')}
                >
                  +{linked.length - 1}
                </span>
              )}
            </span>
          ) : <span className={styles.muted}>קשר פריט</span>}
        </button>
      </Dialog>
    );
  }
  if (t === 'people' || t === 'person' || t === 'multiple_person') {
    return (
      <div className={styles.assigneeCell}>
        <PersonPicker
          selected={Array.isArray(value) ? value : []}
          onChange={(p) => onChange(p)}
          boardKey="tasks"
          accountWide
        />
      </div>
    );
  }
  if (t === 'date') {
    // round373 — the SAME markup as the built-in deadline cell: a full-height
    // centered picker trigger plus the corner clear-X that appears on row hover
    // (the wrapper contributes `.deadlineCell`, which owns position + hover).
    const d = value instanceof Date ? value : null;
    return (
      <>
        <div className={styles.cellCenter}>
          <DatePickerPopover value={d} onChange={(nd) => onChange(nd)} />
        </div>
        {d && (
          <button
            type="button"
            className={styles.clearX}
            aria-label={`נקה ${col.title}`}
            title={`נקה ${col.title}`}
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
          >
            <CloseSmall size={14} />
          </button>
        )}
      </>
    );
  }
  if (t === 'dropdown') {
    const options = dropdownOpts?.options || [];
    const label = value ? String(value) : '';
    return (
      <Dialog
        open={ddOpen}
        showTrigger={['click']}
        hideTrigger={['clickoutside', 'esc', 'onContentClick']}
        onDialogDidShow={() => setDdOpen(true)}
        onDialogDidHide={() => setDdOpen(false)}
        position="bottom"
        zIndex={10000}
        content={() => (
          <DialogContentContainer>
            <div className={styles.customDdMenu}>
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={styles.customDdOption}
                  onClick={() => { onChange(opt.label); setDdOpen(false); }}
                >
                  {opt.label}
                </button>
              ))}
              {label && (
                <button
                  type="button"
                  className={`${styles.customDdOption} ${styles.customDdClear}`}
                  onClick={() => { onChange(null); setDdOpen(false); }}
                >
                  נקה ערך
                </button>
              )}
            </div>
          </DialogContentContainer>
        )}
      >
        <button type="button" className={styles.customDdTrigger} aria-label={`בחירת ${col.title}`}>
          {label || <span className={styles.muted}>בחר</span>}
        </button>
      </Dialog>
    );
  }
  // text / long_text — the notes-style inline editor (one line + popover).
  return (
    <NotesEditor
      value={value == null ? '' : String(value)}
      placeholder="—"
      ariaLabel={col.title}
      onCommit={(next) => onChange(next)}
    />
  );
}

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
  // round364 — owner-added custom mappings [{ alias, type, title }] rendered as
  // trailing cells (supplied by TaskTable off the published settings).
  customColumns,
  // round366 — inline edit of a custom column: (taskId, alias, value); absent
  // (not provided / permission-denied per row) ⇒ read-only cells.
  onCustomChange,
  // Board label options per custom DROPDOWN alias (hoisted in TaskTable).
  customDropdownOptions,
  // round368 — candidate items per custom RELATION alias (hoisted in TaskTable).
  customRelationOptions,
  // round372 — label options/maps per custom STATUS alias (hoisted in TaskTable).
  customStatusOptions,
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
  /*
   * round373 — the pickers' open state, MEASURED menu width and flip placement
   * all moved into the shared StatusCell. That is what makes the built-in
   * status/priority columns and an owner-added custom status column render from
   * one code path instead of three lookalikes.
   */
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
  const priority = task.priorityID;
  const priorityLabel = priorityOpts.labelById[priority];
  const showPriorityValue = isValidStatus(priority) && priorityLabel != null;

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
        <StatusCell
          value={showStatus ? status : null}
          options={statusOptions}
          labelById={labelById}
          colorById={colorById}
          emptyLabel={statusOpts.emptyLabel || (onStatusChange ? 'בחר סטאטוס' : '')}
          onChange={onStatusChange ? (id) => onStatusChange(task.id, id) : null}
          ariaLabel="עריכת סטאטוס"
        />
      </div>
    ),
    // priority — a second status column; editable like status, shown only when
    // priorityID is mapped. Read-only (no onPriorityChange) renders just the fill.
    priority: showPriority ? (
      <div key="priority" className={`${grid.taskCell} ${styles.statusCell}`}>
        <StatusCell
          value={showPriorityValue ? priority : null}
          options={priorityOpts.options || []}
          labelById={priorityOpts.labelById}
          colorById={priorityOpts.colorById}
          emptyLabel={priorityOpts.emptyLabel || (onPriorityChange ? 'בחר עדיפות' : '')}
          onChange={onPriorityChange ? (id) => onPriorityChange(task.id, id) : null}
          ariaLabel="עריכת עדיפות"
        />
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

  // round364 — owner-added custom columns; the alias doubles as the column
  // key, so the dispatch below picks these up exactly like the fixed cells.
  // round366 — when onCustomChange is present (permission-gated upstream) the
  // editable types render a typed editor; file/board_relation stay read-only.
  for (const c of customColumns || []) {
    cellByKey[c.alias] = (
      <div key={c.alias} className={`${grid.taskCell} ${customCellClass(c.type)}`} title={c.title}>
        <CustomColumnCell
          col={c}
          value={task?.[c.alias]}
          onChange={onCustomChange ? (value) => onCustomChange(task.id, c.alias, value) : null}
          dropdownOpts={customDropdownOptions?.[c.alias]}
          relationOpts={customRelationOptions?.[c.alias]}
          statusOpts={customStatusOptions?.[c.alias]}
        />
      </div>
    );
  }

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
