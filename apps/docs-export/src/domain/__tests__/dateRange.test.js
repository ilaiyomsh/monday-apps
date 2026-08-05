// The ENTIRE point of dateRange.js is that the window is computed in LOCAL time.
// A test runner sitting in UTC cannot tell a local implementation from a
// toISOString() one, so the timezone is pinned here — east of UTC, and with a
// real DST transition (Israel switches on 2026-10-25 at 02:00), which is what
// catches "start + 6 * 86400000" day arithmetic.
// Node re-reads the zone on every assignment to process.env.TZ (verified on
// node 20), so this works even though ESM hoists the imports above it.
process.env.TZ = 'Asia/Jerusalem';

import { describe, expect, it } from 'vitest';
import { reportRange } from '../dateRange.js';

/** Independent oracle for "the local calendar date of d" — en-CA renders YYYY-MM-DD. */
const localYmd = (d) => d.toLocaleDateString('en-CA');

describe('reportRange — daily', () => {
  it('returns today for both endpoints when kind is daily', () => {
    const now = new Date(2026, 6, 29, 14, 5); // Wed 2026-07-29, local
    const r = reportRange('daily', now);
    expect(r.from).toBe('2026-07-29');
    expect(r.to).toBe('2026-07-29');
  });

  it('uses the LOCAL calendar day, not the UTC day, at 02:00 local east of UTC', () => {
    // 2026-07-29T23:00Z is already 2026-07-30 02:00 in Asia/Jerusalem.
    // toISOString().slice(0,10) would answer '2026-07-29' — the bug.
    const now = new Date(Date.UTC(2026, 6, 29, 23, 0));
    expect(localYmd(now)).toBe('2026-07-30'); // guards the fixture itself
    const r = reportRange('daily', now);
    expect(r.from).toBe('2026-07-30');
    expect(r.to).toBe('2026-07-30');
  });

  it('labels a daily range as the single day in DD.MM.YYYY', () => {
    expect(reportRange('daily', new Date(2026, 6, 29, 9, 0)).label).toBe('29.07.2026');
  });
});

describe('reportRange — weekly', () => {
  it('spans Sunday..Saturday around a mid-week Wednesday when weekStartsOn is 0', () => {
    const now = new Date(2026, 6, 29, 14, 5); // Wednesday
    const r = reportRange('weekly', now, 0);
    expect(r.from).toBe('2026-07-26'); // Sunday
    expect(r.to).toBe('2026-08-01'); // Saturday, crossing the month boundary
  });

  it('keeps a Sunday "now" as the first day of its own week', () => {
    const r = reportRange('weekly', new Date(2026, 6, 26, 0, 1), 0); // Sunday 00:01
    expect(r.from).toBe('2026-07-26');
    expect(r.to).toBe('2026-08-01');
  });

  it('keeps a Saturday "now" as the last day of its own week', () => {
    const r = reportRange('weekly', new Date(2026, 7, 1, 23, 59), 0); // Saturday 23:59
    expect(r.from).toBe('2026-07-26');
    expect(r.to).toBe('2026-08-01');
  });

  it('shifts the window when weekStartsOn is 1 (Monday..Sunday)', () => {
    const now = new Date(2026, 6, 29, 14, 5); // Wednesday
    const r = reportRange('weekly', now, 1);
    expect(r.from).toBe('2026-07-27'); // Monday
    expect(r.to).toBe('2026-08-02'); // Sunday
  });

  it('shifts the window when weekStartsOn is 3 (the same weekday as "now")', () => {
    const now = new Date(2026, 6, 29, 14, 5); // Wednesday === day 3
    const r = reportRange('weekly', now, 3);
    expect(r.from).toBe('2026-07-29');
    expect(r.to).toBe('2026-08-04');
  });

  it('wraps BACKWARDS when weekStartsOn falls later in the week than "now"', () => {
    // Wednesday (3) with a Friday-based week (5): the week start is LAST Friday,
    // never next Friday. Without the modulo wrap the offset goes negative and the
    // window walks forward past "now" — a report that covers the future.
    const r = reportRange('weekly', new Date(2026, 6, 29, 14, 5), 5);
    expect(r.from).toBe('2026-07-24'); // the preceding Friday
    expect(r.to).toBe('2026-07-30');
    expect(r.from <= '2026-07-29').toBe(true); // the window contains "now"
  });

  it('still spans 7 calendar days across the end-of-DST week', () => {
    // Sun 2026-10-25 .. Sat 2026-10-31 — the clock goes back one hour inside it,
    // so ms-based day arithmetic lands on 2026-10-30 instead.
    const r = reportRange('weekly', new Date(2026, 9, 28, 12, 0), 0); // Wednesday
    expect(r.from).toBe('2026-10-25');
    expect(r.to).toBe('2026-10-31');
  });

  it('ends on Saturday when "now" IS the DST transition day that starts the week', () => {
    // The sharp case: Israel drops back to standard time on Sun 2026-10-25 at
    // 02:00, and that Sunday is also the week start, so the -0/+6 hop crosses
    // the change in ONE direction with nothing to cancel it. ms arithmetic
    // (start + 6 * 86400000) answers 2026-10-30 here.
    const r = reportRange('weekly', new Date(2026, 9, 25, 12, 0), 0); // Sunday
    expect(r.from).toBe('2026-10-25');
    expect(r.to).toBe('2026-10-31');
  });

  it('still spans 7 calendar days across the start-of-DST week', () => {
    // Israel starts DST on Fri 2026-03-27; the clock jumps forward inside this week.
    const r = reportRange('weekly', new Date(2026, 2, 25, 12, 0), 0); // Wednesday
    expect(r.from).toBe('2026-03-22');
    expect(r.to).toBe('2026-03-28');
  });

  it('labels a weekly range as "from - to" in DD.MM.YYYY', () => {
    expect(reportRange('weekly', new Date(2026, 6, 29, 9, 0), 0).label).toBe(
      '26.07.2026 - 01.08.2026'
    );
  });

  it('never emits a reversed range (monday returns zero rows for [end,start] silently)', () => {
    const r = reportRange('weekly', new Date(2026, 6, 29, 9, 0), 0);
    expect(r.from <= r.to).toBe(true);
    expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('reportRange — guards', () => {
  it('throws on an unsupported kind instead of returning a silently-empty window', () => {
    expect(() => reportRange('monthly', new Date(2026, 6, 29))).toThrow(/monthly/);
  });

  it('throws on a non-Date now', () => {
    expect(() => reportRange('daily', '2026-07-29')).toThrow(/now/i);
  });

  it('throws on an invalid Date now', () => {
    expect(() => reportRange('daily', new Date('nope'))).toThrow(/now/i);
  });

  it('falls back to Sunday for an out-of-range weekStartsOn', () => {
    const r = reportRange('weekly', new Date(2026, 6, 29, 14, 5), 9);
    expect(r.from).toBe('2026-07-26');
    expect(r.to).toBe('2026-08-01');
  });

  it('defaults to now when no date is given', () => {
    const r = reportRange('daily');
    expect(r.from).toBe(localYmd(new Date()));
    expect(r.to).toBe(r.from);
  });

  it('reports the kind it computed', () => {
    expect(reportRange('daily', new Date(2026, 6, 29)).kind).toBe('daily');
    expect(reportRange('weekly', new Date(2026, 6, 29)).kind).toBe('weekly');
  });
});
