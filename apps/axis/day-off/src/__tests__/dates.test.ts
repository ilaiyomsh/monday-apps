import { describe, it, expect } from 'vitest';
import {
  toKey,
  fromKey,
  addDays,
  isWeekend,
  sameDay,
  eachDay,
  workdaysBetween,
  calDaysBetween,
  buildMonthMatrix,
  fmtDate,
  fmtDateLong,
  fmtRange,
  relDays,
  rangeOverlapsYear,
  rangeOverlapsWindow,
  yearWindow,
  type MonthDayNames,
  type RelDayLabels,
} from '../domain/dates';

// Stub names — language-agnostic so assertions hold under any TZ / locale.
const names: MonthDayNames = {
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsShort: ['Ja', 'Fe', 'Ma', 'Ap', 'My', 'Jn', 'Jl', 'Au', 'Se', 'Oc', 'No', 'De'],
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  daysShort: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  inPrefix: 'ב',
  geresh: '׳',
};

const relLabels: RelDayLabels = {
  today: 'today',
  tomorrow: 'tomorrow',
  yesterday: 'yesterday',
  inDays: (n) => `in ${n}`,
  agoDays: (n) => `ago ${n}`,
};

describe('toKey / fromKey round-trip', () => {
  it('round-trips a day-key through fromKey/toKey unchanged', () => {
    for (const k of ['2026-01-01', '2026-06-03', '2026-12-31', '2024-02-29']) {
      expect(toKey(fromKey(k))).toBe(k);
    }
  });

  it('builds a local-midnight key regardless of TZ', () => {
    // fromKey uses local-calendar construction, so the key never shifts a day.
    expect(toKey(fromKey('2026-03-15'))).toBe('2026-03-15');
  });
});

describe('isWeekend (Israel: Fri=5, Sat=6)', () => {
  it('flags Friday and Saturday as weekend, others as workdays', () => {
    // 2026-06-05 is a Friday, 2026-06-06 a Saturday, 2026-06-07 a Sunday.
    expect(isWeekend(fromKey('2026-06-05'))).toBe(true); // Fri
    expect(isWeekend(fromKey('2026-06-06'))).toBe(true); // Sat
    expect(isWeekend(fromKey('2026-06-07'))).toBe(false); // Sun
    expect(isWeekend(fromKey('2026-06-04'))).toBe(false); // Thu
  });
});

describe('addDays / sameDay', () => {
  it('advances and rewinds days', () => {
    expect(toKey(addDays(fromKey('2026-06-03'), 1))).toBe('2026-06-04');
    expect(toKey(addDays(fromKey('2026-06-03'), -3))).toBe('2026-05-31');
    expect(toKey(addDays(fromKey('2026-12-31'), 1))).toBe('2027-01-01');
  });

  it('sameDay compares calendar day only', () => {
    const a = fromKey('2026-06-03');
    const b = addDays(a, 0);
    expect(sameDay(a, b)).toBe(true);
    expect(sameDay(a, addDays(a, 1))).toBe(false);
  });
});

