/**
 * dateRange — the daily/weekly window the report covers.
 *
 * Two hard constraints shape this module:
 *
 * 1. **Everything is LOCAL time.** The window is fed straight into an
 *    `items_page` `date between` rule, and monday compares against the calendar
 *    date the reporter sees. Deriving the day from `toISOString()` shifts it by
 *    one for anyone east of UTC after 21:00 local — a wrong-but-plausible report.
 * 2. **Day arithmetic walks the CALENDAR, never milliseconds.** Israel changes
 *    clocks inside a Sun..Sat week (2026-10-25), so `start + 6 * 86400000` lands
 *    on Friday instead of Saturday. `new Date(y, m, d + n)` normalises through
 *    the local calendar and is DST-proof.
 *
 * Both endpoints are inclusive, matching monday's `between` (probe-verified
 * 2026-07-29). A reversed range returns zero rows with NO GraphQL error, so this
 * module never produces one: `from` is always the week start.
 */

/** Weekday index of the first day of the week when settings hold nothing usable. */
const DEFAULT_WEEK_STARTS_ON = 0; // Sunday — the Israeli work week

/** Date -> local 'YYYY-MM-DD' (the only format monday's date rules accept). */
function localYmd(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Date -> local 'DD.MM.YYYY' — the human form, and filename-safe (no slashes). */
function localHuman(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** Local midnight of the same calendar day — drops the time part without a TZ hop. */
function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `d` shifted by `n` calendar days (DST-safe: the constructor normalises). */
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 0..6, or the Sunday default for anything else (a stored blob may hold junk). */
function normalizeWeekStartsOn(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) return DEFAULT_WEEK_STARTS_ON;
  return n;
}

/**
 * The CURRENT daily or weekly window — this app never reports on a past period.
 *
 * @param {'daily'|'weekly'} kind  'daily' = today; 'weekly' = the week containing `now`.
 * @param {Date} [now=new Date()] Reference instant; must be a valid Date.
 * @param {number} [weekStartsOn=0] Weekday the week starts on (0 = Sunday).
 * @returns {{kind: string, from: string, to: string, label: string}}
 *   `from`/`to` are inclusive local 'YYYY-MM-DD'; `label` is the human,
 *   filename-safe form used for the document title.
 * @throws {Error} on an unknown `kind` or an unusable `now` — both would
 *   otherwise produce a query that silently returns zero items.
 */
export function reportRange(kind, now = new Date(), weekStartsOn = DEFAULT_WEEK_STARTS_ON) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('reportRange: "now" must be a valid Date');
  }

  if (kind === 'daily') {
    const day = startOfLocalDay(now);
    const ymd = localYmd(day);
    return { kind, from: ymd, to: ymd, label: localHuman(day) };
  }

  if (kind === 'weekly') {
    const startsOn = normalizeWeekStartsOn(weekStartsOn);
    const today = startOfLocalDay(now);
    // Distance back to the week start, always 0..6 — the +7 keeps it positive
    // when today's weekday sits before `startsOn` in the week.
    const back = (today.getDay() - startsOn + 7) % 7;
    const from = addDays(today, -back);
    const to = addDays(from, 6);
    return {
      kind,
      from: localYmd(from),
      to: localYmd(to),
      label: `${localHuman(from)} - ${localHuman(to)}`,
    };
  }

  throw new Error(`reportRange: unsupported kind "${kind}"`);
}
