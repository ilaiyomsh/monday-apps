import { describe, it, expect } from 'vitest';
import { isWorkingDay, countWorkingDays, getWorkDaysPerWeek, getAverageWorkDaysPerMonth } from '../workDaysUtils';

// All dates use the local-time constructor — new Date('YYYY-MM-DD') is UTC
// midnight, which is the previous local day (wrong weekday) in any TZ behind
// UTC, e.g. America/New_York in the test:tz matrix.

describe('isWorkingDay', () => {
  const sunToThu = [0, 1, 2, 3, 4]; // Sun-Thu (Israeli standard)

  it('returns true for Sunday (day 0)', () => {
    expect(isWorkingDay(new Date(2025, 0, 5), sunToThu)).toBe(true); // Sunday
  });

  it('returns true for Thursday (day 4)', () => {
    expect(isWorkingDay(new Date(2025, 0, 9), sunToThu)).toBe(true); // Thursday
  });

  it('returns false for Friday (day 5)', () => {
    expect(isWorkingDay(new Date(2025, 0, 10), sunToThu)).toBe(false); // Friday
  });

  it('returns false for Saturday (day 6)', () => {
    expect(isWorkingDay(new Date(2025, 0, 11), sunToThu)).toBe(false); // Saturday
  });

  it('works with Mon-Fri workweek', () => {
    const monToFri = [1, 2, 3, 4, 5];
    expect(isWorkingDay(new Date(2025, 0, 6), monToFri)).toBe(true);  // Monday
    expect(isWorkingDay(new Date(2025, 0, 5), monToFri)).toBe(false); // Sunday
  });
});

describe('countWorkingDays', () => {
  const sunToThu = [0, 1, 2, 3, 4];

  it('counts working days in a full week', () => {
    // Sun Jan 5 to Sat Jan 11 = 5 working days (Sun-Thu)
    expect(countWorkingDays(new Date(2025, 0, 5), new Date(2025, 0, 11), sunToThu)).toBe(5);
  });

  it('counts single working day', () => {
    expect(countWorkingDays(new Date(2025, 0, 5), new Date(2025, 0, 5), sunToThu)).toBe(1);
  });

  it('returns 0 for weekend-only range', () => {
    // Fri-Sat
    expect(countWorkingDays(new Date(2025, 0, 10), new Date(2025, 0, 11), sunToThu)).toBe(0);
  });

  it('handles multi-week range', () => {
    // 2 full weeks Sun-Sat = 10 working days
    expect(countWorkingDays(new Date(2025, 0, 5), new Date(2025, 0, 18), sunToThu)).toBe(10);
  });

  it('handles empty workDays array', () => {
    expect(countWorkingDays(new Date(2025, 0, 5), new Date(2025, 0, 11), [])).toBe(0);
  });
});

describe('getWorkDaysPerWeek', () => {
  it('returns 5 for standard workweek', () => {
    expect(getWorkDaysPerWeek([0, 1, 2, 3, 4])).toBe(5);
  });

  it('returns 6 for 6-day workweek', () => {
    expect(getWorkDaysPerWeek([0, 1, 2, 3, 4, 5])).toBe(6);
  });

  it('returns 0 for empty array', () => {
    expect(getWorkDaysPerWeek([])).toBe(0);
  });
});

describe('getAverageWorkDaysPerMonth', () => {
  it('calculates ~21.67 for 5-day workweek', () => {
    const result = getAverageWorkDaysPerMonth([0, 1, 2, 3, 4]);
    expect(result).toBeCloseTo(21.667, 1);
  });

  it('returns 0 for empty workDays', () => {
    expect(getAverageWorkDaysPerMonth([])).toBe(0);
  });
});
