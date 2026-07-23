// round160 — owner-editable dashboard layout. This module is the PURE part:
// the widget registry, the default placement, and the grid geometry/mutation
// helpers. The React canvas, the pointer drag/resize wiring, and persistence to
// `settings.preferences.dashboardLayout` all live in DiscussionsDashboard.
//
// Grid model: GRID_COLS columns, a fixed row height. Each widget is a rect
// `{ x, y, w, h }` in whole grid cells, plus a `hidden` flag. Coordinates are
// LTR (x = 0 is the visual LEFT); the canvas sets `direction: ltr` for placement
// while each widget's own content stays RTL.

// round161 — a fine grid (48 cols / 12px rows) so drag & resize move in small
// steps rather than big jumps. Placement is still whole-cell (snapped), but the
// cells are small (~1/4 the round160 step).
export const GRID_COLS = 48;
export const ROW_H = 12;   // px per row unit
export const GRID_GAP = 8; // px between cells

// Bump whenever the grid UNITS change (cols / row height), so a layout saved
// against the old units auto-resets to the new default instead of rendering
// mis-scaled. Stored layouts carry `__v`; a mismatch is treated as "unset".
export const LAYOUT_VERSION = 2;

// The movable/resizable/hideable widgets. `label` is shown in the "hidden" tray.
export const WIDGETS = [
  { id: 'logo', label: 'לוגו' },
  { id: 'filter', label: 'סינון' },
  { id: 'effectiveness', label: 'אפקטיביות דיונים' },
  { id: 'cubeDiscussions', label: 'סך דיונים' },
  { id: 'cubeParticipants', label: 'סך משתתפים בדיונים' },
  { id: 'cubeDecisions', label: 'סך החלטות' },
  { id: 'cubeTasks', label: 'סך משימות' },
  { id: 'bar', label: 'דיונים לפי יום' },
  { id: 'donut', label: 'התפלגות לפי סוג דיון' },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);

// Default placement — approximates the round158/159 three-zone layout: filter
// rail + logo on the left, effectiveness + four cubes in the middle, bar +
// donut on the right, participants under the cubes.
// round163 — the owner's chosen arrangement, adopted as the default for every
// instance (unless edited): filter rail on the left; a 2×2 block of number
// cubes in the middle with the big effectiveness card to its right; the daily
// bar chart across the bottom-middle and the type donut bottom-right. A small
// logo sits top-left above the filter (visible for instances that upload one;
// hideable). All zones end on the same bottom row (34).
export const DEFAULT_LAYOUT = {
  logo:             { x: 0,  y: 0,  w: 12, h: 5 },
  filter:           { x: 0,  y: 5,  w: 12, h: 29 },
  cubeParticipants: { x: 13, y: 0,  w: 7,  h: 6 },
  cubeDiscussions:  { x: 20, y: 0,  w: 7,  h: 6 },
  cubeTasks:        { x: 13, y: 6,  w: 7,  h: 7 },
  cubeDecisions:    { x: 20, y: 6,  w: 7,  h: 7 },
  effectiveness:    { x: 27, y: 0,  w: 21, h: 13 },
  bar:              { x: 13, y: 13, w: 22, h: 21 },
  donut:            { x: 35, y: 13, w: 13, h: 21 },
};

const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));

// Constrain a rect to the grid: w in [1, cols], x so the rect stays inside
// [0, cols], h ≥ 1, y ≥ 0.
export function clampRect(rect, cols = GRID_COLS) {
  const w = clampInt(rect.w, 1, cols);
  const h = Math.max(1, Math.round(rect.h));
  const x = clampInt(rect.x, 0, cols - w);
  const y = Math.max(0, Math.round(rect.y));
  return { x, y, w, h };
}

// Move by whole-cell deltas (drag).
export function moveRect(rect, dCols, dRows, cols = GRID_COLS) {
  return clampRect({ ...rect, x: rect.x + dCols, y: rect.y + dRows }, cols);
}

// Resize from an edge/corner. `dir` contains any of n/s/e/w. Dragging the top
// or left edge moves the opposite-anchored origin (y/x) as it grows/shrinks.
export function resizeRect(rect, dir, dCols, dRows, cols = GRID_COLS) {
  let { x, y, w, h } = rect;
  if (dir.includes('e')) w += dCols;
  if (dir.includes('w')) { x += dCols; w -= dCols; }
  if (dir.includes('s')) h += dRows;
  if (dir.includes('n')) { y += dRows; h -= dRows; }
  // Never let a west/north drag invert the rect past its opposite edge.
  if (w < 1) { if (dir.includes('w')) x -= 1 - w; w = 1; }
  if (h < 1) { if (dir.includes('n')) y -= 1 - h; h = 1; }
  return clampRect({ x, y, w, h }, cols);
}

// Merge a stored (partial / possibly stale) layout over the defaults: every
// known widget is present, unknown keys are dropped, each rect is clamped, and
// `hidden` is coerced to a boolean.
export function resolveLayout(stored, cols = GRID_COLS) {
  // Ignore a layout saved against older grid units (no / mismatched __v).
  const src = stored && typeof stored === 'object' && stored.__v === LAYOUT_VERSION ? stored : null;
  const out = {};
  for (const id of WIDGET_IDS) {
    const d = DEFAULT_LAYOUT[id];
    const s = src ? src[id] : null;
    const rect = s
      ? clampRect({ x: s.x ?? d.x, y: s.y ?? d.y, w: s.w ?? d.w, h: s.h ?? d.h }, cols)
      : { ...d };
    out[id] = { ...rect, hidden: !!(s && s.hidden) };
  }
  return out;
}

// Rows the canvas must be tall enough to show every VISIBLE widget.
export function layoutRows(layout) {
  let rows = 0;
  for (const id of WIDGET_IDS) {
    const it = layout[id];
    if (it && !it.hidden) rows = Math.max(rows, it.y + it.h);
  }
  return rows;
}

// Column width in px for a given container width.
function colWidth(containerWidth, cols, gap) {
  return (containerWidth - (cols - 1) * gap) / cols;
}

// px geometry (absolute placement) for a rect at a given container width.
export function rectToPx(rect, containerWidth, cols = GRID_COLS, rowH = ROW_H, gap = GRID_GAP) {
  const colW = colWidth(containerWidth, cols, gap);
  return {
    left: rect.x * (colW + gap),
    top: rect.y * (rowH + gap),
    width: rect.w * colW + (rect.w - 1) * gap,
    height: rect.h * rowH + (rect.h - 1) * gap,
  };
}

// Convert a px drag delta to whole-cell deltas (snapping).
export function pxDeltaToCells(dxPx, dyPx, containerWidth, cols = GRID_COLS, rowH = ROW_H, gap = GRID_GAP) {
  const colW = colWidth(containerWidth, cols, gap);
  return {
    dCols: Math.round(dxPx / (colW + gap)),
    dRows: Math.round(dyPx / (rowH + gap)),
  };
}
