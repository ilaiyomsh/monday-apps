import { describe, it, expect } from 'vitest';
import {
  clampRatio,
  clampHeight,
  normalizeLayout,
  ratioFromDrag,
  heightFromDrag,
  MIN_RATIO,
  MAX_RATIO,
  MIN_HEIGHT,
  MAX_HEIGHT,
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

  describe('clampHeight', () => {
    it('passes an in-range height through untouched', () => {
      expect(clampHeight(600)).toBe(600);
    });
    it('clamps below MIN_HEIGHT up and above MAX_HEIGHT down', () => {
      expect(clampHeight(100)).toBe(MIN_HEIGHT);
      expect(clampHeight(9000)).toBe(MAX_HEIGHT);
    });
    it('returns null (use CSS default) for null/non-finite input', () => {
      expect(clampHeight(null)).toBeNull();
      expect(clampHeight(undefined)).toBeNull();
      expect(clampHeight(NaN)).toBeNull();
      expect(clampHeight('tall')).toBeNull();
    });
  });

  describe('normalizeLayout', () => {
    it('returns the default layout for non-object input', () => {
      expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
      expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
      expect(normalizeLayout(42)).toEqual(DEFAULT_LAYOUT);
    });
    it('clamps ratio + per-box heights and coerces stacked to a strict boolean', () => {
      expect(normalizeLayout({ ratio: 0.9, stacked: true, agendaHeight: 700, tripleHeight: 800 }))
        .toEqual({ ratio: MAX_RATIO, stacked: true, agendaHeight: 700, tripleHeight: 800 });
      // a truthy-but-not-true stacked must NOT count as stacked
      expect(normalizeLayout({ ratio: 0.5, stacked: 1 }))
        .toEqual({ ratio: 0.5, stacked: false, agendaHeight: null, tripleHeight: null });
      // each box's out-of-range height is clamped INDEPENDENTLY
      expect(normalizeLayout({ ratio: 0.5, agendaHeight: 50, tripleHeight: 9000 }))
        .toEqual({ ratio: 0.5, stacked: false, agendaHeight: MIN_HEIGHT, tripleHeight: MAX_HEIGHT });
      expect(normalizeLayout({ ratio: 0.5 }))
        .toEqual({ ratio: 0.5, stacked: false, agendaHeight: null, tripleHeight: null });
    });
    it('round251 — migrates a legacy shared `height` into BOTH per-box heights', () => {
      // a pre-round251 saved layout carried a single shared `height`; it seeds
      // both boxes so the owner's saved size survives the upgrade.
      expect(normalizeLayout({ ratio: 0.5, height: 700 }))
        .toEqual({ ratio: 0.5, stacked: false, agendaHeight: 700, tripleHeight: 700 });
      // an explicit per-box height wins over the legacy shared value.
      expect(normalizeLayout({ ratio: 0.5, height: 700, agendaHeight: 900 }))
        .toEqual({ ratio: 0.5, stacked: false, agendaHeight: 900, tripleHeight: 700 });
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

  describe('heightFromDrag', () => {
    it('adds a downward drag to the start height and clamps the result', () => {
      expect(heightFromDrag(600, 120)).toBe(720);   // taller
      expect(heightFromDrag(600, -120)).toBe(480);  // shorter
      expect(heightFromDrag(600, -500)).toBe(MIN_HEIGHT); // 100 → clamp up
      expect(heightFromDrag(1300, 400)).toBe(MAX_HEIGHT); // 1700 → clamp down
    });
  });
});
