import { describe, it, expect } from 'vitest';
import {
  extractStrings,
  flattenTranslationValues,
  assertNoForbiddenStrings,
  findStatusColumnWrites,
  detectStatusColumnShape,
  assertStatusWriteIsRoundTrip,
} from '../payloadGuard';

describe('extractStrings', () => {
  it('returns an empty array for null/undefined/non-string scalars', () => {
    expect(extractStrings(null)).toEqual([]);
    expect(extractStrings(undefined)).toEqual([]);
    expect(extractStrings(42)).toEqual([]);
    expect(extractStrings(true)).toEqual([]);
  });

  it('captures plain strings', () => {
    expect(extractStrings('hello')).toEqual(['hello']);
  });

  it('walks nested objects and arrays', () => {
    const v = { a: 'x', b: { c: 'y', d: ['z', { e: 'w' }] } };
    expect(extractStrings(v).sort()).toEqual(['w', 'x', 'y', 'z']);
  });
});

describe('flattenTranslationValues', () => {
  it('handles a tracker-style nested bundle (objects + arrays + plural forms)', () => {
    const en = {
      filter: { timeframe: { thisWeek: 'This Week', nextWeek: 'Next Week' } },
      allocation: { roles: { plural: 'Roles', items: ['Frontend', 'Backend'] } },
    };
    const all = flattenTranslationValues(en).sort();
    expect(all).toEqual(['Backend', 'Frontend', 'Next Week', 'Roles', 'This Week']);
  });

  it('returns [] for empty bundle', () => {
    expect(flattenTranslationValues({})).toEqual([]);
  });
});

describe('assertNoForbiddenStrings', () => {
  it('passes when payload has none of the forbidden strings', () => {
    expect(() => assertNoForbiddenStrings({ a: 'safe' }, ['leak'])).not.toThrow();
  });

  it('throws when a forbidden string sits anywhere in the payload', () => {
    expect(() => assertNoForbiddenStrings({ x: { y: 'leak' } }, ['leak'])).toThrow(/leak/);
  });

  it('ignores forbidden strings under allowedKeys (board-data fields)', () => {
    // role label legitimately equals user-board data; should not be flagged.
    const payload = { column_values: { roleColumnId: { label: 'מתכנת' } } };
    expect(() =>
      assertNoForbiddenStrings(payload, ['מתכנת'], { allowedKeys: ['label'] })
    ).not.toThrow();
  });

  it('ignores forbidden strings at an explicit allowedPaths location', () => {
    const payload = { column_values: { roleColumnId: { label: 'מתכנת' } } };
    expect(() =>
      assertNoForbiddenStrings(payload, ['מתכנת'], {
        allowedPaths: ['column_values.*.label'],
      })
    ).not.toThrow();
  });

  it('allowedPaths is path-precise — a label in an unrelated location still flags', () => {
    const payload = {
      column_values: { roleColumnId: { label: 'מתכנת' } },
      // Translation accidentally written into a nested `label` slot in an
      // unrelated section: legacy `allowedKeys: ['label']` would silently
      // allowlist it; `allowedPaths: ['column_values.*.label']` does not.
      tooltip: { label: 'מתכנת' },
    };
    expect(() =>
      assertNoForbiddenStrings(payload, ['מתכנת'], {
        allowedPaths: ['column_values.*.label'],
      })
    ).toThrow(/מתכנת/);
  });

  it('ignores empty strings in forbidden list', () => {
    expect(() => assertNoForbiddenStrings({ a: '' }, [''])).not.toThrow();
  });
});

describe('detectStatusColumnShape', () => {
  it('returns "index" for { index: number }', () => {
    expect(detectStatusColumnShape({ index: 1 })).toBe('index');
  });

  it('returns "label" for { label: string }', () => {
    expect(detectStatusColumnShape({ label: 'פעיל' })).toBe('label');
  });

  it('prefers "label" if both are present', () => {
    expect(detectStatusColumnShape({ index: 1, label: 'פעיל' })).toBe('label');
  });

  it('returns "unknown" for non-objects', () => {
    expect(detectStatusColumnShape('string')).toBe('unknown');
    expect(detectStatusColumnShape(null)).toBe('unknown');
  });

  it('returns "unknown" for arrays', () => {
    expect(detectStatusColumnShape([])).toBe('unknown');
    expect(detectStatusColumnShape(['Frontend', 'Backend'])).toBe('unknown');
  });

  it('returns "unknown" for Date instances', () => {
    expect(detectStatusColumnShape(new Date())).toBe('unknown');
  });
});

describe('findStatusColumnWrites', () => {
  it('returns only the requested status columns', () => {
    const cv = {
      role: { label: 'מתכנת' },
      capability: { labels: ['Frontend'] },
      hours: 8,
    };
    const writes = findStatusColumnWrites(cv, ['role']);
    expect(writes).toHaveLength(1);
    expect(writes[0].columnId).toBe('role');
    expect(writes[0].shape).toBe('label');
  });

  it('returns [] when no statusColumnIds provided', () => {
    expect(findStatusColumnWrites({ a: 1 }, [])).toEqual([]);
  });
});

describe('assertStatusWriteIsRoundTrip', () => {
  it('passes when label equals original', () => {
    expect(() =>
      assertStatusWriteIsRoundTrip(
        { columnId: 'role', value: { label: 'מתכנת' }, shape: 'label' },
        'מתכנת'
      )
    ).not.toThrow();
  });

  it('throws when label is translated', () => {
    expect(() =>
      assertStatusWriteIsRoundTrip(
        { columnId: 'role', value: { label: 'Developer' }, shape: 'label' },
        'מתכנת'
      )
    ).toThrow(/translated/);
  });

  it('is a no-op for index-shaped writes', () => {
    expect(() =>
      assertStatusWriteIsRoundTrip(
        { columnId: 'role', value: { index: 1 }, shape: 'index' },
        'מתכנת'
      )
    ).not.toThrow();
  });
});
