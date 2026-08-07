import { describe, it, expect } from 'vitest';
import { computeBoundedAnchorStyle } from '../anchorBounds.js';

/*
 * round368 §3 (owner spec) — the point-anchored quick-create card is WIDER, and
 * every added pixel goes to the LEFT: the card's RIGHT edge must stay exactly
 * where it is today ("הנקודה הכי ימנית … תישאר גם הנקודה הכי ימנית").
 * The right edge is therefore still the round243/266 placement (a 280px card
 * centered under the "+", clamped inside the agenda box) — only the left edge
 * moves outward.
 *
 * round369 raised the widening from +50% to +80%; round370 settled it at **+20%**
 * ("אני לא רוצה ב80% אלא ב20%"). Only the scale moves; the pinned-right-edge
 * contract and the viewport-clamp behaviour are unchanged.
 */

// Agenda box occupying x:[100,700] (width 600), y:[200,800] (height 600).
const BOUNDS = { left: 100, top: 200, right: 700, bottom: 800, width: 600, height: 600 };
const anchorAt = (left, bottom, width = 24) => ({ left, bottom, width, top: bottom - 24, right: left + width, height: 24 });
const VW = 1400;

describe('round368 — the card grows leftward, right edge pinned', () => {
  it('is 1.2x the old width, with the same right edge', () => {
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(392, 300), bounds: BOUNDS, viewportWidth: VW });
    // old placement: width 280, left 264 ⇒ right edge 544
    expect(r.width).toBe(336);
    expect(r.left).toBe(208);
    expect(r.left + r.width).toBe(544);
  });

  it('keeps the right edge pinned when the "+" sits at the box right edge', () => {
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(690, 300), bounds: BOUNDS, viewportWidth: VW });
    // old right edge = maxLeft + 280 = 412 + 280 = 692
    expect(r.left + r.width).toBe(692);
    expect(r.width).toBe(336);
  });

  it('the extra width may extend past the agenda box on the LEFT (that is the point)', () => {
    // "+" near the box's left edge: the old card was pinned at left 108 (right 388);
    // the wider card keeps that right edge and reaches left of the box.
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(100, 300), bounds: BOUNDS, viewportWidth: VW });
    expect(r.left + r.width).toBe(388);
    expect(r.left).toBeLessThan(BOUNDS.left);
  });

  it('never leaves the viewport: the left is clamped and the RIGHT edge still holds', () => {
    /*
     * round370 — the clamp fires when the frozen right edge is closer to the
     * viewport's start than the widened card is wide. At 1.2x a card anchored in
     * a box starting at x=100 can no longer reach it (336 < 388-8), so the case
     * is expressed with a box HUGGING the viewport's left edge, which is the real
     * situation it guards: right edge 288, so a 336px card would land at -48.
     */
    const nearOrigin = { left: 0, top: 200, right: 300, bottom: 800, width: 300, height: 600 };
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(0, 300), bounds: nearOrigin, viewportWidth: VW });
    expect(r.left).toBe(8);
    expect(r.left + r.width).toBe(288); // right edge unchanged; width absorbed the clamp
    expect(r.width).toBe(280);
  });

  it('vertical placement and maxHeight are untouched by the widening', () => {
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(392, 300), bounds: BOUNDS, viewportWidth: VW });
    expect(r.top).toBe(308);
    expect(r.maxHeight).toBe(584);
  });

  it('still returns null without both rects', () => {
    expect(computeBoundedAnchorStyle({ anchor: null, bounds: BOUNDS })).toBeNull();
    expect(computeBoundedAnchorStyle({ anchor: anchorAt(300, 300), bounds: null })).toBeNull();
  });
});
