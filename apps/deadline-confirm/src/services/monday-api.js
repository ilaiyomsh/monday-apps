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

import { health } from '../helpers/logger.js';

export const API_VERSION = '2026-07';
export const MONDAY_API_URL = 'https://api.monday.com/v2';

/** Best-effort operation name from a GraphQL document (for api_latency dims). */
function opName(query) {
  const m = /(?:query|mutation)\s+(\w+)/.exec(String(query ?? ''));
  return m ? m[1] : 'anon';
}

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

// v4 digest board reads — cursor pagination: the FIRST page comes from
// boards.items_page, every following page from root-level next_items_page
// (platform contract). Typed value fragments per the monday-api skill
// column-formats reference; PeopleValue.persons_and_teams filtered to
// kind 'person' during normalization.
const ITEM_FIELDS = `id
        name
        column_values(ids: $columnIds) {
          id
          text
          ... on StatusValue { index }
          ... on DateValue { date }
          ... on PeopleValue { persons_and_teams { id kind } }
        }`;

const BOARD_ITEMS_QUERY = `query GetBoardItems($boardId: [ID!], $columnIds: [String!], $limit: Int!) {
  boards(ids: $boardId) {
    items_page(limit: $limit) {
      cursor
      items {
        ${ITEM_FIELDS}
      }
    }
  }
}`;

const NEXT_ITEMS_QUERY = `query NextBoardItems($cursor: String!, $columnIds: [String!], $limit: Int!) {
  next_items_page(cursor: $cursor, limit: $limit) {
    cursor
    items {
      ${ITEM_FIELDS}
    }
  }
}`;

/** Normalize one raw item to the app shape (never-set rules: see header). */
function normalizeBoardItem(raw) {
  const columns = {};
  for (const cv of raw.column_values ?? []) {
    columns[cv.id] = {
      text: cv.text ?? '',
      statusLabelId: cv.index ?? null,
      date: cv.date ? cv.date : null, // "" (never set) → null
      personIds: (cv.persons_and_teams ?? [])
        .filter((p) => p?.kind === 'person')
        .map((p) => String(p.id)),
    };
  }
  return { id: String(raw.id), name: raw.name ?? '', columns };
}

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

  // Timing wrapper: every funnelled call emits an api_latency health signal
  // (D5) — op + ms + ok — so slow/failing monday calls are queryable in Axiom.
  async function graphql(args) {
    const started = Date.now();
    const op = opName(args?.query);
    try {
      const data = await runGraphql(args);
      health('api_latency', { op, ms: Date.now() - started, ok: true });
      return data;
    } catch (err) {
      health('api_latency', { op, ms: Date.now() - started, ok: false });
      throw err;
    }
  }

  async function runGraphql({ token, query, variables }) {
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

    /**
     * v4 digest — read a whole board's items (cursor pagination via
     * items_page → next_items_page), normalized to the app's column shape:
     * { text, statusLabelId, date, personIds }. `truncated` reports a hit on
     * the page cap (no silent truncation).
     * @param {{ token: string, boardId: string, columnIds: string[], pageSize?: number, maxPages?: number }} p
     * @returns {Promise<{ items: Array<object>, truncated: boolean }>}
     */
    async getBoardItems({ token, boardId, columnIds, pageSize = 100, maxPages = 20 }) {
      const items = [];
      let cursor = null;
      let pages = 0;

      while (pages < maxPages) {
        const data = cursor
          ? await graphql({
              token,
              query: NEXT_ITEMS_QUERY,
              variables: { cursor, columnIds, limit: pageSize },
            })
          : await graphql({
              token,
              query: BOARD_ITEMS_QUERY,
              variables: { boardId: [boardId], columnIds, limit: pageSize },
            });
        const page = cursor ? data.next_items_page : data.boards?.[0]?.items_page;
        if (!page) break;
        for (const raw of page.items ?? []) items.push(normalizeBoardItem(raw));
        pages += 1;
        cursor = page.cursor ?? null;
        if (!cursor) break;
      }

      return { items, truncated: Boolean(cursor) };
    },

    /** OAuth identity + connection liveness probe (§8/§9). */
    async fetchMe({ token }) {
      const data = await graphql({ token, query: ME_QUERY, variables: {} });
      if (!data.me?.id) throw new MondayApiError('me query returned no identity', {});
      return { id: String(data.me.id), name: data.me.name ?? '' };
    },
  };
}
