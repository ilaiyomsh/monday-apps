import React, { useState, useRef } from 'react';
import { Checkbox } from '@vibe/core';
import { Plus } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskTableRow } from '@generated/components/TaskTableRow';
import { SortableRow } from '@generated/components/SortableRow';
import { useColumnOrder } from '@generated/hooks/useColumnOrder.js';
import { useColumnWidths } from '@generated/hooks/useColumnWidths.js';
import { useRowOrder } from '@generated/hooks/useRowOrder.js';
import { useViewport } from '@generated/hooks/useViewport.js';
import { ResizeHandle } from '@generated/components/ResizeHandle';
import { ColumnHeaderDnd, SortableHeaderCell } from '@generated/components/SortableColumnHeader';
import { TASKS_COLUMN_WIDTHS as W } from '@generated/constants/columnWidths.js';
import styles from './TaskTable.module.css';

// Header titles per column key (name has none — it's the frozen first column).
const TITLE = { name: '', assignee: 'אחראי', deadline: 'דד ליין', status: 'סטאטוס', priority: 'עדיפות', source: 'דיון מקור' };
// Desktop column widths are draggable + persisted (per-instance) via
// useColumnWidths under the SHARED 'tasks' tableId — one setting for TasksTab /
// PreviousTasksTab / EffectivenessTab (defaults in constants/columnWidths.js).
// Mobile keeps the compact fixed template with the shrinking --name-col.
const MOBILE_TRACK = { sel: '36px', name: '50vw', assignee: '110px', deadline: '120px', status: '140px', priority: '140px', source: '225px' };

