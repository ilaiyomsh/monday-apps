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
 * The answer is TRI-STATE, not a boolean, and the distinction is load-bearing.
 *
 * `determined` says whether the question was actually ANSWERED — i.e. monday returned
 * a real owners array we could compare against. It is `false` whenever the check could
 * not run or could not be trusted: a missing id, a thrown request (most commonly the
 * app lacking the `boards:read` scope), or a response whose `owners` field was absent.
 *
 * WHY (a real dead end this caused): callers used to collapse "provably not an owner"
 * and "could not tell" into one `false`. On an UNCONFIGURED instance that is a trap
 * with no exit — the gate showed "the board owner must configure this app" to the
 * board owner themselves, and since configuring is the only way out, the app could
 * never become usable. Fail-closed is right once settings EXIST and there is something
 * to protect (a board id, a column mapping, an uploaded template); it is wrong before
 * that, when there is nothing to protect and refusing merely bricks the instance.
 *
 * `isOwner: true` still means PROVEN, and only a caller looking at an unconfigured
 * instance should treat `determined: false` as permission to proceed.
 *
 * @param {string|number} boardId
 * @param {string|number} userId
 * @returns {Promise<{isOwner: boolean, determined: boolean}>}
 */
export async function isBoardOwner(boardId, userId) {
  const board = String(boardId ?? '').trim();
  const user = String(userId ?? '').trim();
  if (!board || !user) {
    logger.warn('owners', 'בדיקת בעלות על הלוח דולגה — חסר מזהה לוח או מזהה משתמש', {
      boardId: board,
      userId: user,
    });
    return { isOwner: false, determined: false };
  }

  try {
    const data = await api(BOARD_OWNERS_QUERY, { boardId: [board] }, 'isBoardOwner');
    const owners = data?.boards?.[0]?.owners;
    if (!Array.isArray(owners)) {
      // Board nulled or field missing — we did NOT learn the answer.
      logger.error('owners', 'תשובת בעלי הלוח חסרה — הבעלות לא ניתנת לקביעה', null, {
        boardId: board,
        response: data,
      });
      return { isOwner: false, determined: false };
    }
    // monday returns ids as strings; the context may carry a number.
    // Reaching here means the question WAS answered, whatever the answer is.
    return { isOwner: owners.some((owner) => String(owner?.id) === user), determined: true };
  } catch (err) {
    // The common real-world cause is a missing `boards:read` scope on the app, which
    // surfaces as a failed request rather than an empty result. Undetermined, not "no".
    logger.error('owners', 'בדיקת בעלות על הלוח נכשלה — הבעלות לא ניתנת לקביעה', err, {
      boardId: board,
    });
    return { isOwner: false, determined: false };
  }
}
