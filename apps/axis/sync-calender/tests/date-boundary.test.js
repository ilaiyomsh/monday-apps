// Tests for crossesLocalDayBoundary. The new behaviour: an invalid IANA time zone
// (config.mondayTimeZone, unvalidated) is converted into a CLEAR, classifiable
// error the caller's catch can ship — not an opaque raw RangeError.

import { describe, it, expect } from 'vitest';
import { crossesLocalDayBoundary } from '../src/helpers/date-boundary.js';

const ev = (start, end) => ({ start: { dateTime: start }, end: { dateTime: end } });

describe('crossesLocalDayBoundary', () => {
  it('returns false when no time zone is provided', () => {
    expect(crossesLocalDayBoundary(ev('2026-07-21T09:00:00Z', '2026-07-22T10:00:00Z'), null)).toBe(false);
  });

  it('returns false when start or end dateTime is missing (all-day/undated)', () => {
    expect(crossesLocalDayBoundary({ start: {}, end: {} }, 'Asia/Jerusalem')).toBe(false);
  });

  it('returns false for an event within a single local day', () => {
    // 10:00–12:00 Israel time, same date.
    expect(crossesLocalDayBoundary(ev('2026-07-21T07:00:00Z', '2026-07-21T09:00:00Z'), 'Asia/Jerusalem')).toBe(false);
  });

  it('returns true for an event spanning two local days', () => {
    // Starts 2026-07-21 23:00 local, ends 2026-07-22 01:00 local.
    expect(crossesLocalDayBoundary(ev('2026-07-21T20:00:00Z', '2026-07-21T22:00:00Z'), 'Asia/Jerusalem')).toBe(true);
  });

  it('returns false for an event ending exactly at the next local midnight', () => {
    // Israel is UTC+3 in July: 21:00Z = 00:00 next local day; start 10:00 local.
    expect(crossesLocalDayBoundary(ev('2026-07-21T07:00:00Z', '2026-07-21T21:00:00Z'), 'Asia/Jerusalem')).toBe(false);
  });

  it('throws a clear invalid_time_zone error for a bad IANA id', () => {
    let thrown;
    try {
      crossesLocalDayBoundary(ev('2026-07-21T09:00:00Z', '2026-07-22T10:00:00Z'), 'Not/AZone');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe('invalid_time_zone');
    expect(thrown.message).toContain('Not/AZone');
  });
});
