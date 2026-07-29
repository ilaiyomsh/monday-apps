/**
 * Board ownership — the settings gate.
 *
 * @module services/owners
 *
 * A board_view context carries NO permission flags (no `isBoardOwner`, and
 * `user.isAdmin` answers a different question), so this can only be an API call.
 *
 * It fails **CLOSED**: any uncertainty answers `false`, because the alternative is
 * exposing the settings surface — the board id, the column mapping, the uploaded
 * template — to a non-owner. It always LOGS, so "the gate is closed for everyone"
 * is visible in telemetry instead of looking like a UI that simply has no settings
 * button. Note this gates SETTINGS only: the per-user item scope applies to owners
 * and admins alike.
 */
import { api } from './monday-client.js';
import { BOARD_OWNERS_QUERY } from './queries.js';
import logger from '../utils/logger.js';

/**
 * @param {string|number} boardId
 * @param {string|number} userId
 * @returns {Promise<boolean>} true only when the user is provably a board owner
 */
export async function isBoardOwner(boardId, userId) {
  const board = String(boardId ?? '').trim();
  const user = String(userId ?? '').trim();
  if (!board || !user) {
    logger.warn('owners', 'בדיקת בעלות על הלוח דולגה — חסר מזהה לוח או מזהה משתמש', {
      boardId: board,
      userId: user,
    });
    return false;
  }

  try {
    const data = await api(BOARD_OWNERS_QUERY, { boardId: [board] }, 'isBoardOwner');
    const owners = data?.boards?.[0]?.owners;
    if (!Array.isArray(owners)) {
      // Board nulled or field missing: treat as "not an owner", but never quietly.
      logger.error('owners', 'תשובת בעלי הלוח חסרה — ההרשאה נסגרת (fail closed)', null, {
        boardId: board,
        response: data,
      });
      return false;
    }
    // monday returns ids as strings; the context may carry a number.
    return owners.some((owner) => String(owner?.id) === user);
  } catch (err) {
    logger.error('owners', 'בדיקת בעלות על הלוח נכשלה — ההרשאה נסגרת (fail closed)', err, {
      boardId: board,
    });
    return false;
  }
}
