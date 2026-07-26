import { describe, it, expect } from 'vitest';
import { pickLatestPreviousId } from '../previousScope.js';

describe('pickLatestPreviousId (round274 — "הפעם האחרונה")', () => {
  it('picks the most-recent OTHER discussion by date (desc)', () => {
    const list = [
      { id: '1', discussionDateID: '2026-07-01' },
      { id: '2', discussionDateID: '2026-07-15' },
      { id: '3', discussionDateID: '2026-07-08' },
    ];
    expect(pickLatestPreviousId(list, '99')).toBe('2');
  });

  it('EXCLUDES the current discussion even when it is the newest', () => {
    const list = [
      { id: '1', discussionDateID: '2026-07-01' },
      { id: '2', discussionDateID: '2026-07-20' }, // current + newest
      { id: '3', discussionDateID: '2026-07-08' },
    ];
    expect(pickLatestPreviousId(list, '2')).toBe('3');
  });

  it('falls back to created_at when discussionDateID is absent', () => {
    const list = [
      { id: '10', created_at: '2026-06-01' },
      { id: '11', created_at: '2026-06-30' },
    ];
    expect(pickLatestPreviousId(list, '99')).toBe('11');
  });

  it('returns null when there is no OTHER discussion', () => {
    expect(pickLatestPreviousId([{ id: '5', discussionDateID: '2026-07-01' }], '5')).toBeNull();
    expect(pickLatestPreviousId([], '5')).toBeNull();
    expect(pickLatestPreviousId(null, '5')).toBeNull();
  });

  it('breaks a date tie by the larger numeric id', () => {
    const list = [
      { id: '7', discussionDateID: '2026-07-10' },
      { id: '9', discussionDateID: '2026-07-10' },
    ];
    expect(pickLatestPreviousId(list, '1')).toBe('9');
  });
});
