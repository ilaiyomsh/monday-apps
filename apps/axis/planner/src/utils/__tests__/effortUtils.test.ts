import { describe, it, expect } from 'vitest';
import { formatNum, formatEffort, getDefaultEffortModeByZoom, isOverCapacity } from '../effortUtils';

describe('formatNum', () => {
  it('formats whole numbers without .0', () => {
    expect(formatNum(5)).toBe('5');
  });

  it('formats to 1 decimal place', () => {
    expect(formatNum(5.67)).toBe('5.7');
  });

  it('formats zero', () => {
    expect(formatNum(0)).toBe('0');
  });

  it('removes trailing .0', () => {
    expect(formatNum(10.04)).toBe('10');
  });
});

describe('getDefaultEffortModeByZoom', () => {
  it('returns hours_day for day zoom', () => {
    expect(getDefaultEffortModeByZoom('day')).toBe('hours_day');
  });

  it('returns hours_week for week zoom', () => {
    expect(getDefaultEffortModeByZoom('week')).toBe('hours_week');
  });

  it('returns days_month for month zoom', () => {
    expect(getDefaultEffortModeByZoom('month')).toBe('days_month');
  });

  it('returns days_month for quarter zoom', () => {
    expect(getDefaultEffortModeByZoom('quarter')).toBe('days_month');
  });
});

describe('formatEffort', () => {
  const settings = {
    maxHoursPerDay: 8.5,
    maxHoursPerWeek: 42.5,
    maxHoursPerMonth: 170,
    workDays: [0, 1, 2, 3, 4],
  };

  it('formats hours per day', () => {
    expect(formatEffort(4, 10, 'hours_day', settings)).toBe("4 ש'/יום");
  });

  it('formats hours per week (5 work days)', () => {
    expect(formatEffort(4, 10, 'hours_week', settings)).toBe("20 ש'/שבוע");
  });

  it('formats hours per month', () => {
    const result = formatEffort(8.5, 20, 'days_month', settings);
    expect(result).toContain("ש'/חודש");
  });

  it('formats FTE percentage', () => {
    const result = formatEffort(8.5, 20, 'fte', settings);
    expect(result).toBe('100% אחוז משרה');
  });

  it('formats total hours', () => {
    expect(formatEffort(4, 10, 'total_hours', settings)).toBe('40 שעות');
  });
});

describe('isOverCapacity', () => {
  it('returns true when over capacity', () => {
    expect(isOverCapacity(9, 8.5)).toBe(true);
  });

  it('returns false when at capacity', () => {
    expect(isOverCapacity(8.5, 8.5)).toBe(false);
  });

  it('returns false when under capacity', () => {
    expect(isOverCapacity(4, 8.5)).toBe(false);
  });
});
