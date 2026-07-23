import { describe, it, expect } from 'vitest';
import { computeRibbonDropTarget } from '../ribbonDrop.js';

// RTL ribbon: DOM/logical order [a, b, c, d] renders right→left, so `a` is the
// rightmost (largest mid) and `d` the leftmost. Mids below are viewport px.
const RTL = [
  { id: 'a', mid: 400 },
  { id: 'b', mid: 300 },
  { id: 'c', mid: 200 },
  { id: 'd', mid: 100 },
];
// LTR ribbon: DOM order left→right, mids ascending.
const LTR = [
  { id: 'a', mid: 100 },
  { id: 'b', mid: 200 },
  { id: 'c', mid: 300 },
  { id: 'd', mid: 400 },
];

describe('computeRibbonDropTarget — direction-agnostic drop target', () => {
  it('returns null for an empty list', () => {
    expect(computeRibbonDropTarget([], 250)).toBeNull();
    expect(computeRibbonDropTarget(undefined, 250)).toBeNull();
  });

  it('RTL — cursor in the MIDDLE lands before the correct topic (the round239 bug case)', () => {
    // Between b(300) and c(200): logical order is a,b,c,d (right→left). A cursor
    // at x=250 sits logically after b, so the drop lands BEFORE c — NOT before
    // the rightmost pair, which was the bug.
    expect(computeRibbonDropTarget(RTL, 250)).toBe('c');
    // Just right of b's centre → still before c… and left of c's centre → before d.
    expect(computeRibbonDropTarget(RTL, 150)).toBe('d');
    // Far right (past a) → before a (the very start).
    expect(computeRibbonDropTarget(RTL, 500)).toBe('a');
    // Far left (past d) → append at the logical end.
    expect(computeRibbonDropTarget(RTL, 50)).toBeNull();
  });

  it('LTR — mirror: a middle cursor lands before the correct topic', () => {
    expect(computeRibbonDropTarget(LTR, 250)).toBe('c'); // after b(200), before c(300)
    expect(computeRibbonDropTarget(LTR, 50)).toBe('a');  // far left → before a
    expect(computeRibbonDropTarget(LTR, 500)).toBeNull(); // far right → append
  });

  it('a single other tile: before it on the reading-start side, else append', () => {
    expect(computeRibbonDropTarget([{ id: 'x', mid: 200 }], 100)).toBe('x'); // ltr, left of centre
    expect(computeRibbonDropTarget([{ id: 'x', mid: 200 }], 300)).toBeNull(); // right of centre → append
  });
});
