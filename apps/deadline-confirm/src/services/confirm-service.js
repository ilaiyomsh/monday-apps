// The /confirm decision core (spec §6 steps 5-9), kept pure/orchestrated for
// testability. The HTTP layer (routes/confirm.js) owns parsing, the secret
// gate, rate limiting, and page rendering; THIS module owns guards + the two
// mutations.

import { MondayApiError } from './monday-api.js';
import { logError } from '../helpers/logger.js';

/** YYYY-MM-DD + n days → YYYY-MM-DD (UTC date math; ISO strings compare lexically). */
function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Pure guard evaluation — spec §6.7, EXACT order:
 *   a. item exists            → not_found
 *   b. board match            → wrong_board
 *   c. expiry (when enabled)  → expired
 *   d. status == from-label   → wrong_status  (also the idempotency gate)
 *
 * Expiry is enabled iff config.expiryDateColumnId is set AND
 * config.expiryGraceDays > 0 (spec §4: 0 or null column disables). When
 * enabled, a click is valid while todayIso <= deadlineDate + graceDays.
 * An item with NO deadline value never expires.
 *
 * @param {import('./monday-api.js').ItemState} item
 * @param {{ boardId: string, fromIndex: number, toIndex: number, expiryDateColumnId?: string|null, expiryGraceDays?: number }} config
 * @param {string} todayIso - YYYY-MM-DD (UTC)
 * @returns {{ ok: true } | { ok: false, outcome: 'not_found'|'wrong_board'|'expired'|'wrong_status' }}
 */
export function evaluateGuards(item, config, todayIso) {
  if (!item.found) return { ok: false, outcome: 'not_found' };

  if (String(item.boardId) !== String(config.boardId)) {
    return { ok: false, outcome: 'wrong_board' };
  }

  const expiryEnabled = Boolean(config.expiryDateColumnId) && (config.expiryGraceDays ?? 0) > 0;
  if (expiryEnabled && item.deadlineDate) {
    const lastValidDay = addDays(item.deadlineDate, config.expiryGraceDays);
    if (todayIso > lastValidDay) return { ok: false, outcome: 'expired' };
  }

  // Strict compare — label id 0 is valid, null (status never set) never matches.
  if (item.statusLabelId !== config.fromIndex) {
    return { ok: false, outcome: 'wrong_status' };
  }

  return { ok: true };
}

function configIsComplete(config) {
  return Boolean(
    config &&
      typeof config.boardId === 'string' &&
      config.boardId.length > 0 &&
      typeof config.statusColumnId === 'string' &&
      config.statusColumnId.length > 0 &&
      Number.isInteger(config.fromIndex) &&
      Number.isInteger(config.toIndex)
  );
}

/**
 * Full confirm flow AFTER the secret gate and rate limit passed. See the
 * spec (§6 steps 5-9) and tests for the outcome contract.
 *
 * @param {object} deps
 * @param {ReturnType<import('./storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('./monday-api.js').createMondayApi>} deps.api
 * @param {string} deps.itemId - already regex-validated by the route
 * @param {string} [deps.todayIso]
 * @returns {Promise<{ outcome: string, toLabel?: string }>}
 */
export async function performConfirm({ storage, api, itemId, todayIso }) {
  const config = await storage.getConfig();
  const token = await storage.getOauthToken();

  if (!configIsComplete(config) || !token) {
    logError('confirm', 'missing or incomplete config/token', {
      hasConfig: Boolean(config),
      hasToken: Boolean(token),
    });
    return { outcome: 'no_config' };
  }

  const today = todayIso ?? new Date().toISOString().slice(0, 10);

  let item;
  try {
    item = await api.getItemState({
      token,
      itemId,
      statusColumnId: config.statusColumnId,
      peopleColumnId: config.peopleColumnId ?? null,
      expiryDateColumnId: config.expiryDateColumnId ?? null,
    });
  } catch (err) {
    logError('confirm', 'item query failed', describeApiError(err, itemId));
    return { outcome: 'api_error' };
  }

  const verdict = evaluateGuards(item, config, today);
  if (!verdict.ok) {
    logError('confirm', `guard failed: ${verdict.outcome}`, { itemId });
    return { outcome: verdict.outcome };
  }

  try {
    await api.changeStatus({
      token,
      boardId: config.boardId,
      itemId,
      columnId: config.statusColumnId,
      toLabelId: config.toIndex,
    });
  } catch (err) {
    logError('confirm', 'status mutation failed', describeApiError(err, itemId));
    return { outcome: 'api_error' };
  }

  const body = item.peopleText ? `אושר במייל על ידי ${item.peopleText}` : 'אושר במייל';
  try {
    await api.createUpdate({ token, itemId, body });
  } catch (err) {
    // Spec §6.9: the status change already succeeded — log, still success.
    logError('confirm', 'attribution update failed after status change', describeApiError(err, itemId));
  }

  return { outcome: 'ok', toLabel: config.toLabel };
}

function describeApiError(err, itemId) {
  if (err instanceof MondayApiError) {
    return { itemId, error: err.message, code: err.code, status: err.status, unauthorized: err.unauthorized };
  }
  return { itemId, error: String(err?.message ?? err) };
}
