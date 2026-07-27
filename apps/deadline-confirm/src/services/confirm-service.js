// v2 action core (dynamic buttons). The HTTP layer owns parsing, the secret
// gate, rate limiting, and page rendering; THIS module owns button
// resolution, guards, and the mutations.
//
// v2 semantics (owner decisions 2026-07-15):
// - N buttons; each names its own status column + target label id.
// - NO from-status guard, NO expiry — the click always drives toward the
//   button's target.
// - Idempotent-by-skip: when the status already equals the target, succeed
//   silently with NO mutation and NO update (emails are re-sent daily).
// V6/D11 (docs/v6-amp-only-decisions.md): when `expectedPersonId` is given,
// it must be among the item's people-column person ids or the item is
// refused with `not_assignee` — a PER-ITEM state failure, never a
// whole-request rejection. The check runs BEFORE already_done and costs
// zero extra API calls (the people column is already fetched for
// attribution). It verifies assignment, NOT clicker identity — AMP carries
// none.

import { MondayApiError } from './monday-api.js';
import { logError } from '../helpers/logger.js';

/**
 * Find a button by id on the stored config.
 * @param {object|null} config
 * @param {string} btnId
 * @returns {object|null}
 */
export function resolveButton(config, btnId) {
  if (!config || !Array.isArray(config.buttons)) return null;
  return config.buttons.find((b) => b.id === btnId) ?? null;
}

/**
 * v2 config completeness — see the contract in git history / tests.
 * targetIndex 0 is a VALID label id; templates are not required.
 * @param {object|null} config
 * @returns {boolean}
 */
export function configIsComplete(config) {
  if (!config || typeof config.boardId !== 'string' || config.boardId.length === 0) return false;
  if (!Array.isArray(config.buttons) || config.buttons.length === 0) return false;
  return config.buttons.every(
    (b) =>
      typeof b?.id === 'string' &&
      b.id.length > 0 &&
      typeof b.name === 'string' &&
      b.name.length > 0 &&
      typeof b.statusColumnId === 'string' &&
      b.statusColumnId.length > 0 &&
      typeof b.targetLabel === 'string' &&
      b.targetLabel.length > 0 &&
      Number.isInteger(b.targetIndex) &&
      b.targetIndex >= 0
  );
}

/**
 * Full action flow AFTER the verification gates passed (route side).
 * Outcomes: no_config | unknown_button | not_found | wrong_board |
 * not_assignee | already_done | ok | api_error — full contract in the tests.
 * @param {object} deps
 * @param {ReturnType<import('./storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('./monday-api.js').createMondayApi>} deps.api
 * @param {string} deps.itemId - regex-validated by the route
 * @param {string} deps.btnId - regex-validated by the route
 * @param {string|null} [deps.expectedPersonId] - D11: signed recipient person
 *   id; when set, the item must still be assigned to that person
 * @returns {Promise<{ outcome: string, button?: object }>}
 */
export async function performAction({ storage, api, itemId, btnId, expectedPersonId = null }) {
  const config = await storage.getConfig();
  const token = await storage.getOauthToken();

  if (!configIsComplete(config) || !token) {
    logError('confirm', 'missing or incomplete config/token', {
      hasConfig: Boolean(config),
      hasToken: Boolean(token),
    });
    return { outcome: 'no_config' };
  }

  const button = resolveButton(config, btnId);
  if (!button) {
    logError('confirm', 'unknown button id', { itemId, btnId });
    return { outcome: 'unknown_button' };
  }

  let item;
  try {
    item = await api.getItemState({
      token,
      itemId,
      statusColumnId: button.statusColumnId,
      peopleColumnId: config.peopleColumnId ?? null,
    });
  } catch (err) {
    logError('confirm', 'item query failed', describeApiError(err, itemId));
    return { outcome: 'api_error' };
  }

  if (!item.found) {
    logError('confirm', 'guard failed: not_found', { itemId });
    return { outcome: 'not_found' };
  }
  if (String(item.boardId) !== String(config.boardId)) {
    logError('confirm', 'guard failed: wrong_board', { itemId });
    return { outcome: 'wrong_board' };
  }

  // D11 — runs BEFORE already_done: a reassigned task refuses the click even
  // when no write would have happened.
  if (expectedPersonId !== null && expectedPersonId !== undefined && expectedPersonId !== '') {
    const assigneeIds = item.peoplePersonIds ?? [];
    if (!assigneeIds.includes(String(expectedPersonId))) {
      logError('confirm', 'guard failed: not_assignee', { itemId });
      return { outcome: 'not_assignee' };
    }
  }

  // Silent idempotency: the daily re-sent email lands here on repeat clicks.
  if (item.statusLabelId === button.targetIndex) {
    return { outcome: 'already_done', button };
  }

  try {
    await api.changeStatus({
      token,
      boardId: config.boardId,
      itemId,
      columnId: button.statusColumnId,
      toLabelId: button.targetIndex,
    });
  } catch (err) {
    logError('confirm', 'status mutation failed', describeApiError(err, itemId));
    return { outcome: 'api_error' };
  }

  const body = item.peopleText
    ? `סומן "${button.targetLabel}" במייל על ידי ${item.peopleText}`
    : `סומן "${button.targetLabel}" במייל`;
  try {
    await api.createUpdate({ token, itemId, body });
  } catch (err) {
    // The status change already succeeded — log, still success.
    logError('confirm', 'attribution update failed after status change', describeApiError(err, itemId));
  }

  return { outcome: 'ok', button };
}

function describeApiError(err, itemId) {
  if (err instanceof MondayApiError) {
    return { itemId, error: err.message, code: err.code, status: err.status, unauthorized: err.unauthorized };
  }
  return { itemId, error: String(err?.message ?? err) };
}
