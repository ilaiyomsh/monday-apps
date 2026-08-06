import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
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
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useDropdownOptions } from '@generated/hooks/useDropdownOptions';
import { useRelationItems } from '@generated/hooks/useRelationItems.js';
import { CustomStatusCollector } from '@generated/components/CustomStatusCollector';
import { collectedEquals } from './collectedEquals.js';
import { getColumns } from '@api/board-config-store.js';
import { ResizeHandle } from '@generated/components/ResizeHandle';
import { ColumnHeaderDnd, SortableHeaderCell } from '@generated/components/SortableColumnHeader';
import { TASKS_COLUMN_WIDTHS as W } from '@generated/constants/columnWidths.js';
import { useColumnRenameMenu } from '@generated/components/ColumnRenameMenu';
import { customEntriesFor } from '@generated/utils/customColumns.js';
import styles from './TaskTable.module.css';

/*
 * round366 — one options loader per custom DROPDOWN column (rules-of-hooks
 * forbid a variable-length hook loop in the table body; per-row hooks are the
 * round136 anti-pattern). Renders nothing; reports the board's label options up.
 */
function DropdownOptionsCollector({ alias, onOptions }) {
  const opts = useDropdownOptions('tasks', alias);
  useEffect(() => { onOptions(alias, opts); }, [alias, opts, onOptions]);
  return null;
}

/*
 * round368 §4 — the same one-loader-per-COLUMN shape for a custom RELATION
 * ("connected board") column: it reports the linked board's candidate items so
 * the cell can add/remove links. Per column, never per row.
 */
function RelationItemsCollector({ alias, onItems }) {
  const rel = useRelationItems('tasks', alias);
  useEffect(() => { onItems(alias, rel); }, [alias, rel, onItems]);
  return null;
}

// Header titles per column key (name has none — it's the frozen first column).
const TITLE = { name: '', assignee: 'אחראי', partners: 'שותפים', deadline: 'דד ליין', status: 'סטאטוס', priority: 'עדיפות', source: 'דיון מקור' };
// Desktop column widths are draggable + persisted (per-instance) via
// useColumnWidths under the SHARED 'tasks' tableId — one setting for TasksTab /
// PreviousTasksTab / EffectivenessTab (defaults in constants/columnWidths.js).
// Mobile keeps the compact fixed template with the shrinking --name-col.
const MOBILE_TRACK = { sel: '36px', name: '50vw', assignee: '110px', partners: '120px', deadline: '120px', status: '140px', priority: '140px', source: '225px' };

