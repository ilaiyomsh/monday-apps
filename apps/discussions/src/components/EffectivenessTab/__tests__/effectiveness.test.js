import { describe, it, expect } from 'vitest';
import {
  startOfToday, resolveDoneStatusIds, isDelayed, countDone,
} from '../effectiveness.js';

// A Date `offset` days from today, at noon (exercises the date-only comparison).
const day = (offset) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

describe('resolveDoneStatusIds', () => {
  it('uses the owner-picked preference set when present', () => {
    expect(resolveDoneStatusIds([2, 5], 1)).toEqual(new Set([2, 5]));
  });

  it('falls back to the is_done label when the preference is unset or empty', () => {
    expect(resolveDoneStatusIds(null, 1)).toEqual(new Set([1]));
    expect(resolveDoneStatusIds([], 1)).toEqual(new Set([1]));
  });

  it('treats label id 0 as a valid done id', () => {
    expect(resolveDoneStatusIds(null, 0)).toEqual(new Set([0]));
    expect(resolveDoneStatusIds([0], 3)).toEqual(new Set([0]));
  });

  it('is empty when nothing is known', () => {
    expect(resolveDoneStatusIds(null, null)).toEqual(new Set());
  });
});

describe('isDelayed', () => {
  const done = new Set([2]);
  const today = startOfToday();

  it('deadline yesterday + not done → delayed', () => {
    expect(isDelayed({ deadlineID: day(-1), statusID: 1 }, done, today)).toBe(true);
  });

  it('deadline today → NOT delayed (date-only; delay starts the next day)', () => {
    expect(isDelayed({ deadlineID: day(0), statusID: 1 }, done, today)).toBe(false);
  });

  it('deadline tomorrow → not delayed', () => {
    expect(isDelayed({ deadlineID: day(1), statusID: 1 }, done, today)).toBe(false);
  });

  it('deadline yesterday but status is "done" → not delayed', () => {
    expect(isDelayed({ deadlineID: day(-1), statusID: 2 }, done, today)).toBe(false);
  });

  it('no deadline → never delayed', () => {
    expect(isDelayed({ deadlineID: null, statusID: 1 }, done, today)).toBe(false);
    expect(isDelayed({ statusID: 1 }, done, today)).toBe(false);
  });

  it('no status + past deadline → delayed', () => {
    expect(isDelayed({ deadlineID: day(-3), statusID: null }, done, today)).toBe(true);
  });

  it('done label id 0 is respected', () => {
    expect(isDelayed({ deadlineID: day(-1), statusID: 0 }, new Set([0]), today)).toBe(false);
  });
});

describe('countDone', () => {
  it('counts tasks whose status is in the done set', () => {
    const items = [{ statusID: 2 }, { statusID: 2 }, { statusID: 1 }, { statusID: null }];
    expect(countDone(items, new Set([2]))).toBe(2);
  });

  it('respects a multi-status done set', () => {
    const items = [{ statusID: 2 }, { statusID: 5 }, { statusID: 1 }];
    expect(countDone(items, new Set([2, 5]))).toBe(2);
  });

  it('treats done label id 0 as done', () => {
    const items = [{ statusID: 0 }, { statusID: 1 }];
    expect(countDone(items, new Set([0]))).toBe(1);
  });

  it('is 0 when the done set is empty', () => {
    expect(countDone([{ statusID: 1 }], new Set())).toBe(0);
  });
});
