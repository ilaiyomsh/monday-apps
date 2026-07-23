import { describe, it, expect } from 'vitest';
import { groupCapabilities, CAP_GROUP_LABELS } from '../permissionsGrouping.js';

describe('groupCapabilities (round246)', () => {
  it('returns an empty array for empty/invalid input', () => {
    expect(groupCapabilities([])).toEqual([]);
    expect(groupCapabilities(undefined)).toEqual([]);
    expect(groupCapabilities(null)).toEqual([]);
  });

  it('groups by `group`, preserving first-seen group order and in-group order', () => {
    const caps = [
      { id: 'a', group: 'discussion' },
      { id: 'b', group: 'topics' },
      { id: 'c', group: 'discussion' },
      { id: 'd', group: 'tasks' },
      { id: 'e', group: 'topics' },
    ];
    const out = groupCapabilities(caps);
    expect(out.map((g) => g.group)).toEqual(['discussion', 'topics', 'tasks']);
    // discussion keeps a before c; topics keeps b before e
    expect(out[0].caps.map((c) => c.id)).toEqual(['a', 'c']);
    expect(out[1].caps.map((c) => c.id)).toEqual(['b', 'e']);
    expect(out[2].caps.map((c) => c.id)).toEqual(['d']);
  });

  it('labels each group from CAP_GROUP_LABELS, falling back to the raw key', () => {
    const out = groupCapabilities([{ id: 'a', group: 'discussion' }, { id: 'z', group: 'mystery' }]);
    expect(out[0].label).toBe(CAP_GROUP_LABELS.discussion);
    expect(out[1].label).toBe('mystery');
  });

  it('buckets caps with no group under "other"', () => {
    const out = groupCapabilities([{ id: 'a' }]);
    expect(out).toHaveLength(1);
    expect(out[0].group).toBe('other');
  });
});
