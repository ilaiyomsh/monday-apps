import { describe, it, expect } from 'vitest';
import {
  GRID_COLS, ROW_H, GRID_GAP, LAYOUT_VERSION, DEFAULT_LAYOUT, WIDGET_IDS,
  clampRect, moveRect, resizeRect, resolveLayout, layoutRows, rectToPx, pxDeltaToCells,
} from '../dashboardLayout.js';

// round160 — the owner-editable dashboard layout's pure geometry. These pin the
// clamping, the edge-anchored resize, the stored-over-default merge, and the
// px↔cell conversions that the drag/resize canvas relies on.

describe('clampRect', () => {
  it('keeps w in [1, cols] and x so the rect stays inside the grid', () => {
    expect(clampRect({ x: 5, y: 2, w: 4, h: 3 })).toEqual({ x: 5, y: 2, w: 4, h: 3 });
    // w over the grid width is capped, then x is pulled back in
    expect(clampRect({ x: GRID_COLS - 1, y: 0, w: GRID_COLS + 8, h: 3 })).toEqual({ x: 0, y: 0, w: GRID_COLS, h: 3 });
    // a rect pushed past the right edge slides left to fit (x = cols - w)
    expect(clampRect({ x: GRID_COLS - 1, y: 0, w: 3, h: 1 })).toEqual({ x: GRID_COLS - 3, y: 0, w: 3, h: 1 });
    // w<1 and negatives floor to the minimum
    expect(clampRect({ x: -4, y: -2, w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('moveRect', () => {
  it('shifts by whole cells and clamps to the grid', () => {
    expect(moveRect({ x: 2, y: 2, w: 3, h: 2 }, 1, -1)).toEqual({ x: 3, y: 1, w: 3, h: 2 });
    // cannot move off the top or past the right edge
    expect(moveRect({ x: GRID_COLS - 3, y: 0, w: 3, h: 2 }, 5, -5)).toEqual({ x: GRID_COLS - 3, y: 0, w: 3, h: 2 });
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

  /*
   * round340 (owner request) — the LOGO widget starts HIDDEN; every other widget still
   * starts visible. With no logo uploaded the widget rendered a grey "לוגו" placeholder
   * card, so the old default spent a block of every personal dashboard on an empty box.
   * The owner's wording is the spec: it appears "only if they chose to add it during
   * editing", i.e. via the layout editor's show/hide.
   */
  it('starts the logo widget HIDDEN and every other widget visible', () => {
    const l = resolveLayout(null);
    expect(l.logo.hidden).toBe(true);
    WIDGET_IDS.filter((id) => id !== 'logo').forEach((id) => expect(l[id].hidden).toBe(false));
  });

  /*
   * …and an explicit choice still wins in BOTH directions. This is the whole reason the
   * default is applied per-widget on "no stored entry" rather than by flipping the
   * coercion: an owner who deliberately unhid the logo must keep it, and their stored
   * `hidden: false` is indistinguishable from a default one unless the absence of the
   * entry is what selects the default.
   */
  it('lets a stored choice override the logo default either way', () => {
    const shown = resolveLayout({ __v: LAYOUT_VERSION, logo: { ...DEFAULT_LAYOUT.logo, hidden: false } });
    expect(shown.logo.hidden).toBe(false);
    const hiddenBar = resolveLayout({ __v: LAYOUT_VERSION, bar: { ...DEFAULT_LAYOUT.bar, hidden: true } });
    expect(hiddenBar.bar.hidden).toBe(true);
    // a stored layout that simply says nothing about the logo still hides it
    expect(hiddenBar.logo.hidden).toBe(true);
  });
  it('merges a stored rect over the default, clamps it, coerces hidden, drops unknowns', () => {
    const l = resolveLayout({ __v: LAYOUT_VERSION, bar: { x: 1, y: 1, w: 99, h: 4, hidden: true }, bogusWidget: { x: 0 } });
    expect(l.bar).toEqual({ x: 0, y: 1, w: GRID_COLS, h: 4, hidden: true }); // w capped, x pulled in
    expect(l.donut).toMatchObject({ ...DEFAULT_LAYOUT.donut, hidden: false }); // untouched → default
    expect(l.bogusWidget).toBeUndefined();
  });
  it('ignores a layout saved against an older grid version (auto-reset to default)', () => {
    // no __v (round160 format) and a wrong __v are both treated as unset
    const oldFmt = resolveLayout({ bar: { x: 5, y: 5, w: 6, h: 7 } });
    expect(oldFmt.bar).toMatchObject({ ...DEFAULT_LAYOUT.bar, hidden: false });
    const wrongV = resolveLayout({ __v: LAYOUT_VERSION - 1, bar: { x: 5, y: 5, w: 6, h: 7 } });
    expect(wrongV.bar).toMatchObject({ ...DEFAULT_LAYOUT.bar, hidden: false });
  });
});

describe('layoutRows', () => {
  it('is the max y+h across VISIBLE widgets only', () => {
    const base = resolveLayout(null);
    const maxBottom = Math.max(...WIDGET_IDS.map((id) => DEFAULT_LAYOUT[id].y + DEFAULT_LAYOUT[id].h));
    expect(layoutRows(base)).toBe(maxBottom);
    // hiding every widget but the (short) logo leaves just the logo's bottom. The logo
    // needs an EXPLICIT hidden:false here — round340 made hidden its default.
    const stored = { __v: LAYOUT_VERSION };
    WIDGET_IDS.forEach((id) => { stored[id] = { ...DEFAULT_LAYOUT[id], hidden: id !== 'logo' }; });
    expect(layoutRows(resolveLayout(stored))).toBe(DEFAULT_LAYOUT.logo.y + DEFAULT_LAYOUT.logo.h);
  });
});

describe('rectToPx / pxDeltaToCells round-trip', () => {
  it('places a rect and snaps a px delta back to the same cell count', () => {
    const W = 1200; // container width
    const px = rectToPx({ x: 2, y: 1, w: 4, h: 3 }, W);
    expect(px.left).toBeGreaterThan(0);
    expect(px.width).toBeGreaterThan(0);
    // a delta of exactly one column (+gap) snaps to one cell
    const colW = rectToPx({ x: 0, y: 0, w: 1, h: 1 }, W).width;
    expect(pxDeltaToCells(colW + GRID_GAP, 0, W).dCols).toBe(1);
    expect(pxDeltaToCells(0, ROW_H + GRID_GAP, W).dRows).toBe(1); // one row + gap
  });
});
