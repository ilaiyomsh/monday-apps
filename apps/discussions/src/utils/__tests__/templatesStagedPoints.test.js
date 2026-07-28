import { describe, it, expect, vi, beforeEach } from 'vitest';

// round301 — STAGED template creation. Creating a discussion from a template used
// to be one all-or-nothing pass, so the card either waited for every point of
// every topic or (round300) opened empty and filled in a minute later.
// `pointTopicIndexes` limits ONE pass to the points of the given topic indexes:
// stage 1 creates all topics + the FIRST topic's points (so the card can open
// usable), and stage 2 resumes from stage 1's checkpoint to create the rest.
vi.mock('../mondayApi/monday-client.js', () => ({
  api: vi.fn(),
  formatValue: vi.fn(() => '{}'),
}));
// Mutable so the linkLast tests can map the relation column; the staged-points
// tests keep it empty (no linking, matching the original fixture).
const columnsMock = vi.hoisted(() => ({ value: {} }));
vi.mock('../mondayApi/board-config-store.js', () => ({
  getBoardId: () => '111',
  getColumns: () => columnsMock.value,
}));
vi.mock('../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), health: vi.fn() },
}));

import { api } from '../mondayApi/monday-client.js';
import { createTopicsFromTemplate } from '../templates.js';

const TEMPLATE = {
  id: 'tpl1',
  name: 'תבנית',
  topics: [
    { name: 'נושא א', points: ['א1', 'א2'] },
    { name: 'נושא ב', points: ['ב1'] },
    { name: 'נושא ג', points: ['ג1', 'ג2'] },
  ],
};

// Records which point aliases each api() call asked to create. Aliases encode
// point<topicSourceIndex>_<pointIndex>, so the recorded set proves exactly which
// topics' points a pass created.
let createdPointAliases;

beforeEach(() => {
  createdPointAliases = [];
  columnsMock.value = {};
  api.mockReset();
  api.mockImplementation(async (query) => {
    const topicAliases = [...query.matchAll(/\b(topic\d+)\s*:\s*create_item\s*\(/g)].map((m) => m[1]);
    if (topicAliases.length) {
      return Object.fromEntries(topicAliases.map((a) => [a, { id: `T-${a}` }]));
    }
    const relAliases = [...query.matchAll(/\b(topicRelation\d+)\s*:\s*change_multiple_column_values\s*\(/g)].map((m) => m[1]);
    if (relAliases.length) {
      return Object.fromEntries(relAliases.map((a) => [a, { id: `L-${a}` }]));
    }
    const pointAliases = [...query.matchAll(/\b(point\d+_\d+)\s*:\s*create_subitem\s*\(/g)].map((m) => m[1]);
    createdPointAliases.push(...pointAliases);
    return Object.fromEntries(pointAliases.map((a) => [a, { id: `P-${a}` }]));
  });
});

describe('createTopicsFromTemplate — pointTopicIndexes (staged points)', () => {
  it('stage 1: creates EVERY topic but only the listed topic\'s points', async () => {
    const res = await createTopicsFromTemplate('D1', TEMPLATE, {
      freshDiscussion: true,
      pointTopicIndexes: [0],
    });
    expect(res.topics).toBe(3);
    // Only topic 0's two points were created.
    expect(res.points).toBe(2);
    expect(createdPointAliases.sort()).toEqual(['point0_0', 'point0_1']);
  });

  it('stage 2: resuming from stage 1 creates ONLY the remaining points, no duplicate topics', async () => {
    let checkpoint = null;
    await createTopicsFromTemplate('D1', TEMPLATE, {
      freshDiscussion: true,
      pointTopicIndexes: [0],
      onCheckpoint: (cp) => { checkpoint = cp; },
    });
    expect(checkpoint).toBeTruthy();

    const topicCreateCallsBefore = api.mock.calls.filter(([q]) => /create_item/.test(q)).length;
    createdPointAliases = [];

    const res = await createTopicsFromTemplate('D1', TEMPLATE, {
      freshDiscussion: true,
      resumeState: checkpoint,
    });
    // No further create_item: the topics already exist from stage 1.
    const topicCreateCallsAfter = api.mock.calls.filter(([q]) => /create_item/.test(q)).length;
    expect(topicCreateCallsAfter).toBe(topicCreateCallsBefore);
    // Exactly the points stage 1 skipped.
    expect(createdPointAliases.sort()).toEqual(['point1_0', 'point2_0', 'point2_1']);
    // Cumulative totals across both stages.
    expect(res).toMatchObject({ topics: 3, points: 5 });
  });

  it('progress total counts only the staged points, so stage 1 can reach done===total', async () => {
    const seen = [];
    await createTopicsFromTemplate('D1', TEMPLATE, {
      freshDiscussion: true,
      pointTopicIndexes: [0],
      onProgress: (p) => seen.push({ ...p }),
    });
    // 3 topics + 2 staged points = 5, and the bar must finish full.
    expect(seen[0]).toEqual({ done: 0, total: 5 });
    expect(seen[seen.length - 1]).toEqual({ done: 5, total: 5 });
  });

  it('omitting pointTopicIndexes keeps the unstaged behaviour (all points in one pass)', async () => {
    const res = await createTopicsFromTemplate('D1', TEMPLATE, { freshDiscussion: true });
    expect(res).toMatchObject({ topics: 3, points: 5 });
    expect(createdPointAliases).toHaveLength(5);
  });
});

describe('createTopicsFromTemplate — linkLast (round303)', () => {
  // The relation column must be MAPPED for linking to happen at all; the shared
  // mock's getColumns returns {}, so these tests re-mock it per call order probe.
  const callKinds = () => api.mock.calls.map(([q]) => (
    /create_item/.test(q) ? 'topics'
      : /create_subitem/.test(q) ? 'points'
        : /change_multiple_column_values|change_column_value/.test(q) ? 'link'
          : 'other'
  ));

  it('by default the link happens BEFORE the points (legacy order)', async () => {
    columnsMock.value = { discussionLinkID: { id: 'rel1' } };
    await createTopicsFromTemplate('D1', TEMPLATE, { freshDiscussion: true });
    const kinds = callKinds().filter((k) => k !== 'other');
    expect(kinds.indexOf('link')).toBeGreaterThan(kinds.indexOf('topics'));
    expect(kinds.indexOf('link')).toBeLessThan(kinds.indexOf('points'));
  });

  it('with linkLast the discussion is connected only AFTER every point exists', async () => {
    columnsMock.value = { discussionLinkID: { id: 'rel1' } };
    const res = await createTopicsFromTemplate('D1', TEMPLATE, { freshDiscussion: true, linkLast: true });
    expect(res).toMatchObject({ topics: 3, points: 5 });
    const kinds = callKinds().filter((k) => k !== 'other');
    expect(kinds.indexOf('link')).toBeGreaterThan(-1);
    expect(kinds.indexOf('link')).toBeGreaterThan(kinds.lastIndexOf('points'));
  });
});
