import { describe, it, expect, beforeEach, vi } from 'vitest';

// Seed the LIVE people-columns store: viewers_b is a live people column that is
// ALSO the alias's secondary mapped column (must NOT leak back as a raw-id
// extra role), while extra_live is a genuinely unmapped live column (must stay
// exposed by raw id). BoardSDK imports only getPeopleColumnIds from this module.
vi.mock('../peopleColumns.js', () => ({
  getPeopleColumnIds: () => ['viewers_b', 'extra_live'],
}));

import { setActiveConfig } from '../board-config-store.js';
import { mapItem } from '../BoardSDK.js';

// Multi-column people mapping (owner request 2026-07-14): an alias whose stored
// mapping carries `ids: [...]` (e.g. tasks.taskViewersID — יכולת צפייה) reads as
// the UNION of people across ALL mapped columns, deduped, so a user in ANY of
// them holds the role. `id` stays the primary (auto-fill/write target).
// Raw column_values in the REAL fetched shape: parseValue('people') reads the
// typed `persons_and_teams` field + `text` (names), not the raw JSON value.
const RAW_ITEM = {
  id: '77',
  name: 'משימה',
  created_at: '2026-07-14T00:00:00Z',
  column_values: [
    { id: 'viewers_a', persons_and_teams: [{ id: 11, kind: 'person' }, { id: 12, kind: 'person' }], text: 'אחת, שתיים' },
    { id: 'viewers_b', persons_and_teams: [{ id: 12, kind: 'person' }, { id: 13, kind: 'person' }], text: 'שתיים, שלוש' },
    { id: 'resp', persons_and_teams: [{ id: 21, kind: 'person' }], text: 'אחראית' },
    { id: 'extra_live', persons_and_teams: [{ id: 31, kind: 'person' }], text: 'נוסף' },
  ],
};

beforeEach(() => {
  setActiveConfig({
    boards: { tasks: { id: 'tasks-board' } },
    columns: {
      tasks: {
        taskViewersID: { id: 'viewers_a', ids: ['viewers_a', 'viewers_b'], type: 'people' },
        responsibilityID: { id: 'resp', type: 'people' },
      },
    },
  });
});

describe('mapItem — multi-column people alias (ids array)', () => {
  it('merges people from every mapped column, deduped, keeping order (primary first)', () => {
    const out = mapItem('tasks', RAW_ITEM);
    expect((out.taskViewersID || []).map((p) => Number(p.id))).toEqual([11, 12, 13]);
  });

  it('a single-id alias is untouched by the multi logic', () => {
    const out = mapItem('tasks', RAW_ITEM);
    expect((out.responsibilityID || []).map((p) => Number(p.id))).toEqual([21]);
  });

  it('does NOT re-expose the extra mapped columns as raw-id extras — but a truly unmapped live column IS exposed', () => {
    const out = mapItem('tasks', RAW_ITEM);
    // viewers_b is covered by the taskViewersID mapping → no duplicate raw role
    expect(out.viewers_b).toBeUndefined();
    // extra_live is a live people column with no alias → exposed by raw id
    expect((out.extra_live || []).map((p) => Number(p.id))).toEqual([31]);
  });

  it('tolerates an extra column missing from the fetched values (partial fetch)', () => {
    const partial = { ...RAW_ITEM, column_values: RAW_ITEM.column_values.filter((c) => c.id !== 'viewers_b') };
    const out = mapItem('tasks', partial);
    expect((out.taskViewersID || []).map((p) => Number(p.id))).toEqual([11, 12]);
  });
});
