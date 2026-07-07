/*
 * Pure calendar math for the discussions calendar (month grid + week grid).
 * Native Date only, ALL in local time — day keys must never go through
 * toISOString() (UTC shift moves night hours to the previous day in Israel).
 * DST-safe: arithmetic uses setDate/setMonth on local midnight, so crossing an
 * Asia/Jerusalem transition still lands on local midnight.
 */
import { MONTHS_HE, localYmd } from './dateTime.js';

export const WEEKDAYS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const WEEKDAYS_HE_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d, n) {
  // Anchor to the 1st so "31 Jan + 1 month" can't overflow into March.
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function sameDay(a, b) {
  return !!a && !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

/** Local "yyyy-mm-dd" map key for a calendar day. */
export function dayKey(d) {
  return localYmd(d);
}

/** Sunday of the week containing d (Israeli week starts Sunday). */
export function startOfWeek(d) {
  return addDays(d, -d.getDay());
}

/** The 7 days (Sun..Sat) of the week containing anchor. */
export function weekDays(anchor) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Sun..Thu of the work week containing anchor (Israeli work week). */
export function workWeekDays(anchor) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 5 }, (_, i) => addDays(start, i));
}

/**
 * Full weeks covering the anchor's month: rows of 7 days from the Sunday of
 * the week containing the 1st through the Saturday of the week containing the
 * last day (4-6 rows; leading/trailing days belong to adjacent months).
 */
export function monthGridDays(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  let cur = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const weeks = [];
  while (cur <= end) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
    cur = addDays(cur, 7);
  }
  return weeks;
}

/**
 * The fetch range (local "yyyy-mm-dd" from/to) for the visible grid, PADDED by
 * one day on each side: monday's `between` compares the STORED date string,
 * which for timed items is the UTC date — a local 00:00-03:00 time falls on the
 * previous UTC date, so unpadded boundaries drop edge items.
 */
export function rangeForView(mode, anchor) {
  if (mode === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 4); // Thursday
    return { from: dayKey(addDays(start, -1)), to: dayKey(addDays(end, 1)) };
  }
  const weeks = monthGridDays(anchor);
  const first = weeks[0][0];
  const lastRow = weeks[weeks.length - 1];
  return { from: dayKey(addDays(first, -1)), to: dayKey(addDays(lastRow[6], 1)) };
}

export function fmtMonthTitle(anchor) {
  return `${MONTHS_HE[anchor.getMonth()]} ${anchor.getFullYear()}`;
}

export function fmtWeekRangeTitle(anchor) {
  const days = workWeekDays(anchor);
  const a = days[0];
  const b = days[4];
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ב${MONTHS_HE[a.getMonth()]} ${a.getFullYear()}`;
  }
  const aPart = `${a.getDate()} ב${MONTHS_HE[a.getMonth()]}${a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : ''}`;
  return `${aPart} – ${b.getDate()} ב${MONTHS_HE[b.getMonth()]} ${b.getFullYear()}`;
}

export function fmtHour(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

/** Single integration point for the time-of-day flag set by parseValue('date'). */
export function itemHasTime(item) {
  return item?.discussionDateID?.hasTime === true;
}

/**
 * Bucket lean discussion items by local day. Items with no/invalid date are
 * skipped (the between-filter excludes them server-side anyway; the LIST view
 * still shows them). Within a day: timed items sorted by time, untimed first.
 */
export function groupItemsByDay(items) {
  const map = new Map();
  for (const item of items || []) {
    const d = item?.discussionDateID;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) continue;
    const key = dayKey(d);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const at = itemHasTime(a) ? a.discussionDateID.getTime() : -1;
      const bt = itemHasTime(b) ? b.discussionDateID.getTime() : -1;
      return at - bt;
    });
  }
  return map;
}

/**
 * Lane layout for one day's TIMED events in the week grid. Every event renders
 * one hour tall (discussions have no duration), so two events overlap when
 * their starts are <1h apart. Transitively-overlapping events form a cluster;
 * lanes are assigned greedily within it and every member shares laneCount, so
 * chips split the column width evenly: [{ item, startMin, lane, laneCount }].
 */
export function layoutDayEvents(events) {
  const sorted = [...events]
    .map((item) => ({ item, startMin: item.discussionDateID.getHours() * 60 + item.discussionDateID.getMinutes() }))
    .sort((a, b) => a.startMin - b.startMin);

  const out = [];
  let cluster = [];
  let laneEnds = []; // per-lane end minute within the current cluster
  let clusterEnd = -1;

  const flush = () => {
    for (const ev of cluster) ev.laneCount = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const ev of sorted) {
    if (cluster.length && ev.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => ev.startMin >= end);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = ev.startMin + 60;
    ev.lane = lane;
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.startMin + 60);
  }
  flush();
  return out;
}
