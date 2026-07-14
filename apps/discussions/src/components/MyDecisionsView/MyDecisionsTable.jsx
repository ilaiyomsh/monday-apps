import React from 'react';
import { Checkbox } from '@vibe/core';
import { MyDecisionsRow } from './MyDecisionsRow.jsx';
import { getColumns } from '../../utils/mondayApi/board-config-store.js';
import { useColumnWidths } from '../../hooks/useColumnWidths.js';
import { useColumnOrder } from '../../hooks/useColumnOrder.js';
import { useViewport } from '../../hooks/useViewport.js';
import { ResizeHandle } from '../ResizeHandle';
import { ColumnHeaderDnd, SortableHeaderCell } from '../SortableColumnHeader';
import styles from './MyDecisionsTable.module.css';

// "ההחלטות שלי" board-style table — mirrors MyTasksTable / TaskTable: a frozen
// first column (החלטה), an optional leading selection-checkbox track, and
// owner-draggable column RESIZE + REORDER (useColumnWidths + useColumnOrder under
// the OWN 'myDecisions' tableId, persisted per instance). Column order:
//   name (החלטה, frozen) | decider | affected | priority | status | date | discussion (דיון מקור)
// Status / priority / date are inline-editable PER ROW, gated by the
// board-permissions matrix via `canDecision`. Columns whose alias isn't mapped
// in Settings are HIDDEN (decisions is mapped manually).

// Default widths (px) — local to this table (constants/columnWidths.js carries
// only the My-Tasks tables; decisions keeps its own defs). EVERY column —
// INCLUDING דיון מקור — is a fixed-px RESIZABLE track (the table fills width via
// .taskTable min-width:100%), so the discussion column shrinks/reorders like the
// rest (no fill track that would snap it back to the edge).
const W = {
  name: { default: 300, min: 160, max: 640 },
  decider: { default: 110, min: 80, max: 220 },
  affected: { default: 140, min: 100, max: 280 },
  priority: { default: 130, min: 90, max: 240 },
  status: { default: 160, min: 100, max: 260 },
  date: { default: 130, min: 100, max: 220 },
  discussion: { default: 220, min: 120, max: 480 },
};
// Compact fixed widths for the mobile-app template.
const M = {
  name: '40vw',
  decider: '90px',
  affected: '110px',
  priority: '120px',
  status: '130px',
  date: '110px',
  discussion: '160px',
};

const TITLE = {
  name: 'החלטה',
  decider: 'מחליט',
  affected: 'מושפעים',
  priority: 'עדיפות',
  status: 'סטאטוס',
  date: 'תאריך',
  discussion: 'דיון מקור',
};

