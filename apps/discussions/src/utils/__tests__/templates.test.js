import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the monday API layer + config store so the apply service runs without a
// real SDK. api() returns the create_item id; formatValue is a passthrough.
vi.mock('../mondayApi/monday-client.js', () => ({
  monday: {
    storage: {
      getItem: vi.fn(async () => ({ data: { value: null } })),
      setItem: vi.fn(async () => ({ data: { success: true } })),
    },
  },
  api: vi.fn(async (query) => {
    const fields = [
      ['create_item', 'TOPIC'],
      ['change_multiple_column_values', 'LINK'],
      ['create_subitem', 'POINT'],
    ];
    for (const [field, prefix] of fields) {
      const aliases = [...query.matchAll(new RegExp(`\\b([_A-Za-z][_0-9A-Za-z]*)\\s*:\\s*${field}\\s*\\(`, 'g'))]
        .map((match) => match[1]);
      if (aliases.length) return Object.fromEntries(aliases.map((alias) => [alias, { id: `${prefix}-${alias}` }]));
    }
    return {};
  }),
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
      deciderIsLead: false, // item 18 — defaults off unless explicitly true
      exportTemplate: null, // round254 — no per-type export template ⇒ null (system default)
    });
  });

  it('round254 — keeps a per-type export template object, rejects non-objects', () => {
    const exp = { defaultFormat: 'docx', sections: [{ key: 'meta', enabled: true }] };
    expect(sanitizeTypeTemplate({ discussionType: 'סוג', exportTemplate: exp }, 'id').exportTemplate).toEqual(exp);
    // arrays / primitives / missing ⇒ null (fall back to the system default)
    expect(sanitizeTypeTemplate({ discussionType: 'סוג', exportTemplate: [1, 2] }, 'id').exportTemplate).toBeNull();
    expect(sanitizeTypeTemplate({ discussionType: 'סוג', exportTemplate: 'x' }, 'id').exportTemplate).toBeNull();
    expect(sanitizeTypeTemplate({ discussionType: 'סוג' }, 'id').exportTemplate).toBeNull();
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
    api.mockImplementation(async (query) => {
      const fields = [
        ['create_item', 'TOPIC'],
        ['change_multiple_column_values', 'LINK'],
        ['create_subitem', 'POINT'],
      ];
      for (const [field, prefix] of fields) {
        const aliases = [...query.matchAll(new RegExp(`\\b([_A-Za-z][_0-9A-Za-z]*)\\s*:\\s*${field}\\s*\\(`, 'g'))]
          .map((match) => match[1]);
        if (aliases.length) return Object.fromEntries(aliases.map((alias) => [alias, { id: `${prefix}-${alias}` }]));
      }
      return {};
    });
  });

  it('no-ops when there is no discussion id or no topics', async () => {
    expect(await createTopicsFromTemplate(null, { topics: [{ name: 't' }] })).toMatchObject({ topics: 0, points: 0 });
    expect(await createTopicsFromTemplate('D1', { topics: [] })).toMatchObject({ topics: 0, points: 0 });
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

    expect(result).toMatchObject({ topics: 2, points: 2 });

    // One aliased batch for topics, one for relation writes, one for points.
    const itemCalls = api.mock.calls.filter((c) => c[0].includes('create_item'));
    const relationCalls = api.mock.calls.filter((c) => c[0].includes('change_multiple_column_values'));
    const subitemCalls = api.mock.calls.filter((c) => c[0].includes('create_subitem'));
    expect(itemCalls).toHaveLength(1);
    expect(relationCalls).toHaveLength(1);
    expect(subitemCalls).toHaveLength(1);
    expect(itemCalls[0][0].match(/create_item\s*\(/g)).toHaveLength(2);
    expect(subitemCalls[0][0].match(/create_subitem\s*\(/g)).toHaveLength(2);

    // User values are variables. Relation writes happen after create_item because
    // monday silently drops board_relation values during create_item.
    const [, firstItemVars] = itemCalls[0];
    expect(firstItemVars.boardId).toBe('TOPICS_BOARD');
    expect(firstItemVars.name0).toBe('נושא א');
    expect(JSON.stringify(relationCalls[0][1])).toContain('rel_col');

    // subitems are attached to the returned topic id with the point name
    const [, firstSubVars] = subitemCalls[0];
    expect(firstSubVars.parentId0).toBe('TOPIC-topic0');
    expect(firstSubVars.name0).toBe('נקודה 1');
  });

  it('surfaces a create_item alias that returns no id and does not create its points', async () => {
    api.mockResolvedValueOnce({ topic0: null });
    await expect(createTopicsFromTemplate('DISC_1', {
      topics: [{ name: 'bad', points: ['p1'] }],
    })).rejects.toThrow('missing alias result');
    expect(api.mock.calls.some((c) => c[0].includes('create_subitem'))).toBe(false);
  });
});
