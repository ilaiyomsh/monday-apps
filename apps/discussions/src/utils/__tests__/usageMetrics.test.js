import { describe, it, expect } from 'vitest';
import { bucketKey, weekStartUTC, buildSeries, averageDailyUsers } from '../usageMetrics.js';

// Per-user dataset shape: { [uid]: { 'YYYY-MM-DD': { entered, actions } } }
const DATA = {
  a: {
    '2026-07-06': { entered: 1, actions: 3 }, // Mon
    '2026-07-07': { entered: 1, actions: 2 }, // Tue (same week as 06)
    '2026-07-13': { entered: 1, actions: 5 }, // next week
  },
  b: {
    '2026-07-06': { entered: 1, actions: 10 }, // same day as a
    '2026-07-20': { entered: 0, actions: 4 },  // actions only, no entry
  },
};

describe('usageMetrics — bucketKey / weekStartUTC', () => {
  it('day granularity returns the day itself', () => {
    expect(bucketKey('2026-07-07', 'day')).toBe('2026-07-07');
  });
  it('month granularity returns YYYY-MM', () => {
    expect(bucketKey('2026-07-07', 'month')).toBe('2026-07');
  });
  it('week granularity anchors to the Sunday of that week (UTC)', () => {
    // 2026-07-07 is a Tuesday; the Sunday before it is 2026-07-05.
    expect(weekStartUTC('2026-07-07')).toBe('2026-07-05');
    expect(bucketKey('2026-07-07', 'week')).toBe('2026-07-05');
    // A Sunday maps to itself.
    expect(weekStartUTC('2026-07-05')).toBe('2026-07-05');
  });
});

describe('usageMetrics — buildSeries (entries = unique users per bucket)', () => {
  it('per DAY: a user entering twice the same day counts once; two users same day = 2', () => {
    const s = buildSeries(DATA, 'day', 'entries');
    // days with entries: 07-06 (a,b => 2), 07-07 (a => 1), 07-13 (a => 1). 07-20 has entered:0 → excluded.
    expect(s).toEqual([
      { bucket: '2026-07-06', value: 2 },
      { bucket: '2026-07-07', value: 1 },
      { bucket: '2026-07-13', value: 1 },
    ]);
  });

  it('per WEEK: a user active on several days of the week is counted ONCE for that week', () => {
    const s = buildSeries(DATA, 'week', 'entries');
    // week of 07-05: a entered 06 & 07 (once) + b entered 06 => {a,b} = 2. week of 07-12: a => 1.
    expect(s).toEqual([
      { bucket: '2026-07-05', value: 2 },
      { bucket: '2026-07-12', value: 1 },
    ]);
  });
});

describe('usageMetrics — buildSeries (actions = sum per bucket)', () => {
  it('sums actions across users/days regardless of the entered flag', () => {
    const s = buildSeries(DATA, 'day', 'actions');
    expect(s).toEqual([
      { bucket: '2026-07-06', value: 13 }, // 3 + 10
      { bucket: '2026-07-07', value: 2 },
      { bucket: '2026-07-13', value: 5 },
      { bucket: '2026-07-20', value: 4 },  // actions with no entry still count
    ]);
  });

  it('per MONTH: sums every day in the month', () => {
    const s = buildSeries(DATA, 'month', 'actions');
    expect(s).toEqual([{ bucket: '2026-07', value: 24 }]); // 3+2+5+10+4
  });
});

describe('usageMetrics — averageDailyUsers', () => {
  it('averages the daily unique-entrant counts over active days only', () => {
    // active days: 07-06 (2), 07-07 (1), 07-13 (1) → (2+1+1)/3 = 4/3
    expect(averageDailyUsers(DATA)).toBeCloseTo(4 / 3, 6);
  });
  it('is 0 when there are no entries', () => {
    expect(averageDailyUsers({ x: { '2026-01-01': { entered: 0, actions: 9 } } })).toBe(0);
    expect(averageDailyUsers({})).toBe(0);
  });
});
