import React from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@vibe/core';
import { MyTasksRow } from './MyTasksRow.jsx';
import { getColumns } from '../../utils/mondayApi/board-config-store.js';
import { useColumnWidths } from '../../hooks/useColumnWidths.js';
import { useColumnOrder } from '../../hooks/useColumnOrder.js';
import { useViewport } from '../../hooks/useViewport.js';
import { ResizeHandle } from '../ResizeHandle';
import { ColumnHeaderDnd, SortableHeaderCell } from '../SortableColumnHeader';
import { MY_TASKS_COLUMN_WIDTHS as W, MY_TASKS_MOBILE_WIDTHS as M } from '../../constants/columnWidths.js';
import styles from './MyTasksTable.module.css';

// "My Tasks" table — like TaskTable but with extra columns (notes, discussion).
// Status / priority / deadline / name are inline-editable PER ROW, gated by the
// board-permissions matrix via `canTask` (notes stays ungated — it has no
// matrix capability). Column order:
//   name | deadline | priority | status | notes | discussion
// The discussion column is LAST (rightmost in this dir="ltr" table). Non-critical
// columns (deadline / priority / notes) are HIDDEN when their alias isn't mapped.
//
// Column widths are draggable + persisted (per-instance) via useColumnWidths; the
// resize handles are shown ONLY to board owners on a non-touch viewport (everyone
// else still gets the stored widths applied). The name column is FROZEN (sticky).
export function MyTasksTable({
  tasks,
  color,
  canManageSettings = false,
  onStatusChange,
  onPriorityChange,
  onNotesChange,
  onDeadlineChange,
  onRenameTask,
  // Per-task capability check (board-permissions matrix). `canTask(cap, task)`
  // gates each inline editor PER ROW — a false verdict withholds the handler so
  // the row renders that cell read-only. Defaults to allow-all.
  canTask = () => true,
  // Inline "+ הוסף משימה" footer row (same as TasksTab). When provided, a click
  // creates a task IMMEDIATELY, seeded with this group's status/priority.
  onAddTask,
  // Selection (mirrors TaskTable). 'sel' is a FIXED 36px leading track pinned
  // first — deliberately kept OUT of useColumnOrder/useColumnWidths persistence
  // so it can never be reordered away or stored.
  selectable = false,
  selectedIds,
  onToggleSelect,
  selectAllChecked = false,
  selectAllIndeterminate = false,
  onToggleSelectAll,
}) {
  const { t } = useTranslation();
  const { isMobile } = useViewport();
  const cols = getColumns('tasks') || {};
  const showDeadline = !!cols.deadlineID?.id;
  const showPriority = !!cols.priorityID?.id;
  const showNotes = !!cols.taskNotesID?.id;

  // Visible columns in DEFAULT order, each carrying its width params.
  const baseDefs = [
    { key: 'name', ...W.name },
    showDeadline && { key: 'deadline', ...W.deadline },
    showPriority && { key: 'priority', ...W.priority },
    { key: 'status', ...W.status },
    showNotes && { key: 'notes', ...W.notes },
    { key: 'discussion', ...W.discussion },
  ].filter(Boolean);

  // Apply the persisted column ORDER (name pinned first), then drive widths +
  // cell render order from the SAME ordered list so they can never drift.
  const defsByKey = Object.fromEntries(baseDefs.map((d) => [d.key, d]));
  const { order, reorder } = useColumnOrder('myTasks', baseDefs.map((d) => d.key));
  const defs = order.map((k) => defsByKey[k]).filter(Boolean);

  // 'sel' is a fixed leading track, prepended ONLY for rendering + width
  // measurement — never fed to useColumnOrder (so it can't be persisted or
  // reordered) and skipped by startResize (fixed defs are non-resizable).
  const selDef = selectable ? [{ key: 'sel', fixed: 36 }] : [];
  const renderKeys = selectable ? ['sel', ...order] : order;

  const { gridTemplate, startResize } = useColumnWidths('myTasks', [...selDef, ...defs]);
  // On phones, ignore the (desktop) resizable px widths and use a compact fixed
  // template. The frozen name column uses a fixed narrow width (M.name); all
  // groups share ONE horizontal scroll at the board level (no per-table scroll,
  // no gradual name-shrink), matching a real monday board on mobile too. Prepend
  // the fixed 36px selection track when selectable.
  const mobileTemplate = [
    ...(selectable ? ['36px'] : []),
    ...defs.map((d) => (d.key === 'name' ? (M.name ?? '22vw') : M[d.key] ?? '140px')),
  ].join(' ');
  const rowStyle = { gridTemplateColumns: isMobile ? mobileTemplate : gridTemplate };

  // Owner-only, mouse-only resize + reorder (per the owner decision). Everyone
  // gets the stored widths/order applied; only owners on a non-touch viewport
  // see the resize handles and can drag-reorder columns.
  const canResize = canManageSettings && !isMobile;
  const canReorder = canManageSettings && !isMobile;
  // Non-first header cells need a positioning context for the absolute handle;
  // the frozen .taskFirst is already sticky (a containing block), so it doesn't.
  const relStyle = canResize ? { position: 'relative' } : undefined;
  const handle = (key) =>
    canResize ? <ResizeHandle onMouseDown={(e) => startResize(key, e)} /> : null;

  const TITLE = {
    name: t('myTasks.colName'),
    deadline: t('myTasks.colDeadline'),
    priority: t('myTasks.colPriority'),
    status: t('myTasks.colStatus'),
    notes: t('myTasks.colNotes'),
    discussion: t('myTasks.colDiscussion'),
  };
  // Movable column ids = everything except the frozen, pinned-first name column.
  const movableIds = order.filter((k) => k !== 'name');
  const renderHeaderCell = (key) => {
    if (key === 'sel') {
      return (
        <div key="sel" className={`${styles.taskCell} ${styles.selectCell}`} onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selectAllChecked}
            indeterminate={selectAllIndeterminate}
            onChange={(e) => onToggleSelectAll?.(e.target.checked)}
            ariaLabel="בחר הכל"
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
      <SortableHeaderCell key={key} id={key} className={styles.taskCell} style={relStyle}>
        {inner}
      </SortableHeaderCell>
    ) : (
      <div key={key} className={styles.taskCell} style={relStyle}>{inner}</div>
    );
  };

  return (
    <div className={styles.taskTableScroll}>
      <div
        className={`${styles.taskTable} ${selectable ? styles.selectable : ''}`}
        dir="ltr"
        style={color ? { '--group-color': color } : undefined}
      >
        <div className={`${styles.taskRow} ${styles.taskHead}`} style={rowStyle}>
          <ColumnHeaderDnd enabled={canReorder} ids={movableIds} labels={TITLE} onReorder={reorder}>
            {renderKeys.map(renderHeaderCell)}
          </ColumnHeaderDnd>
        </div>

        {tasks.map((task) => (
          <MyTasksRow
            key={task.id}
            task={task}
            columns={renderKeys}
            rowStyle={rowStyle}
            showDeadline={showDeadline}
            showPriority={showPriority}
            showNotes={showNotes}
            onStatusChange={onStatusChange && canTask('editTaskStatus', task) ? onStatusChange : undefined}
            onPriorityChange={onPriorityChange && canTask('editTaskPriority', task) ? onPriorityChange : undefined}
            onNotesChange={onNotesChange}
            onDeadlineChange={onDeadlineChange && canTask('editTaskDeadline', task) ? onDeadlineChange : undefined}
            onRenameTask={onRenameTask && canTask('editTaskName', task) ? onRenameTask : undefined}
            selectable={selectable}
            selected={selectable ? !!selectedIds?.has(task.id) : false}
            onToggleSelect={onToggleSelect}
          />
        ))}

        {/* add-task footer row — creates inline, seeded with this group's value */}
        {onAddTask && (
          <button type="button" className={styles.addRow} onClick={onAddTask} aria-label="הוסף משימה">
            <span className={styles.addLabel}>+ הוסף משימה</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default MyTasksTable;
