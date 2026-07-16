import { describe, it, expect } from 'vitest';
import { computeScaledSize } from '../imageLogo.js';

describe('computeScaledSize', () => {
  it('never upscales an image smaller than the box', () => {
    // 100x40 inside a 320 box: already fits → unchanged (scale capped at 1).
    expect(computeScaledSize(100, 40, 320)).toEqual({ width: 100, height: 40 });
  });

  it('scales a wide image down so its LONGEST side equals the box', () => {
    // 640x160, box 320 → scale 0.5 → 320x80. Pins that the divisor is the
    // longest side (max(w,h)), not the width or the height alone.
    expect(computeScaledSize(640, 160, 320)).toEqual({ width: 320, height: 80 });
  });

  it('scales a tall image down by its height (the longest side)', () => {
    // 160x640, box 320 → scale 0.5 → 80x320.
    expect(computeScaledSize(160, 640, 320)).toEqual({ width: 80, height: 320 });
  });

  it('rounds to integer pixels and never drops below 1px', () => {
    // 3x1 into a box of 1 → scale 1/3 → width round(1)=1, height max(1,round(0.33))=1.
    expect(computeScaledSize(3, 1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('returns a zero size for non-positive / invalid dimensions', () => {
    expect(computeScaledSize(0, 100, 320)).toEqual({ width: 0, height: 0 });
    expect(computeScaledSize(100, 0, 320)).toEqual({ width: 0, height: 0 });
    expect(computeScaledSize(100, 100, 0)).toEqual({ width: 0, height: 0 });
    expect(computeScaledSize(NaN, 100, 320)).toEqual({ width: 0, height: 0 });
  });
});
