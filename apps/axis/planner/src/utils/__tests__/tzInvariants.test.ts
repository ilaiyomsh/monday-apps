import { describe, it, expect } from 'vitest';
import {
  toMondayDateString,
  toMondayDateTimeString,
  parseUserTime,
  addDays,
  isSameDay,
} from '../dateTimeHelpers';
import { prepareAllocationMutationValues } from '../mondayTransformers';
import type { PlannerSettings } from '../../types/settings.types';

/**
 * Run with `pnpm test:tz` — re-runs Vitest under TZ=Asia/Jerusalem, TZ=UTC,
 * TZ=America/New_York. These assertions hold under all three.
 */

describe('toMondayDateString — TZ-stable', () => {
  it('renders the local Y-M-D, not the UTC slice', () => {
    // 23:30 local on June 15. Under any TZ this should still be "2025-06-15".
    const d = new Date(2025, 5, 15, 23, 30);
    expect(toMondayDateString(d)).toBe('2025-06-15');
  });

  it('handles single-digit month/day with zero-padding', () => {
    expect(toMondayDateString(new Date(2025, 0, 9))).toBe('2025-01-09');
  });

  it('handles year boundary', () => {
    expect(toMondayDateString(new Date(2025, 11, 31, 23, 59))).toBe('2025-12-31');
    expect(toMondayDateString(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('toMondayDateTimeString — TZ-stable', () => {
  it('renders Y-M-DTHH:mm:ss without a timezone suffix', () => {
    const d = new Date(2025, 5, 15, 9, 30, 0);
    expect(toMondayDateTimeString(d)).toBe('2025-06-15T09:30:00');
  });

  it('zero-pads time components', () => {
    expect(toMondayDateTimeString(new Date(2025, 5, 15, 7, 5, 3))).toBe('2025-06-15T07:05:03');
  });
});

describe('addDays — DST and TZ stability', () => {
  it('keeps the same wall-clock time across DST boundaries', () => {
    // Spring DST in IL is around late March; this hops over it.
    const before = new Date(2025, 2, 27, 14, 0, 0);
    const after = addDays(before, 7);
    expect(after.getHours()).toBe(14);
    expect(after.getMinutes()).toBe(0);
  });

  it('isSameDay is true within the same local day even with hour offsets', () => {
    const a = new Date(2025, 5, 15, 0, 0);
    const b = new Date(2025, 5, 15, 23, 59);
    expect(isSameDay(a, b)).toBe(true);
  });

  it('isSameDay is false across midnight', () => {
    const a = new Date(2025, 5, 15, 23, 59);
    const b = new Date(2025, 5, 16, 0, 0);
    expect(isSameDay(a, b)).toBe(false);
  });
});

describe('prepareAllocationMutationValues — TZ-stable end-to-end', () => {
  // Minimal settings shape — only the columns the mutation builder reads.
  const settings = {
    allocationsBoardId: 'b1',
    startDateColumnId: 'startCol',
    endDateColumnId: 'endCol',
    hoursPerDayColumnId: 'hpdCol',
    totalHoursColumnId: 'totCol',
    projectColumnId: 'projCol',
    employeeColumnId: 'empCol',
    roleColumnId: 'roleCol',
    workDays: [0, 1, 2, 3, 4],
    maxHoursPerDay: 8.5,
  } as unknown as PlannerSettings;

  it('start/end date columns get the local Y-M-D regardless of host TZ', () => {
    // 23:30 local on June 15 — under any host TZ this should produce the
    // same `2025-06-15` shape on the date column. The pre-fix code used
    // `format(..., "yyyy-MM-dd'T'HH:mm:ss.SSSxxx").split('T')[0]` which
    // landed the previous day in TZs east of UTC.
    const startDate = toMondayDateTimeString(new Date(2025, 5, 15, 23, 30));
    const endDate = toMondayDateTimeString(new Date(2025, 5, 18, 9, 0));

    const out = prepareAllocationMutationValues(
      { startDate, endDate, totalHours: 12 },
      settings,
      'projects',
      'g1'
    );

    expect(out.startCol).toEqual({ date: '2025-06-15' });
    expect(out.endCol).toEqual({ date: '2025-06-18' });
  });

  it('produces byte-identical date columns across DST boundaries', () => {
    // Both sides of IL spring DST (late March 2025).
    const beforeDst = toMondayDateTimeString(new Date(2025, 2, 27, 14, 0));
    const afterDst = toMondayDateTimeString(addDays(new Date(2025, 2, 27, 14, 0), 7));

    const out = prepareAllocationMutationValues(
      { startDate: beforeDst, endDate: afterDst, totalHours: 16 },
      settings,
      'projects',
      'g1'
    );

    expect(out.startCol).toEqual({ date: '2025-03-27' });
    // 27 + 7 = April 3 in the same wall-clock hour.
    expect(out.endCol).toEqual({ date: '2025-04-03' });
  });
});

describe('parseUserTime', () => {
  it('parses 24-hour formats', () => {
    expect(parseUserTime('09:00')).toEqual({ hours: 9, minutes: 0 });
    expect(parseUserTime('9:00')).toEqual({ hours: 9, minutes: 0 });
    expect(parseUserTime('23:30')).toEqual({ hours: 23, minutes: 30 });
  });

  it('parses 12-hour AM/PM', () => {
    expect(parseUserTime('9:00 AM')).toEqual({ hours: 9, minutes: 0 });
    expect(parseUserTime('9:00 PM')).toEqual({ hours: 21, minutes: 0 });
    expect(parseUserTime('12:00 AM')).toEqual({ hours: 0, minutes: 0 });
    expect(parseUserTime('12:00 PM')).toEqual({ hours: 12, minutes: 0 });
  });

  it('treats "9:00" and "9:00 AM" as equal', () => {
    expect(parseUserTime('9:00')).toEqual(parseUserTime('9:00 AM'));
  });

  it('throws on garbage input', () => {
    expect(() => parseUserTime('not a time')).toThrow();
    expect(() => parseUserTime('25:00')).toThrow();
    expect(() => parseUserTime('12:65')).toThrow();
  });
});
