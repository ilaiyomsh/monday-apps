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

  it('opens centered under the "+" and just below it when there is room', () => {
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(392, 300), bounds: BOUNDS });
    // round266 — cardWidth is 280: centerX = 392 + 12 = 404 → left = 404 - 140 = 264
    expect(r.width).toBe(280);
    expect(r.left).toBe(264);
    expect(r.top).toBe(308); // 300 + 8 gap
    expect(r.maxHeight).toBe(584); // 600 - 16
  });

  it('clamps horizontally so the card never crosses the box edges', () => {
    // "+" hard against the box's right edge → card pinned to the right padded edge.
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(690, 300), bounds: BOUNDS });
    expect(r.left).toBe(700 - 280 - 8); // maxLeft = right - width - pad = 412
    // "+" against the left edge → pinned to the left padded edge.
    const l = computeBoundedAnchorStyle({ anchor: anchorAt(100, 300), bounds: BOUNDS });
    expect(l.left).toBe(108); // minLeft = left + pad
  });

  it('slides the card UP when opening below the "+" would overflow the box bottom', () => {
    // "+" near the bottom (bottom=770): desired top 778 would push a 260-tall card
    // past 800; maxTop = bottom - pad - min(est,maxH) = 800 - 8 - 260 = 532.
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(392, 770), bounds: BOUNDS });
    expect(r.top).toBe(532);
  });

  it('caps width to the box when the box is narrower than the card', () => {
    const narrow = { left: 0, top: 0, right: 200, bottom: 600, width: 200, height: 600 };
    const r = computeBoundedAnchorStyle({ anchor: anchorAt(50, 100), bounds: narrow });
    expect(r.width).toBe(200 - 16); // 184
    expect(r.left).toBe(8); // minLeft, since maxLeft collapses to minLeft
  });
});
