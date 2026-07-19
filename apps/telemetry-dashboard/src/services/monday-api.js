// The ONE funnel for monday GraphQL calls in this app (modeled on
// deadline-confirm's monday-api.js). Pinned API version, GraphQL variables
// only (string interpolation of user input is forbidden), and soft errors
// inside HTTP-200 responses are THROWN here (error-guard funnel rule) —
// callers never see a half-failed payload.
//
// Differences from the deadline-confirm original, per the lifecycle spec:
// - url/logger are bound at factory time (DI — nothing here reads env or
//   imports helpers); graphql(query, variables) carries no token arg.
// - Authorization is the RAW token (no Bearer), API-Version 2026-04.
// Every funnelled call emits an api_latency health signal (op + ms + ok)
// via the injected logger so slow/failing monday calls are queryable.
//
// Token resolution (Change #143 continuation — app-identity OAuth): the
// token is NOT bound at factory time. `getToken` is resolved PER REQUEST,
// because the write credential may change at runtime (the owner authorizes
// via /oauth/start after the process has already booted) or arrive from the
// MONDAY_API_TOKEN fallback. A null resolution is a MondayApiError
// ('no_write_token'), not a crash — events-board's recordEvent already
// treats any thrown error as a failed write and fails soft (returns null).

export const API_VERSION = '2026-04';
export const MONDAY_API_URL = 'https://api.monday.com/v2';

/** Best-effort operation name from a GraphQL document (for api_latency dims). */
function opName(query) {
  const m = /(?:query|mutation)\s+(\w+)/.exec(String(query ?? ''));
  return m ? m[1] : 'anon';
}

const CREATE_ITEM_MUTATION = `mutation CreateItem($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON) {
  create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id }
}`;

const GET_BOARD_GROUPS_QUERY = `query GetBoardGroups($boardIds: [ID!]) {
  boards(ids: $boardIds) {
    groups { id title }
  }
}`;

const CREATE_GROUP_MUTATION = `mutation CreateGroup($boardId: ID!, $groupName: String!) {
  create_group(board_id: $boardId, group_name: $groupName) { id }
}`;

export class MondayApiError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, unauthorized?: boolean }} [meta]
   */
  constructor(message, { code, status, unauthorized = false } = {}) {
    super(message);
    this.name = 'MondayApiError';
    this.code = code ?? null;
    this.status = status ?? null;
    this.unauthorized = unauthorized;
  }
}

/**
 * Create the monday API client for the lifecycle events board.
 * @param {{ getToken: () => Promise<string|null>, url?: string, fetchImpl?: typeof fetch, logger: object }} opts
 */
export function createMondayApi({ getToken, url = MONDAY_API_URL, fetchImpl, logger }) {
  const doFetch = fetchImpl ?? globalThis.fetch;

  // Timing wrapper: every funnelled call emits an api_latency health signal
  // — op + ms + ok — so slow/failing monday calls are queryable in Axiom.
  async function graphql(query, variables) {
    const started = Date.now();
    const op = opName(query);
    try {
      const data = await runGraphql(query, variables);
      logger.health('api_latency', { op, ms: Date.now() - started, ok: true });
      return data;
    } catch (err) {
      logger.health('api_latency', { op, ms: Date.now() - started, ok: false });
      throw err; // rethrown to the caller — the funnel only measures here
    }
  }

  async function runGraphql(query, variables) {
    // Resolved per request — see the header comment. No token (owner has not
    // authorized yet, and no MONDAY_API_TOKEN fallback) → fail soft, never
    // call fetch with a garbage Authorization header.
    const token = await getToken();
    if (!token) {
      throw new MondayApiError('no_write_token', { code: 'no_write_token' });
    }

    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token, // raw token, no Bearer (monday convention)
          'API-Version': API_VERSION,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      throw new MondayApiError(`monday API network failure: ${err.message}`, {});
    }

    if (!res.ok) {
      throw new MondayApiError(`monday API HTTP ${res.status}`, {
        status: res.status,
        unauthorized: res.status === 401,
      });
    }

    let payload;
    try {
      payload = await res.json();
    } catch (err) {
      throw new MondayApiError(`monday API returned non-JSON body: ${err.message}`, {
        status: res.status,
      });
    }

    // HTTP 200 is not success — soft errors ride inside the body.
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      const first = payload.errors[0];
      const code = first?.extensions?.code ?? null;
      throw new MondayApiError(`monday API error: ${first?.message ?? 'unknown'}`, {
        code,
        status: 200,
        unauthorized: /unauthor|authenticat/i.test(String(code ?? first?.message ?? '')),
      });
    }

    if (!payload?.data) {
      throw new MondayApiError('monday API response has no data', { status: res.status });
    }
    return payload.data;
  }

  return {
    graphql,

    /**
     * Create an item, optionally inside a group. column_values travels as a
     * JSON *string* (monday's JSON scalar); groupId null/undefined → the
     * board's default group (events-board fail-soft: ungrouped beats lost).
     * @param {{ boardId: string|number, groupId?: string|null, itemName: string, columnValues?: object|null }} args
     * @returns {Promise<string|null>} created item id
     */
    async createItem({ boardId, groupId = null, itemName, columnValues = null }) {
      const data = await graphql(CREATE_ITEM_MUTATION, {
        boardId,
        groupId: groupId ?? null,
        itemName,
        columnValues: columnValues == null ? null : JSON.stringify(columnValues),
      });
      const id = data.create_item?.id;
      return id == null ? null : String(id);
    },

    /**
     * List a board's groups.
     * @param {string|number} boardId
     * @returns {Promise<Array<{ id: string, title: string }>>}
     */
    async getBoardGroups(boardId) {
      const data = await graphql(GET_BOARD_GROUPS_QUERY, { boardIds: [boardId] });
      const groups = data.boards?.[0]?.groups ?? [];
      return groups.map((g) => ({ id: String(g.id), title: g.title ?? '' }));
    },

    /**
     * Create a group on a board.
     * @param {{ boardId: string|number, groupName: string }} args
     * @returns {Promise<string|null>} created group id
     */
    async createGroup({ boardId, groupName }) {
      const data = await graphql(CREATE_GROUP_MUTATION, { boardId, groupName });
      const id = data.create_group?.id;
      return id == null ? null : String(id);
    },
  };
}
