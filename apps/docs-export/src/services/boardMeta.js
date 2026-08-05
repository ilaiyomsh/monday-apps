/**
 * Board metadata — the name plus every column's id/title/type.
 *
 * @module services/boardMeta
 *
 * This is what the settings panel maps the five roles against, and where the
 * four optional table-header overrides get their defaults (an empty override
 * means "use the board column's title"). A board that is gone or unreachable must
 * FAIL here rather than resolve to an empty column list — an empty list would let
 * the owner "map" nothing and ship a permanently empty report.
 */
import { api } from './monday-client.js';
import { BOARD_META_QUERY } from './queries.js';

/** Literals that arrive as strings from settings/context and mean "no board". */
const UNUSABLE_IDS = new Set(['', 'undefined', 'null', 'NaN']);

/**
 * @param {string|number} boardId
 * @returns {Promise<{id: string, name: string, columns: Array<{id: string, title: string, type: string}>}>}
 * @throws {Error} when boardId is unusable, or the board is not found / not accessible
 */
export async function fetchBoardMeta(boardId) {
  const id = String(boardId ?? '').trim();
  // A stringified undefined/null/NaN reaching `ids:` is accepted by monday and
  // answered with an empty list — validate before the wire, not after.
  if (UNUSABLE_IDS.has(id) || !/^\d+$/.test(id)) {
    throw new Error(
      `fetchBoardMeta: boardId "${boardId}" is not a numeric monday board id — refusing to query.`
    );
  }

  const data = await api(BOARD_META_QUERY, { boardId: [id] }, 'fetchBoardMeta');

  const board = data?.boards?.[0];
  if (!board) {
    throw new Error(
      `fetchBoardMeta: board ${id} was not found or is not accessible to this user.`
    );
  }

  return {
    id: String(board.id ?? id),
    name: board.name ?? '',
    columns: (board.columns || []).map((column) => ({
      id: column.id,
      title: column.title ?? '',
      type: column.type,
    })),
  };
}
