import { describe, it, expect } from 'vitest';
import {
  clampRatio,
  normalizeLayout,
  ratioFromDrag,
  MIN_RATIO,
  MAX_RATIO,
  DEFAULT_LAYOUT,
} from '../discussionLayout.js';

describe('discussionLayout — pure layout math (round241)', () => {
  describe('clampRatio', () => {
    it('passes an in-range ratio through untouched', () => {
      expect(clampRatio(0.5)).toBe(0.5);
      expect(clampRatio(0.4)).toBeCloseTo(0.4);
    });
    it('clamps below MIN_RATIO up and above MAX_RATIO down', () => {
      expect(clampRatio(0.05)).toBe(MIN_RATIO);
      expect(clampRatio(0.99)).toBe(MAX_RATIO);
      expect(clampRatio(-3)).toBe(MIN_RATIO);
    });
    it('falls back to the default ratio for non-finite input', () => {
      expect(clampRatio(NaN)).toBe(DEFAULT_LAYOUT.ratio);
      expect(clampRatio(undefined)).toBe(DEFAULT_LAYOUT.ratio);
      expect(clampRatio('abc')).toBe(DEFAULT_LAYOUT.ratio);
    });
  });

  describe('normalizeLayout', () => {
    it('returns the default layout for non-object input', () => {
      expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
      expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
      expect(normalizeLayout(42)).toEqual(DEFAULT_LAYOUT);
    });
    it('clamps the ratio and coerces stacked to a strict boolean', () => {
      expect(normalizeLayout({ ratio: 0.9, stacked: true })).toEqual({ ratio: MAX_RATIO, stacked: true });
      // a truthy-but-not-true stacked must NOT count as stacked
      expect(normalizeLayout({ ratio: 0.5, stacked: 1 })).toEqual({ ratio: 0.5, stacked: false });
      expect(normalizeLayout({ ratio: 0.5 })).toEqual({ ratio: 0.5, stacked: false });
    });
  });

  describe('ratioFromDrag', () => {
    it('adds the drag fraction (delta / width) to the start ratio', () => {
      // +100px over a 1000px row → +0.1
      expect(ratioFromDrag(0.5, 100, 1000)).toBeCloseTo(0.6);
      // negative delta shrinks the first box
      expect(ratioFromDrag(0.5, -100, 1000)).toBeCloseTo(0.4);
    });
    it('clamps the dragged result into [MIN_RATIO, MAX_RATIO]', () => {
      expect(ratioFromDrag(0.7, 400, 1000)).toBe(MAX_RATIO); // 0.7 + 0.4 = 1.1 → clamp
      expect(ratioFromDrag(0.3, -400, 1000)).toBe(MIN_RATIO); // 0.3 - 0.4 = -0.1 → clamp
    });
    it('leaves the ratio unchanged when the container width is zero/unknown', () => {
      expect(ratioFromDrag(0.5, 250, 0)).toBe(0.5);
      expect(ratioFromDrag(0.5, 250, undefined)).toBe(0.5);
    });
  });
});
