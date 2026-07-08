import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the monday API layer + config store so the apply service runs without a
// real SDK. api() returns the create_item id; formatValue is a passthrough.
vi.mock('../mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ create_item: { id: 'NEW_TOPIC' } })),
  formatValue: vi.fn((type, value) => ({ __type: type, value })),
}));
vi.mock('../mondayApi/board-config-store.js', () => ({
  getBoardId: vi.fn(() => 'TOPICS_BOARD'),
  getColumns: vi.fn((key) =>
    key === 'topics' ? { discussionLinkID: { id: 'rel_col', type: 'board_relation' } } : {}
  ),
}));

import { sanitizeTemplate, sanitizeTypeTemplate, countPoints, createTopicsFromTemplate } from '../templates.js';
import { api } from '../mondayApi/monday-client.js';

describe('sanitizeTemplate', () => {
  it('trims names, drops empty topics, drops empty points, accepts string or {name} points', () => {
    const out = sanitizeTemplate(
      {
        name: '  תבנית  ',
        topics: [
          { name: '  נושא א  ', points: ['  נקודה 1 ', { name: 'נקודה 2' }, '   ', ''] },
          { name: '   ', points: ['x'] }, // empty topic name -> dropped
        ],
      },
      'tpl_1'
    );
    expect(out).toEqual({
      id: 'tpl_1',
      name: 'תבנית',
      discussionType: null,
      topics: [{ name: 'נושא א', points: ['נקודה 1', 'נקודה 2'] }],
    });
  });

  it('is defensive against missing/garbage input', () => {
    expect(sanitizeTemplate(undefined, 'id')).toEqual({ id: 'id', name: '', discussionType: null, topics: [] });
    expect(sanitizeTemplate({ topics: 'nope' }, 'id').topics).toEqual([]);
  });

  it('preserves an assigned discussionType (label TEXT, trimmed)', () => {
    expect(sanitizeTemplate({ name: 'x', discussionType: 'תכנון' }, 'id').discussionType).toBe('תכנון');
    expect(sanitizeTemplate({ name: 'x', discussionType: '  סקירה  ' }, 'id').discussionType).toBe('סקירה');
    expect(sanitizeTemplate({ name: 'x', discussionType: null }, 'id').discussionType).toBeNull();
  });
});

describe('sanitizeTypeTemplate', () => {
  it('keyed by discussionType (text): bundles topics + lead + coordinator + participants', () => {
    const out = sanitizeTypeTemplate(
      {
        discussionType: 'ישיבת הנהלה',
        topics: [{ name: ' נושא ', points: [' p1 ', '', { name: 'p2' }] }, { name: '  ', points: ['x'] }],
        lead: [{ id: 10, name: 'מובילה' }],
        coordinator: [{ id: 12, name: 'מרכז' }],
        participants: [{ id: 11, name: 'א' }, { id: 11, name: 'dup' }],
      },
      'tt_1'
    );
    expect(out).toEqual({
      id: 'tt_1',
      discussionType: 'ישיבת הנהלה',
      topics: [{ name: 'נושא', points: ['p1', 'p2'] }],
      lead: [{ id: 10, kind: 'person', name: 'מובילה' }],
      coordinator: [{ id: 12, kind: 'person', name: 'מרכז' }],
      participants: [{ id: 11, kind: 'person', name: 'א' }],
    });
  });

  it('requires a non-empty type text; empty/missing returns null (dropped)', () => {
    expect(sanitizeTypeTemplate({ discussionType: 'סוג' }, 'id')?.discussionType).toBe('סוג');
    expect(sanitizeTypeTemplate({ discussionType: '   ' }, 'id')).toBeNull();
    expect(sanitizeTypeTemplate({ topics: [] }, 'id')).toBeNull();
    expect(sanitizeTypeTemplate(undefined, 'id')).toBeNull();
  });
});

describe('countPoints', () => {
  it('sums points across topics', () => {
    expect(countPoints({ topics: [{ points: ['a', 'b'] }, { points: ['c'] }, { points: [] }] })).toBe(3);
    expect(countPoints({})).toBe(0);
  });
});

describe('createTopicsFromTemplate', () => {
  beforeEach(() => {
    api.mockClear();
    api.mockResolvedValue({ create_item: { id: 'NEW_TOPIC' } });
  });

  it('no-ops when there is no discussion id or no topics', async () => {
    expect(await createTopicsFromTemplate(null, { topics: [{ name: 't' }] })).toEqual({ topics: 0, points: 0 });
    expect(await createTopicsFromTemplate('D1', { topics: [] })).toEqual({ topics: 0, points: 0 });
    expect(api).not.toHaveBeenCalled();
  });

  it('creates one item per topic and one subitem per point, linked to the discussion', async () => {
    const result = await createTopicsFromTemplate('DISC_1', {
      name: 'tpl',
      topics: [
        { name: 'נושא א', points: ['נקודה 1', 'נקודה 2'] },
        { name: 'נושא ב', points: [] },
      ],
    });

    expect(result).toEqual({ topics: 2, points: 2 });

    // 2 create_item + 2 create_subitem
    const itemCalls = api.mock.calls.filter((c) => c[0].includes('create_item'));
    const subitemCalls = api.mock.calls.filter((c) => c[0].includes('create_subitem'));
    expect(itemCalls).toHaveLength(2);
    expect(subitemCalls).toHaveLength(2);

    // create_item carries the topics board id, the topic name, and the relation column
    const [, firstItemVars] = itemCalls[0];
    expect(firstItemVars.boardId).toBe('TOPICS_BOARD');
    expect(firstItemVars.name).toBe('נושא א');
    expect(JSON.parse(firstItemVars.columnValues)).toHaveProperty('rel_col');

    // subitems are attached to the returned topic id with the point name
    const [, firstSubVars] = subitemCalls[0];
    expect(firstSubVars.parentId).toBe('NEW_TOPIC');
    expect(firstSubVars.name).toBe('נקודה 1');
  });

  it('skips a topic whose create_item returns no id (no points attached)', async () => {
    api.mockResolvedValueOnce({ create_item: {} }); // first topic: malformed (no id)
    const result = await createTopicsFromTemplate('DISC_1', {
      topics: [{ name: 'bad', points: ['p1'] }],
    });
    expect(result).toEqual({ topics: 0, points: 0 });
    // only the create_item was attempted; no create_subitem fired
    expect(api.mock.calls.some((c) => c[0].includes('create_subitem'))).toBe(false);
  });
});
