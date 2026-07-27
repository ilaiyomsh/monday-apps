const DEFAULT_BATCH_SIZE = 10;

function chunk(items, size = DEFAULT_BATCH_SIZE) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function mutationDocument(name, definitions, fields) {
  return `mutation ${name}(${definitions.join(', ')}) {\n${fields.join('\n')}\n}`;
}

function normalizeId(value) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) ? Number(text) : value;
}

export function buildTopicCreateBatches({ boardId, topics = [] }) {
  const operations = topics.map((topic, fallbackSourceIndex) => ({
    kind: 'topic',
    sourceIndex: Number.isInteger(topic?.sourceIndex) ? topic.sourceIndex : fallbackSourceIndex,
    name: topic?.name || '',
    columnValues: topic?.columnValues || '{}',
  })).map((operation) => ({
    ...operation,
    alias: `topic${operation.sourceIndex}`,
  }));

  return chunk(operations).map((batchOperations, batchIndex) => {
    const variables = { boardId };
    const definitions = ['$boardId: ID!'];
    const fields = batchOperations.map((operation, localIndex) => {
      const nameVar = `name${localIndex}`;
      const cvVar = `cv${localIndex}`;
      definitions.push(`$${nameVar}: String!`, `$${cvVar}: JSON!`);
      variables[nameVar] = operation.name;
      variables[cvVar] = operation.columnValues;
      return `  ${operation.alias}: create_item(board_id: $boardId, item_name: $${nameVar}, column_values: $${cvVar}) { id }`;
    });
    return {
      query: mutationDocument(`BatchCreateTopics${batchIndex}`, definitions, fields),
      variables,
      operations: batchOperations,
    };
  });
}

export function buildTopicRelationBatches({
  boardId,
  discussionId,
  relationColumnId,
  topics = [],
}) {
  if (!relationColumnId) return [];
  const relationValue = JSON.stringify({
    [relationColumnId]: { item_ids: [normalizeId(discussionId)] },
  });
  const operations = topics
    .filter((topic) => topic?.id != null)
    .map((topic) => ({
      alias: `topicRelation${topic.sourceIndex}`,
      kind: 'topicRelation',
      sourceIndex: topic.sourceIndex,
      itemId: String(topic.id),
      columnValues: relationValue,
    }));

  return chunk(operations).map((batchOperations, batchIndex) => {
    const variables = { boardId };
    const definitions = ['$boardId: ID!'];
    const fields = batchOperations.map((operation, localIndex) => {
      const itemVar = `itemId${localIndex}`;
      const cvVar = `cv${localIndex}`;
      definitions.push(`$${itemVar}: ID!`, `$${cvVar}: JSON!`);
      variables[itemVar] = operation.itemId;
      variables[cvVar] = operation.columnValues;
      return `  ${operation.alias}: change_multiple_column_values(board_id: $boardId, item_id: $${itemVar}, column_values: $${cvVar}) { id }`;
    });
    return {
      query: mutationDocument(`BatchLinkTopics${batchIndex}`, definitions, fields),
      variables,
      operations: batchOperations,
    };
  });
}

export function buildPointCreateBatches({ topics = [] }) {
  const operations = [...topics]
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .flatMap((topic) => (topic.points || []).map((point, fallbackPointIndex) => {
      const isObject = point && typeof point === 'object';
      const pointIndex = isObject && Number.isInteger(point.pointIndex)
        ? point.pointIndex
        : fallbackPointIndex;
      return {
        alias: `point${topic.sourceIndex}_${pointIndex}`,
        kind: 'point',
        topicSourceIndex: topic.sourceIndex,
        pointIndex,
        parentTopicId: String(topic.id),
        name: isObject ? point.name || '' : point,
        columnValues: (isObject && point.columnValues) || '{}',
      };
    }))
    .sort((a, b) => (
      a.topicSourceIndex - b.topicSourceIndex || a.pointIndex - b.pointIndex
    ));

  return chunk(operations).map((batchOperations, batchIndex) => {
    const variables = {};
    const definitions = [];
    const fields = batchOperations.map((operation, localIndex) => {
      const parentVar = `parentId${localIndex}`;
      const nameVar = `name${localIndex}`;
      const cvVar = `cv${localIndex}`;
      definitions.push(`$${parentVar}: ID!`, `$${nameVar}: String!`, `$${cvVar}: JSON!`);
      variables[parentVar] = operation.parentTopicId;
      variables[nameVar] = operation.name;
      variables[cvVar] = operation.columnValues;
      return `  ${operation.alias}: create_subitem(parent_item_id: $${parentVar}, item_name: $${nameVar}, column_values: $${cvVar}) { id }`;
    });
    return {
      query: mutationDocument(`BatchCreatePoints${batchIndex}`, definitions, fields),
      variables,
      operations: batchOperations,
    };
  });
}

export function parseAliasedMutationResult(batch, response = {}) {
  const data = response?.data && typeof response.data === 'object'
    ? response.data
    : response;
  const errors = Array.isArray(response?.errors) ? response.errors : [];
  const errorAliases = new Set(
    errors.map((error) => error?.path?.[0]).filter((alias) => typeof alias === 'string')
  );
  const successful = [];
  const failed = [];

  for (const operation of batch?.operations || []) {
    const value = data?.[operation.alias];
    if (value?.id != null) {
      successful.push({ ...operation, id: String(value.id) });
      continue;
    }
    failed.push({
      ...operation,
      reason: errorAliases.has(operation.alias) ? 'graphql_error' : 'missing_result',
    });
  }

  return {
    successful,
    failed,
    retryOperations: failed.map((operation) => ({ ...operation })),
  };
}

export function buildFreshTopicOrderPayload({ topicResults = [], pointResults = [] }) {
  const orderedTopics = [...topicResults]
    .filter((topic) => topic?.id != null)
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
  const points = {};

  for (const topic of orderedTopics) {
    points[String(topic.id)] = pointResults
      .filter((point) => (
        point?.id != null && point.topicSourceIndex === topic.sourceIndex
      ))
      .sort((a, b) => a.pointIndex - b.pointIndex)
      .map((point) => String(point.id));
  }

  return {
    topics: orderedTopics.map((topic) => String(topic.id)),
    points,
  };
}
