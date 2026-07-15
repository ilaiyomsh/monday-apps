// The ONE funnel for monday GraphQL calls (spec §11). Pinned API version,
// GraphQL variables only (string interpolation of user input is forbidden),
// and soft errors inside HTTP-200 responses are THROWN here (error-guard
// funnel rule) — callers never see a half-failed payload.
//
// Operations probe-verified 2026-07-14 against a WZ- sandbox board
// (fixtures: tests/fixtures/*.probe.json). Platform facts encoded here:
// - StatusValue.index carries the label ID (stable), not display order.
// - Never-set columns read as: status index null, people text "",
//   date "" (empty string) — see monday-api skill column-formats.md.

export const API_VERSION = '2026-07';
export const MONDAY_API_URL = 'https://api.monday.com/v2';

const GET_ITEM_QUERY = `query GetItem($itemIds: [ID!], $columnIds: [String!]) {
  items(ids: $itemIds) {
    id
    board { id }
    column_values(ids: $columnIds) {
      id
      text
      ... on StatusValue { index }
      ... on DateValue { date }
    }
  }
}`;

const SET_STATUS_MUTATION = `mutation SetStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
}`;

const ADD_UPDATE_MUTATION = `mutation AddUpdate($itemId: ID!, $body: String!) {
  create_update(item_id: $itemId, body: $body) { id }
}`;

const ME_QUERY = `query Me { me { id name } }`;

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
 * @typedef {object} ItemState
 * @property {boolean} found
 * @property {string} [boardId]
 * @property {number|null} [statusLabelId] - StatusValue.index (label id); null when status unset
 * @property {string} [peopleText] - assignee display name; "" when unset
 * @property {string|null} [deadlineDate] - YYYY-MM-DD; null when no expiry column configured or unset
 */

/**
 * Create the monday API client. See the stubbed JSDoc contract in git
 * history / tests for the full behavioral spec.
 * @param {{ fetchImpl?: typeof fetch, url?: string }} [opts]
 */
export function createMondayApi({ fetchImpl, url = MONDAY_API_URL } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;

  async function graphql({ token, query, variables }) {
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
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
    /**
     * Spec §11.1 — item board + status + people (+ optional deadline).
     * @returns {Promise<ItemState>}
     */
    async getItemState({ token, itemId, statusColumnId, peopleColumnId = null, expiryDateColumnId = null }) {
      const columnIds = [statusColumnId];
      if (peopleColumnId) columnIds.push(peopleColumnId);
      if (expiryDateColumnId) columnIds.push(expiryDateColumnId);

      const data = await graphql({
        token,
        query: GET_ITEM_QUERY,
        variables: { itemIds: [itemId], columnIds },
      });

      const item = data.items?.[0] ?? null;
      if (!item) return { found: false };

      const byId = new Map((item.column_values ?? []).map((cv) => [cv.id, cv]));
      const statusValue = byId.get(statusColumnId);
      const peopleValue = peopleColumnId ? byId.get(peopleColumnId) : null;
      const dateValue = expiryDateColumnId ? byId.get(expiryDateColumnId) : null;

      return {
        found: true,
        boardId: item.board?.id ?? null,
        statusLabelId: statusValue?.index ?? null,
        peopleText: peopleValue?.text ?? '',
        deadlineDate: dateValue?.date ? dateValue.date : null, // "" (never set) → null
      };
    },

    /** Spec §11.2 — value is a JSON *string*; index carries the label id. */
    async changeStatus({ token, boardId, itemId, columnId, toLabelId }) {
      await graphql({
        token,
        query: SET_STATUS_MUTATION,
        variables: { boardId, itemId, columnId, value: JSON.stringify({ index: toLabelId }) },
      });
    },

    /** Spec §11.3 — attribution update. */
    async createUpdate({ token, itemId, body }) {
      await graphql({
        token,
        query: ADD_UPDATE_MUTATION,
        variables: { itemId, body },
      });
    },

    /** OAuth identity + connection liveness probe (§8/§9). */
    async fetchMe({ token }) {
      const data = await graphql({ token, query: ME_QUERY, variables: {} });
      if (!data.me?.id) throw new MondayApiError('me query returned no identity', {});
      return { id: String(data.me.id), name: data.me.name ?? '' };
    },
  };
}