export function TaskTable({
  tasks,
  color,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  // round306 — שותפים (partnersID) inline edit, gated per row by editTaskPartners.
  onPartnersChange,
  onDeadlineChange,
  // round366 — inline edit of an owner-added custom column: (taskId, alias,
  // value). Gated per row by editTaskCustomColumns; absent ⇒ read-only cells.
  onCustomChange,
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
  // Optimistic-create error affordance, threaded to each row (see TaskTableRow):
  // retry re-runs a failed create; dismiss removes the failed temp row locally.
  onRetryCreate,
  onDismissRow,
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
  // Hidden columns (round 47): a Set (or array) of column keys to hide, applied
  // at the render layer ONLY (order/width persistence untouched). The pinned name
  // (+ sel) columns are never hideable. Empty/undefined ⇒ every column shows, so
  // callers that don't pass it (EffectivenessTab) are unaffected.
  hiddenColumns,
}) {
  const { isMobile } = useViewport();

  /*
   * Visible columns in DEFAULT order. 'sel' is a pinned, fixed leading track (the
   * selection checkbox), present only when the table is selectable. 'source' is the
   * דיונים-קודמים-only "דיון מקור" column.
   *
   * round341 (owner request, from screenshots of the משימות and דיונים קודמים tabs) —
   * the starting order is now:
   *   name · אחראי · שותפים · עדיפות · דד ליין · סטאטוס · דיון מקור
   * i.e. עדיפות moved from second place to AFTER the two people columns, so the two
   * "who" columns sit together and the state columns follow them.
   *
   * STARTING order only: useColumnOrder keeps whatever an instance already dragged
   * (utils/columnOrder.js merges stored-and-still-visible keys first), so this changes
   * fresh installs, not existing ones.
   */
  const showPartners = !!(getColumns('tasks') || {}).partnersID?.id;
  /*
   * round364 — owner-added custom mappings (customEntriesFor: `custom<N>ID`
   * aliases on the tasks board) render as READ-ONLY trailing columns. The alias
   * IS the column key, so order/width/rename prefs persist per custom column
   * through the same 'tasks' stores every other key uses.
   */
  const customCols = useMemo(
    () => customEntriesFor(getColumns('tasks'))
      .filter(([, col]) => col?.id)
      .map(([alias, col]) => ({ alias, type: col.type, title: col.title || alias })),
    // getColumns reads the module-level published settings — same freshness
    // contract as showPartners above (re-render on settings save remounts).
    []
  );
  const baseKeys = [
    ...(selectable ? ['sel'] : []),
    'name',
    'assignee',
    ...(showPartners ? ['partners'] : []),
    ...(showPriority ? ['priority'] : []),
    'deadline', 'status',
    ...(showSourceDiscussion ? ['source'] : []),
    ...customCols.map((c) => c.alias),
  ];
  const pinned = selectable ? ['sel', 'name'] : ['name'];
  const { order, reorder } = useColumnOrder('tasks', baseKeys, pinned);

  // Hidden columns (round 47) applied at the render layer only: drop hidden keys
  // from the ORDER used to render, keeping the pinned name (+ sel) always. The
  // useColumnOrder/useColumnWidths inputs stay on the full set, so a hidden
  // column keeps its stored order + width and returns in place when re-shown.
  // round136 — memoized: `columns` is passed to every (memoized) row, so its
  // identity must only change when the order/hidden set actually changes.
  const visibleOrder = useMemo(() => {
    const hidden = hiddenColumns instanceof Set ? hiddenColumns : new Set(hiddenColumns || []);
    return order.filter((k) => k === 'name' || k === 'sel' || !hidden.has(k));
  }, [order, hiddenColumns]);

  // round136 (perf audit) — ONE status/priority option hook pair per TABLE,
  // passed to rows as props. Previously every row mounted its own two hook
  // instances (2N store subscriptions + 2N effects on an N-row table).
  const statusOpts = useStatusOptions();
  const priorityOpts = useStatusOptions('tasks', 'priorityID');

  /*
   * round366 — dropdown CUSTOM columns need their board label options for the
   * inline editor. Hooks can't run in a variable-length loop, so each dropdown
   * column mounts ONE collector component (per COLUMN, not per row — the
   * round136 perf rule) that reports its options up into this map.
   *
   * round370 — both setters bail on collectedEquals, not on `===`. A collected
   * hook that rebuilds its view object each render would otherwise make the
   * report-up effect fire forever (state → render → new object → state …), which
   * is precisely how a custom relation column froze the whole tab.
   */
  const [customDropdownOptions, setCustomDropdownOptions] = useState({});
  const reportDropdownOptions = useCallback((alias, opts) => {
    setCustomDropdownOptions((m) => (collectedEquals(m[alias], opts) ? m : { ...m, [alias]: opts }));
  }, []);
  const customDropdownCols = customCols.filter((c) => c.type === 'dropdown');
  // round368 — candidate items per custom relation column (same collector shape).
  const [customRelationOptions, setCustomRelationOptions] = useState({});
  const reportRelationItems = useCallback((alias, rel) => {
    setCustomRelationOptions((m) => (collectedEquals(m[alias], rel) ? m : { ...m, [alias]: rel }));
  }, []);
  const customRelationCols = customCols.filter((c) => c.type === 'board_relation' || c.type === 'connect_boards');
  // round372 — label options per custom STATUS column (same collector shape).
  const [customStatusOptions, setCustomStatusOptions] = useState({});
  const reportStatusOptions = useCallback((alias, opts) => {
    setCustomStatusOptions((m) => (collectedEquals(m[alias], opts) ? m : { ...m, [alias]: opts }));
  }, []);
  const customStatusCols = customCols.filter((c) => c.type === 'status' || c.type === 'color');

  // Width defs follow the live VISIBLE order; 'sel' is a fixed (non-resizable)
  // leading track, everything else resizes within the constants' clamps.
  // round364 — a custom key has no entry in the width constants; without a
  // fallback the grid template gets a literal "undefinedpx" track and the whole
  // table collapses. Mobile likewise needs a real track per key, or the
  // template ends up SHORTER than the cell count and every row misaligns.
  const CUSTOM_W = { default: 140, min: 90, max: 400 };
  const defs = visibleOrder.map((k) => (k === 'sel' ? { key: 'sel', fixed: 36 } : { key: k, ...(W[k] || CUSTOM_W) }));
  const { gridTemplate, startResize } = useColumnWidths('tasks', defs);
  const mobileTemplate = visibleOrder.map((k) => MOBILE_TRACK[k] || '130px').join(' ');
  // round136 — memoized so the (memoized) rows' rowStyle prop is referentially
  // stable while the template string is unchanged.
  const rowStyle = useMemo(
    () => ({ gridTemplateColumns: isMobile ? mobileTemplate : gridTemplate }),
    [isMobile, mobileTemplate, gridTemplate]
  );

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
  // round140 — owner-only column display names: hover a header → "⋯" → rename
  // for all users (stored in the shared settings, like saved views).
  // round364 — custom keys join the base title map (their live column title),
  // which is what makes them renamable + labeled in the header/DnD overlay.
  const titlesWithCustom = useMemo(
    () => (customCols.length
      ? { ...TITLE, ...Object.fromEntries(customCols.map((c) => [c.alias, c.title])) }
      : TITLE),
    [customCols]
  );
  const { titles: colTitles, dots: renameDots, menu: renameMenu } =
    useColumnRenameMenu('tasks', titlesWithCustom, { canManageSettings, dotsClassName: styles.renameDots });
  const movableIds = visibleOrder.filter((k) => k !== 'name' && k !== 'sel');
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
          {colTitles.name}
          {renameDots('name')}
          {handle('name')}
        </div>
      );
    }
    const inner = (<>{colTitles[key]}{renameDots(key)}{handle(key)}</>);
    return canReorder ? (
      <SortableHeaderCell key={key} id={key} className={styles.taskCell} style={relStyle}>{inner}</SortableHeaderCell>
    ) : (
      <div key={key} className={styles.taskCell} style={relStyle}>{inner}</div>
    );
  };

  const tableClass = `${styles.taskTable} ${selectable ? styles.selectable : ''}`;
  return (
    <div className={styles.taskTableScroll}>
      {renameMenu}
      {onCustomChange && customDropdownCols.map((c) => (
        <DropdownOptionsCollector key={c.alias} alias={c.alias} onOptions={reportDropdownOptions} />
      ))}
      {onCustomChange && customRelationCols.map((c) => (
        <RelationItemsCollector key={c.alias} alias={c.alias} onItems={reportRelationItems} />
      ))}
      {customStatusCols.map((c) => (
        <CustomStatusCollector key={c.alias} alias={c.alias} onOptions={reportStatusOptions} />
      ))}
      <div className={tableClass} dir="ltr" style={color ? { '--group-color': color } : undefined}>
        {/* header */}
        <div className={`${styles.taskRow} ${styles.taskHead}`} style={rowStyle}>
          <ColumnHeaderDnd enabled={canReorder} ids={movableIds} labels={colTitles} onReorder={reorder}>
            {visibleOrder.map(renderHeaderCell)}
          </ColumnHeaderDnd>
        </div>

        {/* rows */}
        {(() => {
          const renderRow = (task, drag) => (
            <TaskTableRow
              key={task.id}
              task={task}
              statusOpts={statusOpts}
              priorityOpts={priorityOpts}
              customColumns={customCols}
              columns={visibleOrder}
              rowStyle={rowStyle}
              onStatusChange={onStatusChange && canTask('editTaskStatus', task) ? onStatusChange : undefined}
              onPriorityChange={onPriorityChange && canTask('editTaskPriority', task) ? onPriorityChange : undefined}
              onAssigneeChange={onAssigneeChange && canTask('editTaskAssignee', task) ? onAssigneeChange : undefined}
              onPartnersChange={onPartnersChange && canTask('editTaskPartners', task) ? onPartnersChange : undefined}
              onDeadlineChange={onDeadlineChange && canTask('editTaskDeadline', task) ? onDeadlineChange : undefined}
              onCustomChange={onCustomChange && canTask('editTaskCustomColumns', task) ? onCustomChange : undefined}
              customDropdownOptions={customDropdownOptions}
              customRelationOptions={customRelationOptions}
              customStatusOptions={customStatusOptions}
              onRenameTask={onRenameTask && canTask('editTaskName', task) ? onRenameTask : undefined}
              onDeleteTask={onDeleteTask}
              onRetryCreate={onRetryCreate}
              onDismissRow={onDismissRow}
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
