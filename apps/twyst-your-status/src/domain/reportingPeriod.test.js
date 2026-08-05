/**
 * reportingPeriod — the monitor's period presets (round323). Boundaries are
 * whole LOCAL calendar days; "week" is Sunday→Saturday around now; month/year
 * are the current calendar month/year; custom is inclusive and self-correcting.
 */

import { describe, expect, it } from 'vitest';

import { periodRange, previousRange } from './reportingPeriod.js';

// A fixed "now": 27 Aug 2026, 15:30 local.
const NOW = new Date(2026, 7, 27, 15, 30, 0, 0).getTime();

const asDate = (ms) => new Date(ms);

describe('periodRange — week (current Sunday→Saturday)', () => {
  const r = periodRange('week', NOW);

  it('starts on a Sunday at 00:00:00.000 and ends on a Saturday at 23:59:59.999', () => {
    const from = asDate(r.fromMs);
    const to = asDate(r.toMs);
    expect(from.getDay()).toBe(0);
    expect([from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect(to.getDay()).toBe(6);
    expect([to.getHours(), to.getMinutes(), to.getSeconds(), to.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });

  it('spans exactly seven calendar days and contains now', () => {
    expect(r.toMs - r.fromMs).toBe(7 * 86400000 - 1);
    expect(r.fromMs).toBeLessThanOrEqual(NOW);
    expect(r.toMs).toBeGreaterThanOrEqual(NOW);
  });

  it('labels the window with both day boundaries and the year', () => {
    // 27 Aug 2026 falls in the 23–29 Aug week.
    expect(r.label).toBe('23 אוג׳ – 29 אוג׳ 2026');
  });
});

describe('periodRange — month and year (current calendar)', () => {
  it('month runs from the 1st 00:00 to the last day 23:59:59.999 of now’s month', () => {
    const r = periodRange('month', NOW);
    expect(asDate(r.fromMs).getTime()).toBe(new Date(2026, 7, 1, 0, 0, 0, 0).getTime());
    expect(asDate(r.toMs).getTime()).toBe(new Date(2026, 7, 31, 23, 59, 59, 999).getTime());
    expect(r.label).toBe('אוגוסט 2026');
  });

  it('year runs from Jan 1 to Dec 31 of now’s year', () => {
    const r = periodRange('year', NOW);
    expect(asDate(r.fromMs).getTime()).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime());
    expect(asDate(r.toMs).getTime()).toBe(new Date(2026, 11, 31, 23, 59, 59, 999).getTime());
    expect(r.label).toBe('2026');
  });
});

describe('periodRange — custom', () => {
  it('is inclusive of both endpoints at day granularity', () => {
    const r = periodRange('custom', NOW, { from: '2026-08-10', to: '2026-08-12' });
    expect(asDate(r.fromMs).getTime()).toBe(new Date(2026, 7, 10, 0, 0, 0, 0).getTime());
    expect(asDate(r.toMs).getTime()).toBe(new Date(2026, 7, 12, 23, 59, 59, 999).getTime());
    expect(r.label).toBe('10 אוג׳ – 12 אוג׳ 2026');
  });

  it('swaps reversed endpoints rather than yielding an empty window', () => {
    const r = periodRange('custom', NOW, { from: '2026-08-20', to: '2026-08-05' });
    expect(asDate(r.fromMs).getTime()).toBe(new Date(2026, 7, 5, 0, 0, 0, 0).getTime());
    expect(asDate(r.toMs).getTime()).toBe(new Date(2026, 7, 20, 23, 59, 59, 999).getTime());
  });

  it('falls back to the current month when an endpoint is missing', () => {
    const r = periodRange('custom', NOW, { from: '2026-08-10' });
    expect(asDate(r.fromMs).getTime()).toBe(new Date(2026, 7, 10, 0, 0, 0, 0).getTime());
    // missing `to` → end at now
    expect(asDate(r.toMs).getTime()).toBe(new Date(2026, 7, 27, 23, 59, 59, 999).getTime());
  });
});

describe('periodRange — guards', () => {
  it('throws on an unknown period key', () => {
    expect(() => periodRange('decade', NOW)).toThrow();
  });
});

describe('previousRange — the trend comparison window', () => {
  it('week shifts back exactly seven days', () => {
    const r = periodRange('week', NOW);
    const p = previousRange('week', r);
    expect(p.fromMs).toBe(r.fromMs - 7 * 86400000);
    expect(p.toMs).toBe(r.toMs - 7 * 86400000);
  });

  it('month returns the prior calendar month', () => {
    const r = periodRange('month', NOW);
    const p = previousRange('month', r);
    expect(asDate(p.fromMs).getTime()).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime());
    expect(asDate(p.toMs).getTime()).toBe(new Date(2026, 6, 31, 23, 59, 59, 999).getTime());
  });

  it('year returns the prior calendar year', () => {
    const r = periodRange('year', NOW);
    const p = previousRange('year', r);
    expect(asDate(p.fromMs).getTime()).toBe(new Date(2025, 0, 1, 0, 0, 0, 0).getTime());
    expect(asDate(p.toMs).getTime()).toBe(new Date(2025, 11, 31, 23, 59, 59, 999).getTime());
  });

  it('custom returns the equal-length span ending the day before it starts', () => {
    const r = periodRange('custom', NOW, { from: '2026-08-10', to: '2026-08-12' });
    const p = previousRange('custom', r);
    expect(p.toMs).toBe(r.fromMs - 1);
    expect(r.fromMs - p.fromMs).toBe(r.toMs - r.fromMs + 1);
  });
});
