/*
 * Per-column width parameters (px) for the resizable data tables.
 * Keyed by a STABLE column identity (NOT the monday column id), namespaced per
 * logical table, so a width survives the owner re-mapping which monday column an
 * alias points to. `default` = initial width; `min`/`max` = drag clamps.
 *
 * Dragged overrides persist in monday.storage under
 * `discussions_column_widths_${instanceId}` (see ColumnWidthsContext); only the
 * deltas from these defaults are stored, so changing a default here moves any
 * not-yet-dragged column.
 */
export const COLUMN_WIDTHS_STORAGE_KEY = 'discussions_column_widths';
// Column ORDER overrides persist separately (same per-instance pattern as widths)
// under `discussions_column_order_${instanceId}`. Shape: { [tableId]: [keys] }.
export const COLUMN_ORDER_STORAGE_KEY = 'discussions_column_order';

// "My Tasks" table — name is the FROZEN column (min kept high so its inline
// controls + sticky origin never collapse — per the owner decision).
export const MY_TASKS_COLUMN_WIDTHS = {
  name: { default: 400, min: 200, max: 760 },
  deadline: { default: 120, min: 90, max: 260 },
  priority: { default: 130, min: 90, max: 280 },
  status: { default: 160, min: 100, max: 320 },
  notes: { default: 200, min: 120, max: 640 },
  // round305 — the two people columns of the personal table: שותפים (always, when
  // mapped) and אחראי (the "בדיונים שהובלתי" scope only).
  assignee: { default: 160, min: 110, max: 340 },
  partners: { default: 180, min: 110, max: 380 },
  discussion: { default: 180, min: 140, max: 420 },
};

// On phones the fixed desktop widths (esp. name 400px) would let a single column
// eat the whole viewport. Use a COMPACT fixed template instead so name + status +
// date are all readable with horizontal scroll (monday-board style). Applied by
// MyTasksTable when isMobile — resize handles are hidden on touch anyway, so the
// shared desktop widths are simply not used on mobile.
// Values are full CSS lengths (with units). The frozen name column uses 22vw so
// it stays UNDER a quarter of the screen on any phone (a quarter = 25vw), leaving
// room for status/date with horizontal scroll.
export const MY_TASKS_MOBILE_WIDTHS = {
  name: '22vw',
  deadline: '110px',
  priority: '110px',
  status: '140px',
  notes: '150px',
  assignee: '130px',
  partners: '140px',
  discussion: '150px',
};

// Discussion task tables (TasksTab / PreviousTasksTab / EffectivenessTab — the
// shared TaskTable). ONE tableId ('tasks') for all three tabs, so a drag in any
// tab applies everywhere. Defaults mirror the previous fixed CSS tracks.
export const TASKS_COLUMN_WIDTHS = {
  name: { default: 320, min: 180, max: 760 },
  priority: { default: 170, min: 110, max: 320 },
  assignee: { default: 140, min: 100, max: 260 },
  deadline: { default: 150, min: 100, max: 280 },
  status: { default: 170, min: 110, max: 320 },
  source: { default: 260, min: 160, max: 520 },
};

// Topics tab points table (one setting shared by every topic group, under the
// shared 'topics' tableId — a drag on ANY topic's column resizes it for all
// topics AND all users of the instance). The lead (accent-bar) track is a fixed
// 28px track at the call site. EVERY data column — INCLUDING `name` — is a
// fixed-px resizable track (shrink/expand parity with the Tasks table); the
// table spans the full width via `.sectionBody { min-width: 100% }` (mirroring
// TaskTable's `.taskTable`) instead of a fill track, so dragging name's border
// actually resizes it (a minmax(w,1fr) fill track snapped back to fill and made
// name feel non-resizable).
export const TOPICS_COLUMN_WIDTHS = {
  name: { default: 360, min: 160, max: 1200 },
  check: { default: 66, min: 52, max: 160 },
  decisions: { default: 168, min: 110, max: 360 },
  tasks: { default: 168, min: 110, max: 360 },
  // round226 — the unified תוצרים column (replaces decisions+tasks in render).
  outputs: { default: 140, min: 96, max: 320 },
};

// Decisions tab table (its OWN 'decisions' tableId — separate widths from the
// task/topics tables). EVERY column — INCLUDING `name` (החלטה) — is a fixed-px
// resizable track (full shrink/expand parity with the Tasks table); the table
// spans the full width via `.decTable { min-width: 100% }` (mirroring
// TaskTable's `.taskTable`) rather than a fill track, so name actually resizes
// when dragged. Owner-draggable + persisted per-instance for all users (same
// store/pattern as the other tables). The עדיפות column was removed from the
// decisions table (product decision), so it has no width entry.
export const DECISIONS_COLUMN_WIDTHS = {
  name: { default: 300, min: 200, max: 900 },
  decider: { default: 130, min: 90, max: 260 },
  affected: { default: 150, min: 100, max: 320 },
  status: { default: 170, min: 110, max: 340 },
  tracking: { default: 180, min: 120, max: 360 },
  date: { default: 120, min: 90, max: 240 },
};
