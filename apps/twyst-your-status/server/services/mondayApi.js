const DEFAULT_API_URL = 'https://api.monday.com/v2';
export const API_VERSION = '2026-04';

export class MondayApiError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = 'MondayApiError';
    this.code = code;
    Object.assign(this, details);
  }
}

const ITEM_STATE_QUERY = `
  query WorkflowItemState($itemIds: [ID!], $columnIds: [String!]) {
    items(ids: $itemIds) {
      id
      column_values(ids: $columnIds) {
        id
        text
        value
        ... on StatusValue { index }
      }
    }
  }
`;

const ACTOR_QUERY = `
  query WorkflowActor($userIds: [ID!]) {
    users(ids: $userIds) {
      id
      teams { id }
    }
  }
`;

const ADMIN_QUERY = `
  query WorkflowAdmin($userIds: [ID!]) {
    users(ids: $userIds) { id is_admin }
  }
`;

const CHANGE_STATUS_MUTATION = `
  mutation WorkflowChangeStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
  }
`;

const CHANGE_COLUMNS_MUTATION = `
  mutation WorkflowChangeColumns($boardId: ID!, $itemId: ID!, $values: JSON!) {
    change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
  }
`;

const NOTIFY_MUTATION = `
  mutation WorkflowNotify($userId: ID!, $boardId: ID!, $text: String!) {
    create_notification(user_id: $userId, target_id: $boardId, text: $text, target_type: Project) { text }
  }
`;

const CREATE_WEBHOOK_MUTATION = `
  mutation WorkflowCreateWebhook($boardId: ID!, $url: String!, $config: JSON!) {
    create_webhook(board_id: $boardId, url: $url, event: change_column_value, config: $config) { id board_id }
  }
`;

const DELETE_WEBHOOK_MUTATION = `
  mutation WorkflowDeleteWebhook($webhookId: ID!) {
    delete_webhook(id: $webhookId) { id }
  }
`;

function stringifyColumnValue(labelId) {
  return JSON.stringify(labelId === null ? null : { index: Number(labelId) });
}

export function createMondayApi({
  fetchImpl = fetch,
  apiUrl = DEFAULT_API_URL,
  timeoutMs = 10_000,
  signalFactory = AbortSignal.timeout,
} = {}) {
  const graphql = async ({ token, query, variables = {} }) => {
    if (typeof token !== 'string' || !token.trim()) {
      throw new MondayApiError('monday_token_missing', 'Missing monday OAuth token.');
    }
    let response;
    try {
      response = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: token,
          'API-Version': API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: signalFactory(timeoutMs),
      });
    } catch (cause) {
      throw new MondayApiError('monday_network', 'monday API transport failure.', { cause });
    }
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      if (!response.ok) {
        throw new MondayApiError('monday_http', `monday API returned HTTP ${response.status}.`, {
          status: response.status,
          cause,
        });
      }
      throw new MondayApiError('monday_bad_json', 'monday API returned invalid JSON.', { cause });
    }
    if (!response.ok) {
      throw new MondayApiError('monday_http', `monday API returned HTTP ${response.status}.`, {
        status: response.status,
      });
    }
    if (payload.errors?.length) {
      const first = payload.errors[0];
      throw new MondayApiError('monday_graphql', first?.message ?? 'monday GraphQL request failed.', {
        mondayCode: first?.extensions?.error_code ?? first?.extensions?.code ?? null,
        errors: payload.errors,
      });
    }
    return payload.data;
  };

  return {
    graphql,

    async getItemState({ token, itemId, statusColumnId, columnIds }) {
      const data = await graphql({
        token,
        query: ITEM_STATE_QUERY,
        variables: { itemIds: [itemId], columnIds },
      });
      const item = data.items?.[0];
      if (!item) throw new Error(`Item ${itemId} was not found.`);
      const status = item.column_values.find((value) => value.id === statusColumnId);
      return {
        labelId: status?.index == null ? null : String(status.index),
        columnValues: item.column_values,
      };
    },

    async getActor({ token, userId }) {
      const data = await graphql({ token, query: ACTOR_QUERY, variables: { userIds: [userId] } });
      const user = data.users?.[0];
      return user
        ? { userId: String(user.id), teamIds: (user.teams ?? []).map((team) => String(team.id)) }
        : { userId: String(userId), teamIds: [] };
    },

    async isAdmin({ token, userId }) {
      const data = await graphql({ token, query: ADMIN_QUERY, variables: { userIds: [userId] } });
      return data.users?.[0]?.is_admin === true;
    },

    async changeStatus({ token, boardId, itemId, columnId, labelId }) {
      return graphql({
        token,
        query: CHANGE_STATUS_MUTATION,
        variables: {
          boardId,
          itemId,
          columnId,
          value: stringifyColumnValue(labelId),
        },
      });
    },

    async changeColumns({ token, boardId, itemId, values }) {
      return graphql({
        token,
        query: CHANGE_COLUMNS_MUTATION,
        variables: { boardId, itemId, values: JSON.stringify(values) },
      });
    },

    async notifyUser({ token, userId, boardId, text }) {
      return graphql({
        token,
        query: NOTIFY_MUTATION,
        variables: { userId, boardId, text },
      });
    },

    async createStatusWebhook({ token, boardId, url, columnId }) {
      const data = await graphql({
        token,
        query: CREATE_WEBHOOK_MUTATION,
        variables: { boardId, url, config: JSON.stringify({ columnId }) },
      });
      return data.create_webhook;
    },

    async deleteWebhook({ token, webhookId }) {
      return graphql({ token, query: DELETE_WEBHOOK_MUTATION, variables: { webhookId } });
    },
  };
}