describe('eachDay', () => {
  it('returns inclusive list of keys', () => {
    expect(eachDay('2026-06-03', '2026-06-06')).toEqual([
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
    ]);
  });

  it('returns single key for same start/end', () => {
    expect(eachDay('2026-06-03', '2026-06-03')).toEqual(['2026-06-03']);
  });

  it('spans month and year boundaries', () => {
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
});

describe('rangeOverlapsYear', () => {
  it('is true when the range lies fully inside the year', () => {
    expect(rangeOverlapsYear('2026-03-01', '2026-03-10', 2026)).toBe(true);
  });

  it('is true when the range crosses into the year from the prior year', () => {
    expect(rangeOverlapsYear('2025-12-20', '2026-01-05', 2026)).toBe(true);
  });

  it('is false when the range ends before the year', () => {
    expect(rangeOverlapsYear('2025-01-01', '2025-12-31', 2026)).toBe(false);
  });
});

describe('yearWindow / rangeOverlapsWindow (W1.1 — arbitrary [from,to] windows)', () => {
  it('yearWindow covers the whole calendar year inclusively', () => {
    expect(yearWindow(2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('is true for a range fully inside the window', () => {
    expect(rangeOverlapsWindow('2026-03-05', '2026-03-08', { from: '2026-03-01', to: '2026-03-31' })).toBe(true);
  });

  it('is true for a cross-year window catching a Dec–Jan range', () => {
    // The case the calendar-year scope missed: window spans the year boundary.
    const window = { from: '2025-12-01', to: '2026-01-31' };
    expect(rangeOverlapsWindow('2025-12-28', '2026-01-03', window)).toBe(true);
    expect(rangeOverlapsWindow('2025-12-28', '2025-12-30', window)).toBe(true);
    expect(rangeOverlapsWindow('2026-01-02', '2026-01-04', window)).toBe(true);
  });

  it('is true for a range spanning the ENTIRE window (start before, end after)', () => {
    expect(rangeOverlapsWindow('2025-11-15', '2026-02-15', { from: '2025-12-01', to: '2026-01-31' })).toBe(true);
  });

  it('is inclusive on both window ends (single-day touch counts)', () => {
    const window = { from: '2026-06-01', to: '2026-06-30' };
    expect(rangeOverlapsWindow('2026-05-20', '2026-06-01', window)).toBe(true); // touches `from`
    expect(rangeOverlapsWindow('2026-06-30', '2026-07-05', window)).toBe(true); // touches `to`
  });

  it('is false for ranges strictly before or after the window', () => {
    const window = { from: '2026-06-01', to: '2026-06-30' };
    expect(rangeOverlapsWindow('2026-05-01', '2026-05-31', window)).toBe(false);
    expect(rangeOverlapsWindow('2026-07-01', '2026-07-10', window)).toBe(false);
  });

  it('rangeOverlapsYear matches rangeOverlapsWindow over the year window', () => {
    expect(rangeOverlapsYear('2025-12-20', '2026-01-05', 2026)).toBe(
      rangeOverlapsWindow('2025-12-20', '2026-01-05', yearWindow(2026)),
    );
  });
});

describe('workdaysBetween (excludes Fri/Sat)', () => {
  it('counts only workdays in a week spanning the weekend', () => {
    // Sun 2026-05-31 .. Sat 2026-06-06: workdays Sun,Mon,Tue,Wed,Thu = 5; Fri+Sat excluded.
    expect(workdaysBetween('2026-05-31', '2026-06-06')).toBe(5);
  });

  it('is zero for a Fri-Sat-only range', () => {
    expect(workdaysBetween('2026-06-05', '2026-06-06')).toBe(0);
  });

  it('counts a single workday as 1', () => {
    expect(workdaysBetween('2026-06-03', '2026-06-03')).toBe(1); // Wed
  });

  it('counts a single weekend day as 0', () => {
    expect(workdaysBetween('2026-06-05', '2026-06-05')).toBe(0); // Fri
  });
});

describe('calDaysBetween (calendar days, inclusive)', () => {
  it('counts every day including weekends', () => {
    expect(calDaysBetween('2026-05-31', '2026-06-06')).toBe(7);
    expect(calDaysBetween('2026-06-03', '2026-06-03')).toBe(1);
  });
});

describe('buildMonthMatrix', () => {
  it('returns a 6x7 matrix starting on a Sunday', () => {
    const m = buildMonthMatrix(new Date(2026, 5, 1)); // June 2026
    expect(m).toHaveLength(6);
    for (const week of m) expect(week).toHaveLength(7);
    // First cell must be a Sunday (getDay() === 0).
    expect(m[0][0].getDay()).toBe(0);
    // Cells are contiguous days.
    expect(toKey(addDays(m[0][0], 1))).toBe(toKey(m[0][1]));
    // Last cell is 41 days after the first.
    expect(toKey(m[5][6])).toBe(toKey(addDays(m[0][0], 41)));
  });

  it('includes the first of the month somewhere in the matrix', () => {
    const m = buildMonthMatrix(new Date(2026, 5, 1));
    const keys = m.flat().map(toKey);
    expect(keys).toContain('2026-06-01');
  });
});

describe('fmtRange', () => {
  it('same-day → "d.m", no year', () => {
    expect(fmtRange('2026-06-03', '2026-06-03')).toBe('3.6');
  });

  it('same-month → "ds-de.m"', () => {
    expect(fmtRange('2026-06-03', '2026-06-07')).toBe('3-7.6');
  });

  it('same-year cross-month → "ds.ms-de.me"', () => {
    expect(fmtRange('2026-06-28', '2026-07-02')).toBe('28.6-2.7');
  });

  it('cross-year → "d.m.yy-d.m.yy"', () => {
    expect(fmtRange('2026-12-30', '2027-01-02')).toBe('30.12.26-2.1.27');
  });
});

describe('fmtDate / fmtDateLong', () => {
  it('fmtDate is day + short month', () => {
    expect(fmtDate('2026-06-03', names)).toBe('3 Jn׳');
  });

  it('fmtDateLong is day-name + long date', () => {
    // 2026-06-03 is a Wednesday → days[3] = 'Wed'.
    expect(fmtDateLong('2026-06-03', names)).toBe('Wed, 3 בJun 2026');
  });
});

describe('relDays (with stub labels, pinned today)', () => {
  const today = fromKey('2026-06-03');

  it('returns today/tomorrow/yesterday', () => {
    expect(relDays('2026-06-03', relLabels, today)).toBe('today');
    expect(relDays('2026-06-04', relLabels, today)).toBe('tomorrow');
    expect(relDays('2026-06-02', relLabels, today)).toBe('yesterday');
  });

  it('returns in-N / ago-N for larger gaps', () => {
    expect(relDays('2026-06-08', relLabels, today)).toBe('in 5');
    expect(relDays('2026-05-29', relLabels, today)).toBe('ago 5');
  });

  it('is stable across the DST-style boundaries (uses 86400000 rounding)', () => {
    // Spanning a month boundary still yields exact day deltas.
    expect(relDays('2026-07-03', relLabels, today)).toBe('in 30');
  });
});
