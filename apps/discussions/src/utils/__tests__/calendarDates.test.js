process.env.TZ = 'Asia/Jerusalem';

import { describe, it, expect } from 'vitest';
import {
  addDays, dayKey, startOfWeek, weekDays, workWeekDays,
  monthGridDays, rangeForView, fmtMonthTitle, fmtWeekRangeTitle,
  groupItemsByDay, itemHasTime, layoutDayEvents,
} from '../calendarDates.js';
import { composeLocalDate } from '../dateTime.js';

describe('week math', () => {
  it('startOfWeek is the Sunday of the containing week', () => {
    // 2026-06-10 is a Wednesday → Sunday is 2026-06-07
    expect(dayKey(startOfWeek(new Date(2026, 5, 10)))).toBe('2026-06-07');
    // A Sunday maps to itself
    expect(dayKey(startOfWeek(new Date(2026, 5, 7)))).toBe('2026-06-07');
  });

  it('weekDays returns Sun..Sat across month boundary', () => {
    // Week containing 2026-07-01 (Wed): Jun 28 .. Jul 4
    const days = weekDays(new Date(2026, 6, 1));
    expect(days).toHaveLength(7);
    expect(dayKey(days[0])).toBe('2026-06-28');
    expect(dayKey(days[6])).toBe('2026-07-04');
  });

  it('workWeekDays returns Sun..Thu of the containing week', () => {
    // Wed 2026-06-10 → Sun 06-07 .. Thu 06-11
    const days = workWeekDays(new Date(2026, 5, 10));
    expect(days).toHaveLength(5);
    expect(dayKey(days[0])).toBe('2026-06-07');
    expect(dayKey(days[4])).toBe('2026-06-11');
    expect(days.map((d) => d.getDay())).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('monthGridDays', () => {
  it('Feb 2026 starts on Sunday and fits exactly 4 rows', () => {
    const weeks = monthGridDays(new Date(2026, 1, 15));
    expect(weeks).toHaveLength(4);
    expect(dayKey(weeks[0][0])).toBe('2026-02-01');
    expect(dayKey(weeks[3][6])).toBe('2026-02-28');
  });

  it('Aug 2026 (starts Saturday, 31 days) needs 6 rows with adjacent-month padding', () => {
    const weeks = monthGridDays(new Date(2026, 7, 1));
    expect(weeks).toHaveLength(6);
    expect(dayKey(weeks[0][0])).toBe('2026-07-26'); // leading July days
    expect(dayKey(weeks[5][6])).toBe('2026-09-05'); // trailing September days
    for (const row of weeks) expect(row).toHaveLength(7);
    for (const row of weeks) expect(row[0].getDay()).toBe(0); // every row starts Sunday
  });

  it('handles the December→January year boundary', () => {
    const weeks = monthGridDays(new Date(2026, 11, 25));
    const lastRow = weeks[weeks.length - 1];
    expect(lastRow[6].getFullYear()).toBe(2027);
  });
});

describe('DST transitions (Asia/Jerusalem)', () => {
  it('addDays across spring-forward (2026-03-27) keeps local midnight', () => {
    const before = new Date(2026, 2, 26);
    const after = addDays(before, 2);
    expect(after.getHours()).toBe(0);
    expect(dayKey(after)).toBe('2026-03-28');
  });

  it('addDays across fall-back (2026-10-25) keeps local midnight', () => {
    const before = new Date(2026, 9, 24);
    const after = addDays(before, 2);
    expect(after.getHours()).toBe(0);
    expect(dayKey(after)).toBe('2026-10-26');
  });
});

describe('rangeForView', () => {
  it('pads the work-week range by one day each side', () => {
    // Work week of Wed 2026-06-10 → Sun 06-07 .. Thu 06-11, padded 06-06 .. 06-12
    expect(rangeForView('week', new Date(2026, 5, 10))).toEqual({ from: '2026-06-06', to: '2026-06-12' });
  });

  it('pads the month grid by one day each side', () => {
    // June 2026 grid: May 31 .. Jul 4, padded May 30 .. Jul 5
    expect(rangeForView('month', new Date(2026, 5, 1))).toEqual({ from: '2026-05-30', to: '2026-07-05' });
  });
});

describe('titles', () => {
  it('month title in Hebrew', () => {
    expect(fmtMonthTitle(new Date(2026, 5, 1))).toBe('יוני 2026');
  });

  it('work-week range same-month, cross-month and cross-year', () => {
    expect(fmtWeekRangeTitle(new Date(2026, 5, 10))).toBe('7–11 ביוני 2026');
    expect(fmtWeekRangeTitle(new Date(2026, 6, 1))).toBe('28 ביוני – 2 ביולי 2026');
    expect(fmtWeekRangeTitle(new Date(2027, 0, 1))).toBe('27–31 בדצמבר 2026');
  });
});

describe('groupItemsByDay + itemHasTime', () => {
  it('buckets by local day, skips dateless, sorts untimed first then by time', () => {
    const items = [
      { id: '1', name: 'late', discussionDateID: composeLocalDate('2026-06-10', '16:00') },
      { id: '2', name: 'no-date', discussionDateID: null },
      { id: '3', name: 'all-day', discussionDateID: composeLocalDate('2026-06-10', '') },
      { id: '4', name: 'early', discussionDateID: composeLocalDate('2026-06-10', '09:00') },
      { id: '5', name: 'other-day', discussionDateID: composeLocalDate('2026-06-11', '') },
    ];
    const map = groupItemsByDay(items);
    expect([...map.keys()].sort()).toEqual(['2026-06-10', '2026-06-11']);
    expect(map.get('2026-06-10').map((i) => i.id)).toEqual(['3', '4', '1']);
    expect(itemHasTime(items[0])).toBe(true);
    expect(itemHasTime(items[2])).toBe(false);
    expect(itemHasTime(items[1])).toBe(false);
  });
});

describe('layoutDayEvents', () => {
  const ev = (id, time) => ({ id, name: id, discussionDateID: composeLocalDate('2026-06-10', time) });

  it('non-overlapping events each get a full lane', () => {
    const out = layoutDayEvents([ev('a', '09:00'), ev('b', '11:00')]);
    expect(out.every((e) => e.lane === 0 && e.laneCount === 1)).toBe(true);
  });

  it('events <1h apart split into lanes', () => {
    const out = layoutDayEvents([ev('a', '09:00'), ev('b', '09:30')]);
    const byId = Object.fromEntries(out.map((e) => [e.item.id, e]));
    expect(byId.a.lane).toBe(0);
    expect(byId.b.lane).toBe(1);
    expect(byId.a.laneCount).toBe(2);
    expect(byId.b.laneCount).toBe(2);
  });

  it('transitive cluster shares laneCount; later event reuses a freed lane', () => {
    const out = layoutDayEvents([ev('a', '09:00'), ev('b', '09:30'), ev('c', '10:15')]);
    const byId = Object.fromEntries(out.map((e) => [e.item.id, e]));
    // c starts after a ends (10:00) → reuses lane 0, but b (ends 10:30) still overlaps c
    expect(byId.c.lane).toBe(0);
    expect(byId.a.laneCount).toBe(2);
    expect(byId.c.laneCount).toBe(2);
  });

  it('identical times stack into separate lanes', () => {
    const out = layoutDayEvents([ev('a', '09:00'), ev('b', '09:00'), ev('c', '09:00')]);
    expect(new Set(out.map((e) => e.lane)).size).toBe(3);
    expect(out.every((e) => e.laneCount === 3)).toBe(true);
  });

  it('startMin reflects hour+minutes', () => {
    const [only] = layoutDayEvents([ev('a', '14:30')]);
    expect(only.startMin).toBe(14 * 60 + 30);
  });
});
