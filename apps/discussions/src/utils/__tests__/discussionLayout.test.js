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
    it('round269 — clamps ratio + the single shared boxHeight, coerces stacked to strict boolean', () => {
      expect(normalizeLayout({ ratio: 0.9, stacked: true, boxHeight: 700 }))
        .toEqual({ ratio: MAX_RATIO, stacked: true, boxHeight: 700 });
      // a truthy-but-not-true stacked must NOT count as stacked
      expect(normalizeLayout({ ratio: 0.5, stacked: 1 }))
        .toEqual({ ratio: 0.5, stacked: false, boxHeight: null });
      // out-of-range shared height is clamped
      expect(normalizeLayout({ ratio: 0.5, boxHeight: 50 }))
        .toEqual({ ratio: 0.5, stacked: false, boxHeight: MIN_HEIGHT });
      expect(normalizeLayout({ ratio: 0.5, boxHeight: 9000 }))
        .toEqual({ ratio: 0.5, stacked: false, boxHeight: MAX_HEIGHT });
      expect(normalizeLayout({ ratio: 0.5 }))
        .toEqual({ ratio: 0.5, stacked: false, boxHeight: null });
    });
    it('round269 — migrates legacy per-box (agenda/triple) and older single `height` into boxHeight', () => {
      // pre-round269 per-box heights collapse to the SHARED boxHeight (agenda wins).
      expect(normalizeLayout({ ratio: 0.5, agendaHeight: 900, tripleHeight: 700 }))
        .toEqual({ ratio: 0.5, stacked: false, boxHeight: 900 });
      // only a triple height present → it migrates.
      expect(normalizeLayout({ ratio: 0.5, tripleHeight: 640 }))
        .toEqual({ ratio: 0.5, stacked: false, boxHeight: 640 });
      // the oldest single `height` still migrates when nothing newer is present.
      expect(normalizeLayout({ ratio: 0.5, height: 700 }))
        .toEqual({ ratio: 0.5, stacked: false, boxHeight: 700 });
      // an explicit boxHeight wins over every legacy key.
      expect(normalizeLayout({ ratio: 0.5, boxHeight: 800, agendaHeight: 900, height: 500 }))
        .toEqual({ ratio: 0.5, stacked: false, boxHeight: 800 });
    });
  });

  describe('round296 — default ratio from preferences', () => {
    it('DEFAULT_LAYOUT opens at 60% agenda (0.6)', () => {
      expect(DEFAULT_LAYOUT.ratio).toBe(0.6);
    });
    it('a MISSING ratio falls back to the passed default (not the hard-coded 0.6)', () => {
      expect(normalizeLayout(null, 0.4).ratio).toBe(0.4);
      expect(normalizeLayout({ stacked: true }, 0.35).ratio).toBe(0.35);
    });
    it('a STORED per-discussion ratio WINS over the default (override is per-discussion)', () => {
      expect(normalizeLayout({ ratio: 0.7 }, 0.35).ratio).toBe(0.7);
    });
    it('the fallback default is itself clamped into [MIN_RATIO, MAX_RATIO]', () => {
      expect(normalizeLayout(null, 0.95).ratio).toBe(MAX_RATIO);
      expect(normalizeLayout({ stacked: false }, 0.05).ratio).toBe(MIN_RATIO);
    });
    it('with no default passed, a missing ratio uses DEFAULT_LAYOUT.ratio', () => {
      expect(normalizeLayout({ boxHeight: 600 }).ratio).toBe(DEFAULT_LAYOUT.ratio);
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
