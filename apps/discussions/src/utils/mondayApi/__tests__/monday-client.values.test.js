process.env.TZ = 'Asia/Jerusalem';

import { describe, it, expect } from 'vitest';
import { parseValue, formatValue } from '../monday-client.js';
import { composeLocalDate } from '../../dateTime.js';

describe("parseValue('date')", () => {
  it('date-only → local midnight, hasTime=false', () => {
    const d = parseValue('date', { date: '2026-01-15', time: null });
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.hasTime).toBe(false);
  });

  it('date+time → UTC converted to local, hasTime=true', () => {
    // Winter (IST = UTC+2): 10:00 UTC → 12:00 local
    const d = parseValue('date', { date: '2026-01-15', time: '10:00:00' });
    expect(d.hasTime).toBe(true);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it('UTC night time shifts to the NEXT local day', () => {
    // 23:30 UTC on the 15th = 01:30 local on the 16th (winter, UTC+2)
    const d = parseValue('date', { date: '2026-01-15', time: '23:30:00' });
    expect(d.getDate()).toBe(16);
    expect(d.getHours()).toBe(1);
  });

  it('falls back to cv.text and handles empty', () => {
    expect(parseValue('date', { date: null, text: '2026-03-04' })?.getDate()).toBe(4);
    expect(parseValue('date', { date: null, text: null })).toBeNull();
    expect(parseValue('date', null)).toBeNull();
  });
});

describe("formatValue('date')", () => {
  it('plain Date (no hasTime) → date-only payload, local parts', () => {
    expect(formatValue('date', new Date(2026, 0, 15, 23, 0))).toEqual({ date: '2026-01-15' });
  });

  it('hasTime Date → UTC date+time payload from one toISOString', () => {
    // 12:00 local winter (UTC+2) → 10:00 UTC same day
    const d = composeLocalDate('2026-01-15', '12:00');
    expect(formatValue('date', d)).toEqual({ date: '2026-01-15', time: '10:00:00' });
  });

  it('night-time local → PREVIOUS UTC date (both parts consistent)', () => {
    // 00:30 local winter (UTC+2) → 22:30 UTC the day before
    const d = composeLocalDate('2026-01-15', '00:30');
    expect(formatValue('date', d)).toEqual({ date: '2026-01-14', time: '22:30:00' });
  });

  it('string and empty inputs unchanged', () => {
    expect(formatValue('date', '2026-06-10')).toEqual({ date: '2026-06-10' });
    expect(formatValue('date', '')).toEqual({});
    expect(formatValue('date', null)).toEqual({});
  });

  it('round-trip: write then read restores the same local instant + flag', () => {
    const original = composeLocalDate('2026-01-15', '09:45');
    const payload = formatValue('date', original);
    const restored = parseValue('date', { date: payload.date, time: payload.time });
    expect(restored.getTime()).toBe(original.getTime());
    expect(restored.hasTime).toBe(true);
  });
});
