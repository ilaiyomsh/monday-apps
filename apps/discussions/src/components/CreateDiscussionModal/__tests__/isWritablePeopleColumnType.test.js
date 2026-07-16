import { describe, it, expect } from 'vitest';
import { isWritablePeopleColumnType } from '../CreateDiscussionModal.jsx';

// round115 — the discussion-creator stamp is written ONLY to a regular people
// column; a monday "creation log" mapping (read-only, auto-filled) is skipped.
describe('isWritablePeopleColumnType', () => {
  it('accepts the regular people column types', () => {
    expect(isWritablePeopleColumnType('people')).toBe(true);
    expect(isWritablePeopleColumnType('multiple_person')).toBe(true);
    expect(isWritablePeopleColumnType('person')).toBe(true);
    expect(isWritablePeopleColumnType('People')).toBe(true); // case-insensitive
  });

  it('rejects read-only / non-people mappings', () => {
    expect(isWritablePeopleColumnType('creation_log')).toBe(false);
    expect(isWritablePeopleColumnType('date')).toBe(false);
    expect(isWritablePeopleColumnType('')).toBe(false);
    expect(isWritablePeopleColumnType(null)).toBe(false);
    expect(isWritablePeopleColumnType(undefined)).toBe(false);
  });
});
