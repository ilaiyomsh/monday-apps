import React, { useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@vibe/core';
import { MyTasksRow } from './MyTasksRow.jsx';
import { getColumns } from '../../utils/mondayApi/board-config-store.js';
import { useStatusOptions } from '../../hooks/useStatusOptions';
import { useColumnWidths } from '../../hooks/useColumnWidths.js';
import { useColumnOrder } from '../../hooks/useColumnOrder.js';
import { useViewport } from '../../hooks/useViewport.js';
import { ResizeHandle } from '../ResizeHandle';
import { ColumnHeaderDnd, SortableHeaderCell } from '../SortableColumnHeader';
import { MY_TASKS_COLUMN_WIDTHS as W, MY_TASKS_MOBILE_WIDTHS as M } from '../../constants/columnWidths.js';
import { useColumnRenameMenu } from '@generated/components/ColumnRenameMenu';
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
  // Hidden columns (round 46): a Set (or array) of column keys to hide. Applied
  // at the final render layer only — column order/width persistence is untouched,
  // so a hidden column keeps its stored position/width and returns in place when
  // re-shown. The primary name column is never hideable.
  hiddenColumns,
  onStatusChange,
  onPriorityChange,
  onNotesChange,
  onDeadlineChange,
  onRenameTask,
  // round305 — שותפים (partnersID) inline edit, gated per row by editTaskPartners.
  onPartnersChange,
  // round305 — the אחראי (responsibility) column is rendered ONLY in the
  // "בדיונים שהובלתי" scope, where the tasks are other people's (in the default
  // scope every row is the current user's own, so the column says nothing).
  showAssignee = false,
  // Per-task capability check (board-permissions matrix). `canTask(cap, task)`
  // gates each inline editor PER ROW — a false verdict withholds the handler so
  // the row renders that cell read-only. Defaults to allow-all.
  canTask = () => true,
  // Active name-search term — rows highlight where it matched inside the name.
  searchTerm = '',
  // Inline "+ הוסף משימה" footer row (same as TasksTab). When provided, a click
  // creates a task IMMEDIATELY, seeded with this group's status/priority.
  onAddTask,
  // Inline "new task" draft row pinned as the FIRST row of this table (top of
  // the topmost group). When provided, its name cell is a focused, pre-selected
  // text input: typing + Enter (or blur) commits via onCommit(name); Escape
  // discards via onCancel(). Only the topmost group receives this (from the blue
  // "משימה חדשה" toolbar button) — it is what makes a new task appear at the very
  // top in edit mode, instead of being created with a fixed name at the bottom.
  newTaskRow = null,
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
  // round305 — both people columns need their alias mapped to render at all.
  const showPartners = !!cols.partnersID?.id;
  const showAssigneeCol = showAssignee && !!cols.responsibilityID?.id;

  // Visible columns in DEFAULT order, each carrying its width params.
  const baseDefs = [
    { key: 'name', ...W.name },
    showAssigneeCol && { key: 'assignee', ...W.assignee },
    showPartners && { key: 'partners', ...W.partners },
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

  // Drop hidden columns from the render list (name is never hideable). Kept OUT
  // of useColumnOrder/useColumnWidths so persisted order + widths are preserved.
  const hidden = hiddenColumns instanceof Set ? hiddenColumns : new Set(hiddenColumns || []);
  const visibleOrder = order.filter((k) => k === 'name' || !hidden.has(k));
  const defs = visibleOrder.map((k) => defsByKey[k]).filter(Boolean);

  // 'sel' is a fixed leading track, prepended ONLY for rendering + width
  // measurement — never fed to useColumnOrder (so it can't be persisted or
  // reordered) and skipped by startResize (fixed defs are non-resizable).
  const selDef = selectable ? [{ key: 'sel', fixed: 36 }] : [];
  // round136 — memoized: passed to every memoized row as `columns`.
  const renderKeys = useMemo(
    () => (selectable ? ['sel', ...visibleOrder] : visibleOrder),
    // visibleOrder derives from order+hidden; join is a cheap stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectable, visibleOrder.join('|')]
  );

  // round136 (perf audit) — ONE status/priority option hook pair per TABLE,
  // passed to rows as props (was two hook instances per row).
  const statusOpts = useStatusOptions('tasks', 'statusID');
  const priorityOpts = useStatusOptions('tasks', 'priorityID');

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
  // round136 — memoized for the memoized rows' referential stability.
  const rowStyle = useMemo(
    () => ({ gridTemplateColumns: isMobile ? mobileTemplate : gridTemplate }),
    [isMobile, mobileTemplate, gridTemplate]
  );

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
    assignee: t('myTasks.colAssignee'),
    partners: t('myTasks.colPartners'),
    discussion: t('myTasks.colDiscussion'),
  };
  // round140 — owner-only column display names (shared per-instance overrides).
  const { titles: colTitles, dots: renameDots, menu: renameMenu } =
    useColumnRenameMenu('myTasks', TITLE, { canManageSettings, dotsClassName: styles.renameDots });
  // Movable column ids = every VISIBLE column except the frozen, pinned-first
  // name column (hidden columns aren't rendered, so they can't be dragged).
  const movableIds = visibleOrder.filter((k) => k !== 'name');
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
          {colTitles.name}
          {renameDots('name')}
          {handle('name')}
        </div>
      );
    }
    const inner = (<>{colTitles[key]}{renameDots(key)}{handle(key)}</>);
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
      {renameMenu}
      <div
        className={`${styles.taskTable} ${selectable ? styles.selectable : ''}`}
        dir="ltr"
        style={color ? { '--group-color': color } : undefined}
      >
        <div className={`${styles.taskRow} ${styles.taskHead}`} style={rowStyle}>
          <ColumnHeaderDnd enabled={canReorder} ids={movableIds} labels={colTitles} onReorder={reorder}>
            {renderKeys.map(renderHeaderCell)}
          </ColumnHeaderDnd>
        </div>

        {newTaskRow ? (
          <NewTaskDraftRow
            columns={renderKeys}
            rowStyle={rowStyle}
            defaultName={newTaskRow.defaultName}
            onCommit={newTaskRow.onCommit}
            onCancel={newTaskRow.onCancel}
          />
        ) : null}

        {tasks.map((task) => (
          <MyTasksRow
            key={task.id}
            task={task}
            statusOpts={statusOpts}
            priorityOpts={priorityOpts}
            columns={renderKeys}
            rowStyle={rowStyle}
            searchTerm={searchTerm}
            showDeadline={showDeadline}
            showPriority={showPriority}
            showNotes={showNotes}
            showPartners={showPartners}
            showAssignee={showAssigneeCol}
            onPartnersChange={onPartnersChange && canTask('editTaskPartners', task) ? onPartnersChange : undefined}
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

// Inline "new task" draft row (rendered as the FIRST row of the topmost group).
// Mirrors a body row's grid: every cell is empty except NAME, which holds a text
// input focused with its text pre-SELECTED on mount — so the user types the name
// immediately (first keystroke replaces the default) and Enter commits, creating
// the task. Blur commits too; Escape discards. The `done` guard makes the three
// exits mutually exclusive so Enter/blur can't double-fire a create. Mirrors the
// in-discussion TaskTable inline add-row + the MyTasksRow rename input.
function NewTaskDraftRow({ columns, rowStyle, defaultName, onCommit, onCancel }) {
  const inputRef = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit?.(inputRef.current ? inputRef.current.value : '');
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel?.();
  };
  return (
    <div className={`${styles.taskRow} ${styles.newRow}`} style={rowStyle}>
      {columns.map((key) => {
        if (key === 'name') {
          return (
            <div key="name" className={`${styles.taskCell} ${styles.taskFirst}`}>
              <input
                ref={inputRef}
                className={styles.newNameInput}
                defaultValue={defaultName}
                aria-label="שם משימה חדשה"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commit(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                }}
                onBlur={commit}
              />
            </div>
          );
        }
        if (key === 'sel') {
          return <div key="sel" className={`${styles.taskCell} ${styles.selectCell}`} />;
        }
        return <div key={key} className={styles.taskCell} />;
      })}
    </div>
  );
}

export default MyTasksTable;
