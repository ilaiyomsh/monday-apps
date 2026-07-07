process.env.TZ = 'Asia/Jerusalem';

import { describe, it, expect } from 'vitest';
import { localYmd, composeLocalDate, toDateInput, toTimeInput } from '../dateTime.js';

describe('localYmd', () => {
  it('pads month and day', () => {
    expect(localYmd(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localYmd(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('composeLocalDate', () => {
  it('builds a local date without time (hasTime=false)', () => {
    const d = composeLocalDate('2026-06-10', '');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(0);
    expect(d.hasTime).toBe(false);
  });

  it('builds a local date with time (hasTime=true)', () => {
    const d = composeLocalDate('2026-06-10', '14:30');
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
    expect(d.hasTime).toBe(true);
  });

  it('returns null for empty/invalid input', () => {
    expect(composeLocalDate('', '12:00')).toBeNull();
    expect(composeLocalDate(null, null)).toBeNull();
    expect(composeLocalDate('not-a-date', '')).toBeNull();
  });
});

describe('toDateInput', () => {
  it('formats local yyyy-mm-dd and tolerates clones', () => {
    expect(toDateInput(new Date(2026, 5, 7))).toBe('2026-06-07');
    expect(toDateInput(null)).toBe('');
    expect(toDateInput(new Date('invalid'))).toBe('');
  });
});

describe('toTimeInput', () => {
  it('returns HH:MM only when hasTime is set', () => {
    const timed = composeLocalDate('2026-06-10', '09:05');
    expect(toTimeInput(timed)).toBe('09:05');
    const untimed = composeLocalDate('2026-06-10', '');
    expect(toTimeInput(untimed)).toBe('');
    // A clone loses the flag — must yield '' rather than a fake 00:00.
    expect(toTimeInput(new Date(timed))).toBe('');
    expect(toTimeInput(null)).toBe('');
  });
});
