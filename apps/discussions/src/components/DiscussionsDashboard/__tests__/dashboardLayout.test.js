import { describe, it, expect } from 'vitest';
import {
  GRID_COLS, DEFAULT_LAYOUT, WIDGET_IDS,
  clampRect, moveRect, resizeRect, resolveLayout, layoutRows, rectToPx, pxDeltaToCells,
} from '../dashboardLayout.js';

// round160 — the owner-editable dashboard layout's pure geometry. These pin the
// clamping, the edge-anchored resize, the stored-over-default merge, and the
// px↔cell conversions that the drag/resize canvas relies on.

describe('clampRect', () => {
  it('keeps w in [1, cols] and x so the rect stays inside the grid', () => {
    expect(clampRect({ x: 5, y: 2, w: 4, h: 3 })).toEqual({ x: 5, y: 2, w: 4, h: 3 });
    // w over the grid width is capped, then x is pulled back in
    expect(clampRect({ x: 11, y: 0, w: 20, h: 3 })).toEqual({ x: 0, y: 0, w: GRID_COLS, h: 3 });
    // a rect pushed past the right edge slides left to fit (x = cols - w)
    expect(clampRect({ x: 11, y: 0, w: 3, h: 1 })).toEqual({ x: GRID_COLS - 3, y: 0, w: 3, h: 1 });
    // w<1 and negatives floor to the minimum
    expect(clampRect({ x: -4, y: -2, w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('moveRect', () => {
  it('shifts by whole cells and clamps to the grid', () => {
    expect(moveRect({ x: 2, y: 2, w: 3, h: 2 }, 1, -1)).toEqual({ x: 3, y: 1, w: 3, h: 2 });
    // cannot move off the top or past the right edge
    expect(moveRect({ x: 10, y: 0, w: 3, h: 2 }, 5, -5)).toEqual({ x: GRID_COLS - 3, y: 0, w: 3, h: 2 });
  });
});

describe('resizeRect', () => {
  it('east/south grow from the far edge (origin fixed)', () => {
    expect(resizeRect({ x: 2, y: 2, w: 3, h: 2 }, 'e', 2, 0)).toEqual({ x: 2, y: 2, w: 5, h: 2 });
    expect(resizeRect({ x: 2, y: 2, w: 3, h: 2 }, 's', 0, 3)).toEqual({ x: 2, y: 2, w: 3, h: 5 });
  });
  it('west/north move the origin as they resize', () => {
    // dragging the west edge left by 2: x -= 2, w += 2
    expect(resizeRect({ x: 4, y: 2, w: 3, h: 2 }, 'w', -2, 0)).toEqual({ x: 2, y: 2, w: 5, h: 2 });
    // dragging the north edge up by 1: y -= 1, h += 1
    expect(resizeRect({ x: 4, y: 3, w: 3, h: 2 }, 'n', 0, -1)).toEqual({ x: 4, y: 2, w: 3, h: 3 });
  });
  it('never inverts: shrinking a west edge past the far edge floors to w=1', () => {
    const r = resizeRect({ x: 2, y: 2, w: 3, h: 2 }, 'w', 5, 0);
    expect(r.w).toBe(1);
    expect(r.x).toBe(4); // the east edge (x+w = 5) is preserved
  });
});

describe('resolveLayout', () => {
  it('returns every widget from the defaults when nothing is stored', () => {
    const l = resolveLayout(null);
    expect(Object.keys(l).sort()).toEqual([...WIDGET_IDS].sort());
    expect(l.bar).toMatchObject({ ...DEFAULT_LAYOUT.bar, hidden: false });
  });
  it('merges a stored rect over the default, clamps it, coerces hidden, drops unknowns', () => {
    const l = resolveLayout({ bar: { x: 1, y: 1, w: 99, h: 4, hidden: true }, bogusWidget: { x: 0 } });
    expect(l.bar).toEqual({ x: 0, y: 1, w: GRID_COLS, h: 4, hidden: true }); // w capped, x pulled in
    expect(l.donut).toMatchObject({ ...DEFAULT_LAYOUT.donut, hidden: false }); // untouched → default
    expect(l.bogusWidget).toBeUndefined();
  });
});

describe('layoutRows', () => {
  it('is the max y+h across VISIBLE widgets only', () => {
    const base = resolveLayout(null);
    const rows = layoutRows(base);
    // participants default is y7+h8 = 15; filter y3+h14 = 17 (tallest)
    expect(rows).toBe(17);
    // hiding the tall filter lowers the needed rows
    const hidden = resolveLayout({ filter: { ...DEFAULT_LAYOUT.filter, hidden: true } });
    expect(layoutRows(hidden)).toBe(15);
  });
});

describe('rectToPx / pxDeltaToCells round-trip', () => {
  it('places a rect and snaps a px delta back to the same cell count', () => {
    const W = 1200; // container width
    const px = rectToPx({ x: 2, y: 1, w: 4, h: 3 }, W);
    expect(px.left).toBeGreaterThan(0);
    expect(px.width).toBeGreaterThan(0);
    // one column-step of px delta resolves to exactly one cell
    const colStep = (px.width) / 4 + 12; // ~ one col + gap
    expect(pxDeltaToCells(colStep, 0, W).dCols).toBe(1);
    expect(pxDeltaToCells(0, 48, W).dRows).toBe(1); // 36px row + 12 gap = 48
  });
});
