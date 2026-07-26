import { describe, it, expect, vi, beforeEach } from 'vitest';

// Progress reporting for template application (items 6+8): the sequential
// create loop reports { done, total } after every created topic/point so the
// create-discussion / apply-template loading bars can show REAL progress.
vi.mock('../mondayApi/monday-client.js', () => ({
  api: vi.fn(),
  formatValue: vi.fn(() => '{}'),
}));
vi.mock('../mondayApi/board-config-store.js', () => ({
  getBoardId: () => '111',
  getColumns: () => ({}),
}));
vi.mock('../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { api } from '../mondayApi/monday-client.js';
import { createTopicsFromTemplate, sanitizeTypeTemplate } from '../templates.js';

const TEMPLATE = {
  id: 'tpl1',
  name: 'תבנית',
  topics: [
    { name: 'נושא א', points: ['נק 1', 'נק 2'] },
    { name: 'נושא ב', points: ['נק 3'] },
  ],
};

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (query) =>
    query.includes('create_item')
      ? { create_item: { id: 'T-new' } }
      : { create_subitem: { id: 'P-new' } }
  );
});

describe('createTopicsFromTemplate — onProgress', () => {
  it('reports done/total after every created topic and point, ending at total', async () => {
    const seen = [];
    const res = await createTopicsFromTemplate('D1', TEMPLATE, {
      onProgress: (p) => seen.push({ ...p }),
    });
    expect(res).toMatchObject({ topics: 2, points: 3 });
    // total = 2 topics + 3 points = 5; an initial 0/5 plus one tick per create
    expect(seen[0]).toEqual({ done: 0, total: 5 });
    expect(seen[seen.length - 1]).toEqual({ done: 5, total: 5 });
    expect(seen).toHaveLength(6);
    // done is monotonically increasing
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].done).toBe(seen[i - 1].done + 1);
      expect(seen[i].total).toBe(5);
    }
  });

  it('still resolves counts when onProgress is omitted (no throw)', async () => {
    await expect(createTopicsFromTemplate('D1', TEMPLATE)).resolves.toMatchObject({ topics: 2, points: 3 });
  });

  it('a throwing onProgress never breaks the creation flow', async () => {
    const res = await createTopicsFromTemplate('D1', TEMPLATE, {
      onProgress: () => { throw new Error('listener bug'); },
    });
    expect(res).toMatchObject({ topics: 2, points: 3 });
  });
});

describe('sanitizeTypeTemplate — deciderIsLead (item 18)', () => {
  const base = { discussionType: 'שבועי', topics: [] };
  it('persists true only for a strict boolean true', () => {
    expect(sanitizeTypeTemplate({ ...base, deciderIsLead: true }, 'x').deciderIsLead).toBe(true);
    expect(sanitizeTypeTemplate({ ...base, deciderIsLead: 'yes' }, 'x').deciderIsLead).toBe(false);
    expect(sanitizeTypeTemplate({ ...base, deciderIsLead: 1 }, 'x').deciderIsLead).toBe(false);
    expect(sanitizeTypeTemplate(base, 'x').deciderIsLead).toBe(false);
  });
});
