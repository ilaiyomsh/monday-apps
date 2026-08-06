import { describe, it, expect } from 'vitest';
import { computeBoundedAnchorStyle } from '../anchorBounds.js';

// Agenda box occupying x:[100,700] (width 600), y:[200,800] (height 600).
const BOUNDS = { left: 100, top: 200, right: 700, bottom: 800, width: 600, height: 600 };
// A "+" button ~mid-box.
const anchorAt = (left, bottom, width = 24) => ({ left, bottom, width, top: bottom - 24, right: left + width, height: 24 });

describe('computeBoundedAnchorStyle — confine the quick-create card in the agenda box', () => {
  it('returns null when a rect is missing', () => {
    expect(computeBoundedAnchorStyle({ anchor: null, bounds: BOUNDS })).toBeNull();
    expect(computeBoundedAnchorStyle({ anchor: anchorAt(300, 300), bounds: null })).toBeNull();
  });

  it('opens under the "+" and just below it when there is room', () => {
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(392, 300), bounds: BOUNDS });
    // round266 — the BASE card is 280 wide, centered on the "+": centerX = 404 →
    // base left 264, so its right edge is 544.
    // round368/round369 (owner spec) — the card is 1.8x wider and grows LEFT only,
    // so the right edge stays 544 and the left moves out to 544 - 504 = 40.
    expect(r.width).toBe(504);
    expect(r.left).toBe(40);
    expect(r.left + r.width).toBe(544);
    expect(r.top).toBe(308); // 300 + 8 gap
    expect(r.maxHeight).toBe(584); // 600 - 16
  });

  it('keeps the RIGHT edge inside the box at both extremes (round368: only the left grows out)', () => {
    // "+" hard against the box's right edge → the base card's right padded edge…
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(690, 300), bounds: BOUNDS });
    expect(r.left + r.width).toBe(700 - 8); // base maxLeft 412 + 280 = 692
    // "+" against the left edge → the base card sat at left 108 (right 388); the
    // wider card keeps that right edge, so its left now reaches past the box.
    const l = computeBoundedAnchorStyle({ anchor: anchorAt(100, 300), bounds: BOUNDS });
    expect(l.left + l.width).toBe(388);
  });

  it('slides the card UP when opening below the "+" would overflow the box bottom', () => {
    // "+" near the bottom (bottom=770): desired top 778 would push a 260-tall card
    // past 800; maxTop = bottom - pad - min(est,maxH) = 800 - 8 - 260 = 532.
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(392, 770), bounds: BOUNDS });
    expect(r.top).toBe(532);
  });

  it('caps the BASE width to the box when the box is narrower than the card', () => {
    const narrow = { left: 0, top: 0, right: 200, bottom: 600, width: 200, height: 600 };
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(50, 100), bounds: narrow, viewportWidth: 1400 });
    // base width 184 at left 8 ⇒ right edge 192; round368/369 widens leftward to
    // 1.8x = 331.2, which the viewport clamp then trims back to keep left >= pad.
    expect(r.left).toBe(8);
    expect(r.left + r.width).toBe(192);
    expect(r.width).toBe(184);
  });
});
