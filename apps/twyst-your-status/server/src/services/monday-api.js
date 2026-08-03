/**
 * monday-api — the guard's ONE GraphQL funnel (error-guard funnel rule):
 * pinned API version, variables only (no string interpolation of input), and
 * soft errors inside HTTP-200 responses are THROWN here so no caller ever
 * consumes a half-failed payload. Token is passed per call — this service is
 * multi-tenant and holds no account state.
 *
 * Status semantics (probe-verified in this repo, monday-api skill):
 *   - StatusValue.index carries the label ID (stable), not display order.
 *   - Reverting to "no status" writes {} (empty JSON object clears the cell).
 *
 * Item reads select the SAME typed fragments the client's required-fields
 * registry reads (columnFields.columnValuesSelection), so the emptiness
 * verdict server-side is byte-identical to the picker's.
 */

import { ALL_COLUMN_VALUE_FIELDS } from '../../../src/domain/columnFields.js';
import { normalizeStatusLabels } from '../../../src/domain/statusPolicy.js';

export const API_VERSION = '2026-04';
export const MONDAY_API_URL = 'https://api.monday.com/v2';

const GET_COLUMN_LABELS = `query GuardColumnLabels($boardId: [ID!], $columnId: [String!]) {
  boards(ids: $boardId) {
    columns(ids: $columnId) { id settings_str }
  }
}`;

const GET_CURRENT_STATUS = `query GuardCurrentStatus($itemId: [ID!], $columnId: [String!]) {
  items(ids: $itemId) {
    id
    column_values(ids: $columnId) { id ... on StatusValue { index } }
  }
}`;

const GET_ITEM_GUARD_CONTEXT = `query GuardItemContext($itemId: [ID!], $columnIds: [String!]) {
  items(ids: $itemId) {
    id
    column_values(ids: $columnIds) {
      ${ALL_COLUMN_VALUE_FIELDS}
    }
  }
}`;

const REVERT_STATUS = `mutation GuardRevertStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
}`;

const CREATE_NOTIFICATION = `mutation GuardNotify($userId: ID!, $targetId: ID!, $text: String!, $targetType: NotificationTargetType!) {
  create_notification(user_id: $userId, target_id: $targetId, text: $text, target_type: $targetType) { text }
}`;

const CREATE_WEBHOOK = `mutation GuardCreateWebhook($boardId: ID!, $url: String!, $config: JSON) {
  create_webhook(board_id: $boardId, url: $url, event: change_status_column_value, config: $config) { id board_id }
}`;

const GET_BOARD_OWNERSHIP = `query GuardBoardOwnership($boardId: [ID!]) {
  boards(ids: $boardId) {
    owners { id }
    team_owners { id }
  }
}`;

const GET_USER_TEAMS = `query GuardUserTeams($userId: [ID!]) {
  users(ids: $userId) { teams { id } }
}`;

const ME = `query GuardMe { me { id name } }`;

export class MondayApiError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'MondayApiError';
    this.code = code ?? null;
    this.status = status ?? null;
  }
}

/**
 * @param {{ fetchImpl?: typeof fetch, logger?: object }} [deps]
 */
export function createMondayApi({ fetchImpl, logger } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;

  async function query(token, queryText, variables = {}) {
    const response = await doFetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        'API-Version': API_VERSION,
      },
      body: JSON.stringify({ query: queryText, variables }),
    });
    if (!response.ok) {
      throw new MondayApiError(`monday API HTTP ${response.status}`, { status: response.status });
    }
    const body = await response.json();
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      const message = body.errors.map((err) => err?.message ?? 'unknown error').join('; ');
      logger?.warn?.('monday API soft error thrown at the funnel', 'monday-api', { message });
      throw new MondayApiError(message, { code: body.errors[0]?.extensions?.code });
    }
    return body.data;
  }

  const first = (list) => (Array.isArray(list) && list.length > 0 ? list[0] : null);

  return {
    query,

    async me(token) {
      const data = await query(token, ME);
      return data.me;
    },

    async getColumnLabels(token, boardId, columnId) {
      const data = await query(token, GET_COLUMN_LABELS, { boardId: [boardId], columnId: [columnId] });
      const column = first(first(data.boards)?.columns);
      if (!column?.settings_str) return [];
      try {
        return normalizeStatusLabels(JSON.parse(column.settings_str));
      } catch (err) {
        throw new MondayApiError(
          `unparseable settings_str for column ${columnId}: ${String(err?.message ?? err)}`,
        );
      }
    },

    async getBoardOwnership(token, boardId) {
      const data = await query(token, GET_BOARD_OWNERSHIP, { boardId: [boardId] });
      const board = first(data.boards);
      return {
        ownerIds: (board?.owners ?? []).map((owner) => String(owner.id)),
        teamOwnerIds: (board?.team_owners ?? []).map((team) => String(team.id)),
      };
    },

    async getUserTeamIds(token, userId) {
      const data = await query(token, GET_USER_TEAMS, { userId: [userId] });
      return (first(data.users)?.teams ?? []).map((team) => String(team.id));
    },

    async getCurrentStatusLabelId(token, itemId, columnId) {
      const data = await query(token, GET_CURRENT_STATUS, { itemId: [itemId], columnId: [columnId] });
      const item = first(data.items);
      if (!item) return undefined; // item gone — distinct from "cell empty"
      const cell = (item.column_values ?? []).find((cv) => cv.id === columnId);
      const index = cell?.index;
      return typeof index === 'number' ? String(index) : null;
    },

    async getItemGuardContext(token, itemId, { peopleColumnIds = [], requiredColumnIds = [] }) {
      const columnIds = [...new Set([...peopleColumnIds, ...requiredColumnIds].map(String))];
      const data = await query(token, GET_ITEM_GUARD_CONTEXT, { itemId: [itemId], columnIds });
      const item = first(data.items);
      if (!item) return null;
      const byId = new Map((item.column_values ?? []).map((cv) => [String(cv.id), cv]));

      const peopleByColumnId = {};
      for (const columnId of peopleColumnIds.map(String)) {
        const entries = byId.get(columnId)?.persons_and_teams ?? [];
        peopleByColumnId[columnId] = {
          personIds: entries.filter((e) => e?.kind === 'person').map((e) => String(e.id)),
          teamIds: entries.filter((e) => e?.kind === 'team').map((e) => String(e.id)),
        };
      }

      const requiredFieldValues = requiredColumnIds.map(String).flatMap((columnId) => {
        const cell = byId.get(columnId);
        // A required column missing from the item read stays ABSENT — the
        // evaluator counts it as empty (fail-closed), same as the picker.
        if (!cell) return [];
        return [{ columnId, type: cell.type, columnValue: cell }];
      });

      return { peopleByColumnId, requiredFieldValues };
    },

    async revertStatus(token, boardId, itemId, columnId, labelId) {
      // The write key is `index` but the value is the label ID (monday quirk);
      // {} clears the cell.
      const value = labelId === null ? '{}' : JSON.stringify({ index: Number(labelId) });
      await query(token, REVERT_STATUS, { boardId, itemId, columnId, value });
    },

    async notifyUser(token, userId, itemId, text) {
      await query(token, CREATE_NOTIFICATION, {
        userId,
        targetId: itemId,
        text,
        targetType: 'Project',
      });
    },

    async createColumnWebhook(token, boardId, columnId, url) {
      const data = await query(token, CREATE_WEBHOOK, {
        boardId,
        url,
        config: JSON.stringify({ columnId }),
      });
      return String(data.create_webhook.id);
    },
  };
}