export function TaskTable({
  tasks,
  color,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDeadlineChange,
  onOpenNewTask,
  // Inline add (native monday "add item"): when provided, the footer add-row
  // becomes an inline text input — click reveals it, name + Enter creates the
  // task IMMEDIATELY (no modal), and focus stays for rapid entry. Takes the
  // group's seed defaults (status/assignee) so a task added inside a grouped
  // section inherits that group. This is the DEFAULT add path for the Tasks tab;
  // onOpenNewTask (the modal) is kept only as an optional fallback.
  onInlineCreate,
  // Seed values applied to an inline-created task (group status/assignee).
  inlineCreateDefaults,
  onRenameTask,
  onDeleteTask,
  selectable = false,
  selectedIds,
  onToggleSelect,
  selectAllChecked = false,
  selectAllIndeterminate = false,
  onToggleSelectAll,
  // "by discussion type" view: append a rightmost "דיון מקור" (source discussion)
  // column styled like a monday connected-board cell. Off in every other tab.
  showSourceDiscussion = false,
  // Read-only/editable "עדיפות" (priority) column. The caller turns it on only
  // when the priorityID column is mapped in Settings.
  showPriority = false,
  // Board owners can drag-reorder columns (per-instance, shared) — same gate as
  // the My Tasks table. Everyone else gets the stored order applied.
  canManageSettings = false,
  // Phase 4 (board permissions): explicit reorder gate from `can('reorderColumns')`
  // (owners/admins only). When undefined (My Tasks + other callers) the legacy
  // canManageSettings gate is used so those surfaces are unchanged.
  canReorderColumns,
  // When provided, a read-only task name becomes a button that opens the task's
  // item card (used by the Previous-tasks tab to open on the Updates pane).
  onOpenCard,
  // Phase 4 (board permissions): per-task capability check. `canTask(cap, task)`
  // gates each inline editor PER ROW — when it returns false for a given task +
  // capability the corresponding handler is withheld, so TaskTableRow renders a
  // read-only display cell (its existing handler-presence gating). Defaults to
  // allow-all so callers that don't gate (none today besides the task tabs) are
  // unaffected.
  canTask = () => true,
  // Whole-row drag-reorder (Round 7). When `reorderScope` is provided AND
  // reorder is allowed (owner/editor, non-mobile), the rows in THIS table become
  // draggable up/down; the order persists per-scope in monday.storage (monday has
  // no item-position API — see useRowOrder/rowOrder). `reorderScope` must be
  // stable + unique per orderable list (per group / per discussion). Reordering
  // is a display concern only — it never changes a task's status/group.
  reorderScope = null,
  canReorderRows = false,
}) {
  const { isMobile } = useViewport();

  // Visible columns in DEFAULT order. 'sel' is a pinned, fixed leading track
  // (the selection checkbox), present only when the table is selectable.
  // Default LTR order: name · priority · assignee · deadline · status · source.
  // (Users can drag to reorder; this is just the starting order.) 'source' is the
  // הנחיות-קודמות-only "דיון מקור" column.
  const baseKeys = [
    ...(selectable ? ['sel'] : []),
    'name',
    ...(showPriority ? ['priority'] : []),
    'assignee', 'deadline', 'status',
    ...(showSourceDiscussion ? ['source'] : []),
  ];
  const pinned = selectable ? ['sel', 'name'] : ['name'];
  const { order, reorder } = useColumnOrder('tasks', baseKeys, pinned);

  // Width defs follow the live column ORDER; 'sel' is a fixed (non-resizable)
  // leading track, everything else resizes within the constants' clamps.
  const defs = order.map((k) => (k === 'sel' ? { key: 'sel', fixed: 36 } : { key: k, ...W[k] }));
  const { gridTemplate, startResize } = useColumnWidths('tasks', defs);
  const mobileTemplate = order.map((k) => MOBILE_TRACK[k]).filter(Boolean).join(' ');
  const rowStyle = { gridTemplateColumns: isMobile ? mobileTemplate : gridTemplate };

  // Whole-row drag-reorder (Round 7): enabled only when a scope is passed, the
  // caller allows it, and we're not on touch (drag + inline-edit coexist via the
  // pointer sensor's activation distance, like the Topics table). useRowOrder
  // applies the persisted order to `tasks` and returns the display order.
  const rowsReorderable = !!reorderScope && !!canReorderRows && !isMobile;
  const { order: rowOrderIds, orderList: orderedTasks, onDragEnd: onRowDragEnd } =
    useRowOrder(reorderScope, tasks, { enabled: rowsReorderable });
  const rowSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const displayTasks = rowsReorderable ? orderedTasks : tasks;

  // Owner-only, non-touch reorder + resize (matches the My Tasks table).
  // Prefer the explicit board-permissions gate when supplied; else legacy owner.
  const canReorder = (canReorderColumns ?? canManageSettings) && !isMobile;
  const canResize = canReorder;
  const movableIds = order.filter((k) => k !== 'name' && k !== 'sel');
  // Non-first header cells need a positioning context for the absolute handle;
  // the frozen .taskFirst is already sticky (a containing block), so it doesn't.
  const relStyle = canResize ? { position: 'relative' } : undefined;
  const handle = (key) =>
    canResize ? <ResizeHandle onMouseDown={(e) => startResize(key, e)} /> : null;

  const renderHeaderCell = (key) => {
    if (key === 'sel') {
      return (
        <div key="sel" className={`${styles.taskCell} ${styles.selectCell}`} onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selectAllChecked}
            indeterminate={selectAllIndeterminate}
            onChange={(e) => onToggleSelectAll?.(e.target.checked)}
            ariaLabel={selectAllChecked ? 'בטל בחירת קבוצה' : 'בחר את כל הקבוצה'}
          />
        </div>
      );
    }
    if (key === 'name') {
      return (
        <div key="name" className={`${styles.taskCell} ${styles.taskFirst} ${styles.nameHead}`}>
          {TITLE.name}
          {handle('name')}
        </div>
      );
    }
    const inner = (<>{TITLE[key]}{handle(key)}</>);
    return canReorder ? (
      <SortableHeaderCell key={key} id={key} className={styles.taskCell} style={relStyle}>{inner}</SortableHeaderCell>
    ) : (
      <div key={key} className={styles.taskCell} style={relStyle}>{inner}</div>
    );
  };

  const tableClass = `${styles.taskTable} ${selectable ? styles.selectable : ''}`;
  return (
    <div className={styles.taskTableScroll}>
      <div className={tableClass} dir="ltr" style={color ? { '--group-color': color } : undefined}>
        {/* header */}
        <div className={`${styles.taskRow} ${styles.taskHead}`} style={rowStyle}>
          <ColumnHeaderDnd enabled={canReorder} ids={movableIds} labels={TITLE} onReorder={reorder}>
            {order.map(renderHeaderCell)}
          </ColumnHeaderDnd>
        </div>

        {/* rows */}
        {(() => {
          const renderRow = (task, drag) => (
            <TaskTableRow
              key={task.id}
              task={task}
              columns={order}
              rowStyle={rowStyle}
              onStatusChange={onStatusChange && canTask('editTaskStatus', task) ? onStatusChange : undefined}
              onPriorityChange={onPriorityChange && canTask('editTaskPriority', task) ? onPriorityChange : undefined}
              onAssigneeChange={onAssigneeChange && canTask('editTaskAssignee', task) ? onAssigneeChange : undefined}
              onDeadlineChange={onDeadlineChange && canTask('editTaskDeadline', task) ? onDeadlineChange : undefined}
              onRenameTask={onRenameTask && canTask('editTaskName', task) ? onRenameTask : undefined}
              onDeleteTask={onDeleteTask}
              selectable={selectable}
              selected={selectable ? !!selectedIds?.has(task.id) : false}
              onToggleSelect={onToggleSelect}
              showSourceDiscussion={showSourceDiscussion}
              showPriority={showPriority}
              onOpenCard={onOpenCard}
              dragRef={drag?.setNodeRef}
              dragStyle={drag?.style}
              dragProps={drag ? { ...drag.attributes, ...drag.listeners } : undefined}
            />
          );
          if (!rowsReorderable) return displayTasks.map((task) => renderRow(task, null));
          return (
            <DndContext sensors={rowSensors} collisionDetection={closestCenter} onDragEnd={onRowDragEnd}>
              <SortableContext items={rowOrderIds} strategy={verticalListSortingStrategy}>
                {displayTasks.map((task) => (
                  // A still-saving optimistic row (temp- id) has no board id yet,
                  // so it can't be persisted in an order — leave it non-draggable.
                  <SortableRow key={task.id} id={task.id} disabled={String(task.id).startsWith('temp-')}>
                    {(drag) => renderRow(task, drag)}
                  </SortableRow>
                ))}
              </SortableContext>
            </DndContext>
          );
        })()}

        {/* add-task footer row — lives inside the rounded table. Inline add is
            the default (native monday "add item"); the modal button is a fallback
            only used when no inline handler is wired. */}
        {onInlineCreate ? (
          <InlineAddTaskRow onCreate={onInlineCreate} defaults={inlineCreateDefaults} />
        ) : onOpenNewTask ? (
          <button type="button" className={styles.addRow} onClick={onOpenNewTask} aria-label="הוסף משימה">
            <span className={styles.addLabel}>+ הוסף משימה</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Inline add-row for the Tasks tab: at rest it's the same "+ הוסף משימה" affordance;
// clicking swaps in a borderless text input (mirrors the Topics add-point row).
// Name + Enter creates the task with only a name (+ the group's seed defaults) —
// deadline/assignee are filled inline afterward, so NOTHING is required. The
// input stays focused after each create for rapid entry; Escape / empty-blur
// collapses back to the label.
function InlineAddTaskRow({ onCreate, defaults }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Only a name (plus any group seed defaults) — no required deadline/assignee.
    onCreate(trimmed, { ...(defaults || {}) });
    setText('');
    // Keep focus so the user can add another straight away (monday behavior).
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={styles.addRow}
        onClick={() => { setEditing(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        aria-label="הוסף משימה"
      >
        <span className={styles.addLabel}>+ הוסף משימה</span>
      </button>
    );
  }

  return (
    <div className={styles.addRow}>
      <span className={styles.addLabel}>
        <Plus size={16} className={styles.addIcon} />
        <input
          ref={inputRef}
          className={styles.addInput}
          autoFocus
          value={text}
          placeholder="שם משימה…"
          aria-label="שם משימה חדשה"
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

export default TaskTable;