export function MyDecisionsTable({
  decisions,
  color,
  canManageSettings = false,
  // Hidden columns (round 46): a Set (or array) of column keys to hide, applied
  // at the final render layer only so persisted column order + widths are kept
  // (a hidden column returns in place when re-shown). Name is never hideable.
  hiddenColumns,
  // Per-decision capability check (board-permissions matrix).
  // `canDecision(cap, decision)` gates each inline editor PER ROW — a false
  // verdict withholds the handler so the cell renders read-only.
  canDecision = () => true,
  // Active name-search term — rows highlight where it matched inside the name.
  searchTerm = '',
  onStatusChange,
  onPriorityChange,
  onDateChange,
  // Inline rename handler (single-row; gated per-row by canDecision). Threaded to
  // each row so the hover pencil appears + inline name-editing works.
  onRenameDecision,
  // Selection (mirrors MyTasksTable). 'sel' is a FIXED 36px leading track pinned
  // first — deliberately kept OUT of useColumnOrder/useColumnWidths persistence
  // so it can never be reordered away or stored.
  selectable = false,
  selectedIds,
  onToggleSelect,
  selectAllChecked = false,
  selectAllIndeterminate = false,
  onToggleSelectAll,
}) {
  const { isMobile } = useViewport();
  const cols = getColumns('decisions') || {};
  const showDecider = !!cols.deciderID?.id;
  const showAffected = !!cols.affectedID?.id;
  const showPriority = !!cols.decisionPriorityID?.id;
  const showDate = !!cols.decisionDateID?.id;
  const showDiscussion = !!cols.discussionLinkID?.id;

  // Visible columns in DEFAULT order, each carrying its width params.
  const baseDefs = [
    { key: 'name', ...W.name },
    showDecider && { key: 'decider', ...W.decider },
    showAffected && { key: 'affected', ...W.affected },
    showPriority && { key: 'priority', ...W.priority },
    { key: 'status', ...W.status },
    showDate && { key: 'date', ...W.date },
    showDiscussion && { key: 'discussion', ...W.discussion },
  ].filter(Boolean);

  // Apply the persisted column ORDER (name pinned first), then drive widths +
  // cell render order from the SAME ordered list so they can never drift.
  const defsByKey = Object.fromEntries(baseDefs.map((d) => [d.key, d]));
  const { order, reorder } = useColumnOrder('myDecisions', baseDefs.map((d) => d.key));

  // Drop hidden columns from the render list (name is never hideable). Kept OUT
  // of useColumnOrder/useColumnWidths so persisted order + widths are preserved.
  const hidden = hiddenColumns instanceof Set ? hiddenColumns : new Set(hiddenColumns || []);
  const visibleOrder = order.filter((k) => k === 'name' || !hidden.has(k));
  const defs = visibleOrder.map((k) => defsByKey[k]).filter(Boolean);

  // 'sel' is a fixed leading track, prepended ONLY for rendering + width
  // measurement — never fed to useColumnOrder (so it can't be persisted or
  // reordered) and skipped by startResize (fixed defs are non-resizable).
  const selDef = selectable ? [{ key: 'sel', fixed: 36 }] : [];
  const renderKeys = selectable ? ['sel', ...visibleOrder] : visibleOrder;

  const { gridTemplate, startResize } = useColumnWidths('myDecisions', [...selDef, ...defs]);
  // On phones use a compact fixed template (shared board-level horizontal
  // scroll, frozen narrow name column). Prepend the fixed 36px selection track.
  const mobileTemplate = [
    ...(selectable ? ['36px'] : []),
    ...defs.map((d) => (d.key === 'name' ? (M.name ?? '40vw') : M[d.key] ?? '140px')),
  ].join(' ');
  const rowStyle = { gridTemplateColumns: isMobile ? mobileTemplate : gridTemplate };

  // Owner-only, mouse-only resize + reorder (everyone gets the stored widths/
  // order applied; only owners on a non-touch viewport see handles + can drag).
  const canResize = canManageSettings && !isMobile;
  const canReorder = canManageSettings && !isMobile;
  // Non-first header cells need a positioning context for the absolute handle;
  // the frozen .taskFirst is already sticky (a containing block), so it doesn't.
  const relStyle = canResize ? { position: 'relative' } : undefined;
  const handle = (key) =>
    canResize ? <ResizeHandle onMouseDown={(e) => startResize(key, e)} /> : null;

  // Movable column ids = every VISIBLE column except the frozen, pinned-first
  // name column (hidden columns aren't rendered, so they can't be dragged;
  // 'sel' is never part of `order`, so it's already excluded).
  const movableIds = visibleOrder.filter((k) => k !== 'name');

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
        // Purple decisions accent by default; a status/priority grouping's label
        // color overrides it (chrome only — label colors come from the column).
        style={{ '--group-color': color || 'var(--decisions-accent, #6b4ee6)' }}
      >
        <div className={`${styles.taskRow} ${styles.taskHead}`} style={rowStyle}>
          <ColumnHeaderDnd enabled={canReorder} ids={movableIds} labels={TITLE} onReorder={reorder}>
            {renderKeys.map(renderHeaderCell)}
          </ColumnHeaderDnd>
        </div>

        {decisions.map((decision) => (
          <MyDecisionsRow
            key={decision.id}
            decision={decision}
            columns={renderKeys}
            rowStyle={rowStyle}
            searchTerm={searchTerm}
            showDecider={showDecider}
            showAffected={showAffected}
            showPriority={showPriority}
            showDate={showDate}
            showDiscussion={showDiscussion}
            onStatusChange={onStatusChange && canDecision('editDecisionStatus', decision) ? onStatusChange : undefined}
            onPriorityChange={onPriorityChange && canDecision('editDecisionPriority', decision) ? onPriorityChange : undefined}
            onDateChange={onDateChange && canDecision('editDecisionDate', decision) ? onDateChange : undefined}
            onRenameDecision={onRenameDecision && canDecision('editDecisionName', decision) ? onRenameDecision : undefined}
            selectable={selectable}
            selected={selectable ? !!selectedIds?.has(decision.id) : false}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </div>
  );
}

export default MyDecisionsTable;
