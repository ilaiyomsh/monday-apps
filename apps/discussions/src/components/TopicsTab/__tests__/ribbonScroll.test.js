import { describe, it, expect } from 'vitest';
import {
  maxPos, readPos, writePos, computeEdges, computeThumb, posFromThumbDrag, stepFrom,
} from '../ribbonScroll.js';

// round302 — the ribbon's RTL scroll math. These tests exist because the naive
// version of this (probe the scrollLeft sign once, cache it) silently produced a
// strip that could not scroll AT ALL: the probe ran before the strip overflowed,
// read 0, and picked the wrong direction. Both engine conventions are simulated.

// Both fixtures clamp against the CURRENT scrollWidth (recomputed per write, like
// a real element), so a test can grow the content mid-flight.
/** A scroller whose scrollLeft goes 0 → -max (Chromium/Firefox RTL). */
function negativeEngine({ clientWidth = 300, scrollWidth = 900 } = {}) {
  return {
    clientWidth,
    scrollWidth,
    _v: 0,
    get scrollLeft() { return this._v; },
    set scrollLeft(v) { this._v = Math.max(-(this.scrollWidth - this.clientWidth), Math.min(0, v)); },
  };
}
/** A scroller whose scrollLeft goes 0 → +max (the other convention). */
function positiveEngine({ clientWidth = 300, scrollWidth = 900 } = {}) {
  return {
    clientWidth,
    scrollWidth,
    _v: 0,
    get scrollLeft() { return this._v; },
    set scrollLeft(v) { this._v = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, v)); },
  };
}

describe('writePos — works on BOTH RTL scrollLeft conventions', () => {
  it('advances on a negative-going engine', () => {
    const el = negativeEngine();
    expect(writePos(el, 250)).toBe(250);
    expect(el.scrollLeft).toBe(-250);
    expect(readPos(el)).toBe(250);
  });

  it('advances on a positive-going engine (the negative write is ignored, so it retries)', () => {
    const el = positiveEngine();
    expect(writePos(el, 250)).toBe(250);
    expect(el.scrollLeft).toBe(250);
    expect(readPos(el)).toBe(250);
  });

  it('clamps to the scrollable range on both engines', () => {
    for (const make of [negativeEngine, positiveEngine]) {
      const el = make();
      expect(writePos(el, 10_000)).toBe(600);
      expect(writePos(el, -500)).toBe(0);
    }
  });

  it('is a no-op when nothing overflows — and does NOT get stuck as a result', () => {
    const el = negativeEngine({ clientWidth: 400, scrollWidth: 400 });
    expect(maxPos(el)).toBe(0);
    expect(writePos(el, 200)).toBe(0);
    // …and once content arrives, scrolling works immediately (no cached direction)
    el.scrollWidth = 1000;
    expect(writePos(el, 200)).toBe(200);
  });

  it('tolerates a missing element', () => {
    expect(writePos(null, 5)).toBe(0);
    expect(readPos(null)).toBe(0);
    expect(maxPos(null)).toBe(0);
  });
});

describe('computeEdges', () => {
  it('reports no overflow when everything fits, so no affordance shows', () => {
    expect(computeEdges(0, 0)).toEqual({ hasOverflow: false, atStart: true, atEnd: true });
  });
  it('at the start only the "next" side is reachable', () => {
    expect(computeEdges(0, 600)).toEqual({ hasOverflow: true, atStart: true, atEnd: false });
  });
  it('mid-strip both sides are reachable', () => {
    expect(computeEdges(300, 600)).toEqual({ hasOverflow: true, atStart: false, atEnd: false });
  });
  it('at the end only the "previous" side is reachable', () => {
    expect(computeEdges(600, 600)).toEqual({ hasOverflow: true, atStart: false, atEnd: true });
  });
});

describe('computeThumb', () => {
  it('is null when there is nothing to scroll', () => {
    expect(computeThumb({ clientWidth: 300, scrollWidth: 300, pos: 0, barWidth: 200 })).toBeNull();
  });

  it('sizes the thumb by the visible fraction and starts it at offset 0', () => {
    const t = computeThumb({ clientWidth: 300, scrollWidth: 900, pos: 0, barWidth: 300 });
    expect(t.width).toBe(100); // 300/900 of 300
    expect(t.offset).toBe(0);
  });

  it('pushes the thumb to the far end at max scroll', () => {
    const t = computeThumb({ clientWidth: 300, scrollWidth: 900, pos: 600, barWidth: 300 });
    expect(t.offset).toBe(200); // barWidth - width
  });

  it('never shrinks below the minimum touch size', () => {
    const t = computeThumb({ clientWidth: 40, scrollWidth: 4000, pos: 0, barWidth: 300, minThumb: 24 });
    expect(t.width).toBe(24);
  });

  it('keeps the thumb inside the bar for an out-of-range pos', () => {
    const t = computeThumb({ clientWidth: 300, scrollWidth: 900, pos: 99_999, barWidth: 300 });
    expect(t.offset).toBe(200);
    expect(t.width + t.offset).toBeLessThanOrEqual(300);
  });
});

describe('posFromThumbDrag', () => {
  it('dragging LEFT advances the RTL strip', () => {
    // moved 50px left over a 200px span mapping 600px of scroll ⇒ +150
    expect(posFromThumbDrag({ startPos: 0, startX: 100, x: 50, max: 600, span: 200 })).toBe(150);
  });
  it('dragging RIGHT goes back toward the first topic', () => {
    expect(posFromThumbDrag({ startPos: 300, startX: 100, x: 150, max: 600, span: 200 })).toBe(150);
  });
  it('clamps at both ends', () => {
    expect(posFromThumbDrag({ startPos: 0, startX: 100, x: -900, max: 600, span: 200 })).toBe(600);
    expect(posFromThumbDrag({ startPos: 0, startX: 100, x: 900, max: 600, span: 200 })).toBe(0);
  });
  it('returns the start position when the thumb fills the bar (no span to drag over)', () => {
    expect(posFromThumbDrag({ startPos: 42, startX: 100, x: 10, max: 600, span: 0 })).toBe(42);
  });
});

describe('stepFrom', () => {
  it('a press toward the end advances by more than one tile, so context overlaps', () => {
    expect(stepFrom(0, 100, 'end')).toBe(140);
  });
  it('a press toward the start goes back by the same amount', () => {
    expect(stepFrom(300, 100, 'start')).toBe(160);
  });
  it('keeps a usable step for a hairline tile width', () => {
    expect(stepFrom(0, 5, 'end')).toBe(80);
  });
});
