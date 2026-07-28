import { describe, expect, it } from 'vitest';
import {
  buildMonthGrid,
  isoToday,
  shiftMonth,
  toIsoDate,
} from './monthGrid.js';

describe('buildMonthGrid', () => {
  it('lays July 2026 out in whole Sunday-to-Saturday weeks', () => {
    const grid = buildMonthGrid(2026, 7);
    expect(grid).toHaveLength(5);
    grid.forEach((week) => expect(week).toHaveLength(7));
  });

  it('opens the first week with the trailing days of the previous month', () => {
    // July 2026 starts on a Wednesday, so Su–Tu belong to June.
    const [firstWeek] = buildMonthGrid(2026, 7);
    expect(firstWeek.slice(0, 3)).toEqual([
      { iso: '2026-06-28', day: 28, inMonth: false },
      { iso: '2026-06-29', day: 29, inMonth: false },
      { iso: '2026-06-30', day: 30, inMonth: false },
    ]);
    expect(firstWeek[3]).toEqual({ iso: '2026-07-01', day: 1, inMonth: true });
  });

  it('closes the last week with the leading days of the next month', () => {
    const grid = buildMonthGrid(2026, 7);
    const lastWeek = grid[grid.length - 1];
    expect(lastWeek[lastWeek.length - 1]).toEqual({ iso: '2026-08-01', day: 1, inMonth: false });
  });

  it('marks exactly the days of the requested month as in-month', () => {
    const inMonth = buildMonthGrid(2026, 7).flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].iso).toBe('2026-07-01');
    expect(inMonth[30].iso).toBe('2026-07-31');
  });

  it('handles a month that starts exactly on Sunday without a blank lead week', () => {
    // February 2026 starts on a Sunday.
    const [firstWeek] = buildMonthGrid(2026, 2);
    expect(firstWeek[0]).toEqual({ iso: '2026-02-01', day: 1, inMonth: true });
  });

  it('gives February 2024 its leap day', () => {
    const feb = buildMonthGrid(2024, 2).flat().filter((cell) => cell.inMonth);
    expect(feb).toHaveLength(29);
    expect(feb[28].iso).toBe('2024-02-29');
  });

  it('gives February 2026 no 29th', () => {
    const feb = buildMonthGrid(2026, 2).flat().filter((cell) => cell.inMonth);
    expect(feb).toHaveLength(28);
  });

  it('spans six weeks when the month needs them', () => {
    // August 2026 starts on Saturday and has 31 days ⇒ 6 rows.
    expect(buildMonthGrid(2026, 8)).toHaveLength(6);
  });

  it('never repeats or skips a day across the whole grid', () => {
    const isos = buildMonthGrid(2026, 7).flat().map((cell) => cell.iso);
    expect(new Set(isos).size).toBe(isos.length);
    isos.forEach((iso, index) => {
      if (index === 0) return;
      const previous = new Date(`${isos[index - 1]}T00:00:00Z`);
      const current = new Date(`${iso}T00:00:00Z`);
      expect(current - previous).toBe(24 * 60 * 60 * 1000);
    });
  });

  it('rejects a month outside 1-12 rather than rolling into another year', () => {
    expect(() => buildMonthGrid(2026, 0)).toThrow();
    expect(() => buildMonthGrid(2026, 13)).toThrow();
  });
});

describe('shiftMonth', () => {
  it('steps forward and back within a year', () => {
    expect(shiftMonth(2026, 7, 1)).toEqual({ year: 2026, month: 8 });
    expect(shiftMonth(2026, 7, -1)).toEqual({ year: 2026, month: 6 });
  });

  it('rolls over the year boundary in both directions', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('steps more than one month at a time', () => {
    expect(shiftMonth(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
  });
});

describe('toIsoDate', () => {
  it('formats a local date without shifting it into the previous day', () => {
    // new Date(...).toISOString() would return the UTC day, which is wrong for
    // any positive-offset timezone near midnight.
    expect(toIsoDate(new Date(2026, 6, 28, 0, 30))).toBe('2026-07-28');
  });

  it('pads single-digit months and days', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('returns an empty string for a non-date or invalid date', () => {
    expect(toIsoDate(null)).toBe('');
    expect(toIsoDate('2026-07-28')).toBe('');
    expect(toIsoDate(new Date('nope'))).toBe('');
  });
});

describe('isoToday', () => {
  it('formats the given clock as a local ISO day', () => {
    expect(isoToday(new Date(2026, 6, 28, 23, 59))).toBe('2026-07-28');
  });
});
