import { describe, expect, it, vi } from 'vitest';

// templates.js already exists, while the pure batching helpers are the new
// contract under test. Mock its monday-facing dependencies so this suite can
// exercise only deterministic query planning/parsing behavior.
vi.mock('../mondayApi/monday-client.js', () => ({
  api: vi.fn(),
  formatValue: vi.fn(),
}));
vi.mock('../mondayApi/board-config-store.js', () => ({
  getBoardId: vi.fn(),
  getColumns: vi.fn(),
}));
vi.mock('../topicOrder.js', () => ({
  saveTopicOrder: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as templateHelpers from '../templates.js';

function requireHelper(name) {
  expect(
    templateHelpers[name],
    `${name} must be exported from templates.js for batched template creation`
  ).toBeTypeOf('function');
  return templateHelpers[name];
}

function operationCount(query, fieldName) {
  return [...query.matchAll(new RegExp(`\\b${fieldName}\\s*\\(`, 'g'))].length;
}

function variableDefinitions(query) {
  const header = query.slice(0, query.indexOf('{'));
  return [...header.matchAll(/\$([_A-Za-z][_0-9A-Za-z]*)\s*:/g)].map((match) => match[1]);
}

function assertBatchEnvelope(batch, fieldName) {
  expect(batch).toEqual(expect.objectContaining({
    query: expect.any(String),
    variables: expect.any(Object),
    operations: expect.any(Array),
  }));
  expect(batch.operations.length).toBeGreaterThan(0);
  expect(batch.operations.length).toBeLessThanOrEqual(10);
  expect(operationCount(batch.query, fieldName)).toBe(batch.operations.length);

  const definitions = variableDefinitions(batch.query);
  expect(new Set(definitions).size).toBe(definitions.length);
  expect([...new Set(definitions)].sort()).toEqual(Object.keys(batch.variables).sort());

  for (const operation of batch.operations) {
    expect(operation.alias).toMatch(/^[_A-Za-z][_0-9A-Za-z]*$/);
    expect(batch.query).toMatch(new RegExp(`\\b${operation.alias}\\s*:\\s*${fieldName}\\s*\\(`));
  }
}

function aliases(batches) {
  return batches.flatMap((batch) => batch.operations.map((operation) => operation.alias));
}

describe('template creation GraphQL batching', () => {
  it('keeps topic-create requests at 10 operations at the boundary and starts a new request for operation 11', () => {
    const buildTopicCreateBatches = requireHelper('buildTopicCreateBatches');
    const topicsAtBoundary = Array.from({ length: 10 }, (_, index) => ({
      name: `Topic ${index}`,
      points: [],
    }));
    const topicsPastBoundary = [...topicsAtBoundary, { name: 'Topic 10', points: [] }];

    const atBoundary = buildTopicCreateBatches({ boardId: 'topics-board', topics: topicsAtBoundary });
    const pastBoundary = buildTopicCreateBatches({ boardId: 'topics-board', topics: topicsPastBoundary });

    expect(atBoundary.map((batch) => batch.operations.length)).toEqual([10]);
    expect(pastBoundary.map((batch) => batch.operations.length)).toEqual([10, 1]);
    expect(pastBoundary.flatMap((batch) => batch.operations.map((operation) => operation.sourceIndex)))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(aliases(pastBoundary)).size).toBe(11);
    for (const batch of pastBoundary) assertBatchEnvelope(batch, 'create_item');
  });

  it('keeps every topic name and board id in uniquely declared variables instead of interpolating user values into GraphQL', () => {
    const buildTopicCreateBatches = requireHelper('buildTopicCreateBatches');
    const boardId = 'board-$-18416019247';
    const names = [
      'Quarterly review',
      'CEO\'s $plan ) { injected: create_item(board_id: 1)',
      'נושא עם עברית וגרשיים "כאן"',
    ];

    const [batch] = buildTopicCreateBatches({
      boardId,
      topics: names.map((name) => ({ name, points: [] })),
    });

    assertBatchEnvelope(batch, 'create_item');
    for (const value of [boardId, ...names]) {
      expect(batch.query).not.toContain(value);
      expect(Object.values(batch.variables)).toContain(value);
    }
  });

  it('parses topic aliases in source-template order even when response keys arrive in reverse order', () => {
    const buildTopicCreateBatches = requireHelper('buildTopicCreateBatches');
    const parseAliasedMutationResult = requireHelper('parseAliasedMutationResult');
    const [batch] = buildTopicCreateBatches({
      boardId: 'topics-board',
      topics: ['First', 'Second', 'Third'].map((name) => ({ name, points: [] })),
    });
    const [first, second, third] = batch.operations;

    const parsed = parseAliasedMutationResult(batch, {
      data: {
        [third.alias]: { id: 'topic-3' },
        [second.alias]: { id: 'topic-2' },
        [first.alias]: { id: 'topic-1' },
      },
      errors: [],
    });

    expect(parsed.successful.map(({ alias, sourceIndex, id }) => ({ alias, sourceIndex, id }))).toEqual([
      { alias: first.alias, sourceIndex: 0, id: 'topic-1' },
      { alias: second.alias, sourceIndex: 1, id: 'topic-2' },
      { alias: third.alias, sourceIndex: 2, id: 'topic-3' },
    ]);
    expect(parsed.failed).toEqual([]);
    expect(parsed.retryOperations).toEqual([]);
  });

  it('represents topic-to-discussion relation updates as aliased batches without embedding ids or column values in the query', () => {
    const buildTopicRelationBatches = requireHelper('buildTopicRelationBatches');
    const boardId = 'topics-board-18416019247';
    const discussionId = 'discussion-9001';
    const relationColumnId = 'board_relation_discussion';
    const topics = Array.from({ length: 11 }, (_, sourceIndex) => ({
      sourceIndex,
      id: `topic-${sourceIndex}`,
    }));

    const batches = buildTopicRelationBatches({ boardId, discussionId, relationColumnId, topics });

    expect(batches.map((batch) => batch.operations.length)).toEqual([10, 1]);
    expect(batches.flatMap((batch) => batch.operations.map(({ kind, sourceIndex, itemId }) => ({
      kind,
      sourceIndex,
      itemId,
    })))).toEqual(topics.map(({ sourceIndex, id }) => ({
      kind: 'topicRelation',
      sourceIndex,
      itemId: id,
    })));
    for (const batch of batches) {
      assertBatchEnvelope(batch, 'change_multiple_column_values');
      expect(batch.query).not.toContain(boardId);
      expect(batch.query).not.toContain(discussionId);
      expect(batch.query).not.toContain(relationColumnId);
    }
    const serializedVariables = JSON.stringify(batches.map((batch) => batch.variables));
    expect(serializedVariables).toContain(boardId);
    expect(serializedVariables).toContain(discussionId);
    expect(serializedVariables).toContain(relationColumnId);
    for (const { id } of topics) expect(serializedVariables).toContain(id);
  });

  it('maps each point operation to its resolved parent topic id while preserving topic and point source order', () => {
    const buildPointCreateBatches = requireHelper('buildPointCreateBatches');
    const topics = [
      { sourceIndex: 1, id: 'topic-B', points: ['B-1'] },
      { sourceIndex: 0, id: 'topic-A', points: ['A-1', 'A-2'] },
    ];

    const batches = buildPointCreateBatches({ topics });
    const operations = batches.flatMap((batch) => batch.operations);

    expect(operations.map(({ kind, topicSourceIndex, pointIndex, parentTopicId }) => ({
      kind,
      topicSourceIndex,
      pointIndex,
      parentTopicId,
    }))).toEqual([
      { kind: 'point', topicSourceIndex: 0, pointIndex: 0, parentTopicId: 'topic-A' },
      { kind: 'point', topicSourceIndex: 0, pointIndex: 1, parentTopicId: 'topic-A' },
      { kind: 'point', topicSourceIndex: 1, pointIndex: 0, parentTopicId: 'topic-B' },
    ]);
    for (const batch of batches) assertBatchEnvelope(batch, 'create_subitem');

    const queryText = batches.map((batch) => batch.query).join('\n');
    for (const value of ['topic-A', 'topic-B', 'A-1', 'A-2', 'B-1']) {
      expect(queryText).not.toContain(value);
      expect(batches.some((batch) => Object.values(batch.variables).includes(value))).toBe(true);
    }
  });

  it('identifies GraphQL-failed and missing aliases for retry without including aliases that already succeeded', () => {
    const buildTopicCreateBatches = requireHelper('buildTopicCreateBatches');
    const parseAliasedMutationResult = requireHelper('parseAliasedMutationResult');
    const [batch] = buildTopicCreateBatches({
      boardId: 'topics-board',
      topics: ['A', 'B', 'C', 'D'].map((name) => ({ name, points: [] })),
    });
    const [succeededA, failedB, missingC, succeededD] = batch.operations;

    const parsed = parseAliasedMutationResult(batch, {
      data: {
        [succeededD.alias]: { id: 'topic-D' },
        [succeededA.alias]: { id: 'topic-A' },
        [failedB.alias]: null,
      },
      errors: [{ message: 'permission denied', path: [failedB.alias] }],
    });

    expect(parsed.successful.map(({ alias, sourceIndex, id }) => ({ alias, sourceIndex, id }))).toEqual([
      { alias: succeededA.alias, sourceIndex: 0, id: 'topic-A' },
      { alias: succeededD.alias, sourceIndex: 3, id: 'topic-D' },
    ]);
    expect(parsed.failed.map(({ alias, sourceIndex, reason }) => ({ alias, sourceIndex, reason }))).toEqual([
      { alias: failedB.alias, sourceIndex: 1, reason: 'graphql_error' },
      { alias: missingC.alias, sourceIndex: 2, reason: 'missing_result' },
    ]);
    expect(parsed.retryOperations.map(({ alias, sourceIndex }) => ({ alias, sourceIndex }))).toEqual([
      { alias: failedB.alias, sourceIndex: 1 },
      { alias: missingC.alias, sourceIndex: 2 },
    ]);
    expect(parsed.retryOperations.map((operation) => operation.alias)).not.toContain(succeededA.alias);
    expect(parsed.retryOperations.map((operation) => operation.alias)).not.toContain(succeededD.alias);
  });

  it('builds a fresh-order payload in template order for topics and points even when result records are unordered', () => {
    const buildFreshTopicOrderPayload = requireHelper('buildFreshTopicOrderPayload');

    const payload = buildFreshTopicOrderPayload({
      topicResults: [
        { sourceIndex: 2, id: 'topic-C' },
        { sourceIndex: 0, id: 'topic-A' },
        { sourceIndex: 1, id: 'topic-B' },
      ],
      pointResults: [
        { topicSourceIndex: 1, pointIndex: 1, id: 'point-B2' },
        { topicSourceIndex: 0, pointIndex: 1, id: 'point-A2' },
        { topicSourceIndex: 1, pointIndex: 0, id: 'point-B1' },
        { topicSourceIndex: 0, pointIndex: 0, id: 'point-A1' },
      ],
    });

    expect(payload).toEqual({
      topics: ['topic-A', 'topic-B', 'topic-C'],
      points: {
        'topic-A': ['point-A1', 'point-A2'],
        'topic-B': ['point-B1', 'point-B2'],
        'topic-C': [],
      },
    });
  });
});
