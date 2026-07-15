import { describe, it, expect } from 'vitest';
import { isChromeNarrow } from '../chromeNarrow.js';

describe('isChromeNarrow — round103 panel-open width heuristic', () => {
  it('is TRUE when the current width dropped below the ratio of the widest seen', () => {
    // panel roughly halves the width: 500 < 1200 * 0.8 (960)
    expect(isChromeNarrow(500, 1200)).toBe(true);
    // pins the DEFAULT ratio at 0.8: 700 < 1000*0.8 (800) → true, but would be
    // FALSE at a 0.5 default (700 !< 500).
    expect(isChromeNarrow(700, 1000)).toBe(true);
  });

  it('is FALSE when the current width is at/above the ratio (mild or no shrink)', () => {
    expect(isChromeNarrow(1000, 1200)).toBe(false); // 1000 >= 960
    expect(isChromeNarrow(1200, 1200)).toBe(false); // full width
  });

  it('is FALSE with no valid max or non-positive current width (pre-measure guard)', () => {
    expect(isChromeNarrow(500, 0)).toBe(false);
    expect(isChromeNarrow(0, 1200)).toBe(false);
  });

  it('honors a custom ratio', () => {
    // 700 vs 1000: not narrow at 0.8 (>=800) but narrow at 0.5 threshold? 700 !< 500 → false;
    // narrow at 0.75 (750): 700 < 750 → true.
    expect(isChromeNarrow(700, 1000, 0.5)).toBe(false);
    expect(isChromeNarrow(700, 1000, 0.75)).toBe(true);
  });
});
