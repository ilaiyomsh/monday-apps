import { describe, it, expect } from 'vitest';
import { format } from 'date-fns';
import { addDaysToDayKey, dayRangesOverlap, formatDateRange, getDynamicDates, isDayKey } from '../dateUtils';

// getDynamicDates returns LOCAL-midnight Dates (parseISO on a date-only
// string). Render them in local time — toISOString() shifts to UTC and
// reads as the previous day in any TZ ahead of UTC (e.g. Asia/Jerusalem).
const localDay = (d: Date) => format(d, 'yyyy-MM-dd');

describe('formatDateRange', () => {
  it('abbreviates same-month range', () => {
    const result = formatDateRange('2025-06-12', '2025-06-15', { lang: 'he' });
    // Same month: "12 - 15 ביוני" pattern (day - day month)
    expect(result).toMatch(/^12 - 15/);
  });

  it('shows both months for cross-month range', () => {
    const result = formatDateRange('2025-06-28', '2025-07-05', { lang: 'he' });
    // Cross-month: "28 ביוני - 5 ביולי" pattern
    expect(result).toContain(' - ');
    // Should have two month names
    const parts = result.split(' - ');
    expect(parts.length).toBe(2);
  });

  it('works with Date objects', () => {
    // Local-time constructor — new Date('2025-03-01') is UTC midnight and
    // reads as the previous local day in any TZ behind UTC.
    const result = formatDateRange(new Date(2025, 2, 1), new Date(2025, 2, 15), { lang: 'he' });
    expect(result).toMatch(/^1 - 15/);
  });
});

describe('getDynamicDates', () => {
  it('moves dates by positive pixel offset', () => {
    const result = getDynamicDates('2025-01-10', '2025-01-15', 100, 50);
    // 100px / 50px per unit = 2 units moved, 2 days
    expect(localDay(result.startDate)).toBe('2025-01-12');
    expect(localDay(result.endDate)).toBe('2025-01-17');
  });

  it('moves dates by negative pixel offset', () => {
    const result = getDynamicDates('2025-01-10', '2025-01-15', -150, 50);
    // -150px / 50px = -3 units
    expect(localDay(result.startDate)).toBe('2025-01-07');
    expect(localDay(result.endDate)).toBe('2025-01-12');
  });

  it('handles zero offset', () => {
    const result = getDynamicDates('2025-01-10', '2025-01-15', 0, 50);
    expect(localDay(result.startDate)).toBe('2025-01-10');
    expect(localDay(result.endDate)).toBe('2025-01-15');
  });

  it('handles multi-day units (weekly snap)', () => {
    const result = getDynamicDates('2025-01-10', '2025-01-20', 200, 100, 7);
    // 200px / 100px = 2 units * 7 days = 14 days moved
    expect(localDay(result.startDate)).toBe('2025-01-24');
    expect(localDay(result.endDate)).toBe('2025-02-03');
  });

  it('rounds to nearest unit', () => {
    const result = getDynamicDates('2025-01-10', '2025-01-15', 120, 50);
    // 120px / 50px = 2.4, rounds to 2 units
    expect(localDay(result.startDate)).toBe('2025-01-12');
  });
});

// Day-key helpers for the Day-off integration (CONTRACT.md §1/§6).
// Pure UTC string math — the test:tz matrix runs this file in 3 timezones.
describe('isDayKey', () => {
  it('accepts well-formed YYYY-MM-DD day-keys', () => {
    expect(isDayKey('2026-06-01')).toBe(true);
    expect(isDayKey('1999-12-31')).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isDayKey('')).toBe(false);
    expect(isDayKey('2026-6-1')).toBe(false);
    expect(isDayKey('01/06/2026')).toBe(false);
    expect(isDayKey('2026-06-01 ')).toBe(false);
    expect(isDayKey('not-a-date')).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
    expect(isDayKey(null)).toBe(false);
    expect(isDayKey(20260601)).toBe(false);
  });
});

describe('addDaysToDayKey', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDaysToDayKey('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDaysToDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDayKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles leap days', () => {
    expect(addDaysToDayKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToDayKey('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDaysToDayKey('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('is symmetric for the ±366-day widening used by fetchDayOffsForRange', () => {
    expect(addDaysToDayKey('2026-06-01', -366)).toBe('2025-05-31');
    expect(addDaysToDayKey('2025-05-31', 366)).toBe('2026-06-01');
    expect(addDaysToDayKey('2026-06-30', 366)).toBe('2027-07-01');
  });

  it('returns the same day for a zero delta', () => {
    expect(addDaysToDayKey('2026-06-15', 0)).toBe('2026-06-15');
  });
});

describe('dayRangesOverlap', () => {
  it('detects overlap inclusively on both ends', () => {
    // Touching edges count (inclusive ranges)
    expect(dayRangesOverlap('2026-05-20', '2026-06-01', '2026-06-01', '2026-06-30')).toBe(true);
    expect(dayRangesOverlap('2026-06-30', '2026-07-15', '2026-06-01', '2026-06-30')).toBe(true);
  });

  it('detects containment in both directions', () => {
    // Range spans the whole window — the case OR-of-betweens misses server-side
    expect(dayRangesOverlap('2026-01-01', '2026-12-31', '2026-06-01', '2026-06-30')).toBe(true);
    // Range fully inside the window
    expect(dayRangesOverlap('2026-06-10', '2026-06-12', '2026-06-01', '2026-06-30')).toBe(true);
  });

  it('rejects disjoint ranges', () => {
    expect(dayRangesOverlap('2026-04-01', '2026-05-31', '2026-06-01', '2026-06-30')).toBe(false);
    expect(dayRangesOverlap('2026-07-01', '2026-08-01', '2026-06-01', '2026-06-30')).toBe(false);
  });

  it('works across year boundaries (lexicographic day-keys)', () => {
    expect(dayRangesOverlap('2026-12-30', '2027-01-05', '2026-12-20', '2027-01-10')).toBe(true);
    expect(dayRangesOverlap('2026-10-01', '2026-12-19', '2026-12-20', '2027-01-10')).toBe(false);
  });
});
