import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mondayApi/monday-client.js', () => ({
  api: vi.fn(),
  formatValue: vi.fn((_type, value) => value),
}));
vi.mock('../mondayApi/board-config-store.js', () => ({
  getBoardId: vi.fn(() => 'TOPICS_BOARD'),
  getColumns: vi.fn(() => ({
    discussionLinkID: { id: 'discussion_link', type: 'board_relation' },
  })),
}));
vi.mock('../topicOrder.js', () => ({
  saveTopicOrder: vi.fn(),
  saveFreshTopicOrder: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  default: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), health: vi.fn(),
  },
}));

import { api } from '../mondayApi/monday-client.js';
import { saveFreshTopicOrder, saveTopicOrder } from '../topicOrder.js';
import { createTopicsFromTemplate } from '../templates.js';

const TEMPLATE = {
  topics: [
    { name: 'Topic A', points: ['Point A1', 'Point A2'] },
    { name: 'Topic B', points: ['Point B1'] },
  ],
};

function aliasesFor(query, field) {
  return [...query.matchAll(new RegExp(`\\b([_A-Za-z][_0-9A-Za-z]*)\\s*:\\s*${field}\\s*\\(`, 'g'))]
    .map((match) => match[1]);
}

function successfulBatchResponse(query) {
  const topicAliases = aliasesFor(query, 'create_item');
  if (topicAliases.length) {
    return Object.fromEntries(topicAliases.map((alias) => [alias, { id: `T-${alias}` }]));
  }
  const relationAliases = aliasesFor(query, 'change_multiple_column_values');
  if (relationAliases.length) {
    return Object.fromEntries(relationAliases.map((alias) => [alias, { id: `L-${alias}` }]));
  }
  const pointAliases = aliasesFor(query, 'create_subitem');
  if (pointAliases.length) {
    return Object.fromEntries(pointAliases.map((alias) => [alias, { id: `P-${alias}` }]));
  }
  return {};
}

beforeEach(() => {
  vi.clearAllMocks();
  api.mockImplementation(async (query) => successfulBatchResponse(query));
});

describe('createTopicsFromTemplate batched execution', () => {
  it('creates two topics, links them, and creates three points in three SDK bridge calls', async () => {
    const result = await createTopicsFromTemplate('DISCUSSION_1', TEMPLATE);

    expect(api).toHaveBeenCalledTimes(3);
    expect(api.mock.calls.every((call) => call[3]?.retry === false)).toBe(true);
    expect(aliasesFor(api.mock.calls[0][0], 'create_item')).toHaveLength(2);
    expect(aliasesFor(api.mock.calls[1][0], 'change_multiple_column_values')).toHaveLength(2);
    expect(aliasesFor(api.mock.calls[2][0], 'create_subitem')).toHaveLength(3);
    expect(result).toMatchObject({
      topics: 2,
      points: 3,
      topicIds: ['T-topic0', 'T-topic1'],
    });
  });

  it('persists complete topic and point order in one fresh-order write', async () => {
    await createTopicsFromTemplate('DISCUSSION_1', TEMPLATE, { freshDiscussion: true });

    expect(saveFreshTopicOrder).toHaveBeenCalledTimes(1);
    expect(saveFreshTopicOrder).toHaveBeenCalledWith('DISCUSSION_1', {
      topics: ['T-topic0', 'T-topic1'],
      points: {
        'T-topic0': ['P-point0_0', 'P-point0_1'],
        'T-topic1': ['P-point1_0'],
      },
    });
    expect(saveTopicOrder).not.toHaveBeenCalled();
  });

  it('preserves existing topic ids when applying a template to an existing discussion', async () => {
    await createTopicsFromTemplate('DISCUSSION_1', TEMPLATE, {
      freshDiscussion: false,
      existingTopicIds: ['EXISTING_1'],
    });

    expect(saveTopicOrder).toHaveBeenCalledWith(
      'DISCUSSION_1',
      ['EXISTING_1', 'T-topic0', 'T-topic1']
    );
    expect(saveFreshTopicOrder).not.toHaveBeenCalled();
  });

  it('reports one monotonic progress tick per successful topic and point', async () => {
    const seen = [];
    await createTopicsFromTemplate('DISCUSSION_1', TEMPLATE, {
      onProgress: (progress) => seen.push({ ...progress }),
    });

    expect(seen).toEqual([
      { done: 0, total: 5 },
      { done: 1, total: 5 },
      { done: 2, total: 5 },
      { done: 3, total: 5 },
      { done: 4, total: 5 },
      { done: 5, total: 5 },
    ]);
  });

  it('checkpoints partial alias success so retry creates only the missing topic', async () => {
    let firstTopicBatch = true;
    let checkpoint = null;
    api.mockImplementation(async (query) => {
      const topicAliases = aliasesFor(query, 'create_item');
      if (topicAliases.length && firstTopicBatch) {
        firstTopicBatch = false;
        const error = new Error('partial topic failure');
        error.response = {
          data: {
            [topicAliases[0]]: { id: 'T-topic0' },
            [topicAliases[1]]: null,
          },
          errors: [{ message: 'failed topic', path: [topicAliases[1]] }],
        };
        throw error;
      }
      return successfulBatchResponse(query);
    });

    await expect(createTopicsFromTemplate('DISCUSSION_1', TEMPLATE, {
      onCheckpoint: (next) => { checkpoint = next; },
    })).rejects.toThrow('partial topic failure');
    expect(checkpoint.topicResults).toEqual([
      expect.objectContaining({ sourceIndex: 0, id: 'T-topic0' }),
    ]);

    api.mockClear();
    await createTopicsFromTemplate('DISCUSSION_1', TEMPLATE, { resumeState: checkpoint });

    const retryTopicCalls = api.mock.calls.filter(([query]) => aliasesFor(query, 'create_item').length);
    expect(retryTopicCalls).toHaveLength(1);
    expect(aliasesFor(retryTopicCalls[0][0], 'create_item')).toEqual(['topic1']);
  });

  it('locks an ambiguous transport failure instead of risking duplicate creates on retry', async () => {
    api.mockRejectedValueOnce(new Error('Failed to fetch'));
    let checkpoint = null;

    const firstAttempt = createTopicsFromTemplate('DISCUSSION_1', TEMPLATE, {
      onCheckpoint: (next) => { checkpoint = next; },
    });
    await expect(firstAttempt).rejects.toMatchObject({
      code: 'AMBIGUOUS_TEMPLATE_MUTATION',
    });
    expect(checkpoint?.ambiguousMutation).toMatchObject({ phase: 'topics' });

    api.mockClear();
    await expect(createTopicsFromTemplate('DISCUSSION_1', TEMPLATE, {
      resumeState: checkpoint,
    })).rejects.toMatchObject({
      code: 'AMBIGUOUS_TEMPLATE_MUTATION',
    });
    expect(api).not.toHaveBeenCalled();
  });
});
