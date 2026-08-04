/**
 * guardStatus — reads the guard's activation/enrollment state for a column so
 * the settings screen can show "מחובר ✓" vs "דרוש אישור" (round326). Backed by
 * GET /api/guard/status?boardId&columnId (guard-routes.js), which returns
 * { activated, enrolled } — `activated` is account-level (an owner authorized
 * OAuth), `enrolled` is this column's webhook.
 *
 * Like guardEnroll: a returned shape for every outcome, never a throw — the
 * settings screen must render regardless. Unknown/unreachable collapses to
 * { activated: null, enrolled: null } so the caller shows a neutral state, not
 * a false "not connected".
 *
 * @param {{ boardId: string|number, columnId: string }} target
 * @param {{
 *   guardUrl?: string|null,               // default: '' (same-origin); null skips
 *   sessionTokenProvider?: () => Promise<string>,
 *   fetchImpl?: typeof fetch,
 * }} [deps]
 * @returns {Promise<{ activated: boolean|null, enrolled: boolean|null }>}
 */

import logger from '../utils/logger.js';
import { resolveGuardBase } from './guardBase.js';

const UNKNOWN = { activated: null, enrolled: null };

export async function getGuardStatus({ boardId, columnId }, deps = {}) {
  const base = resolveGuardBase(deps.guardUrl);
  if (base === null) return UNKNOWN; // dev-harness mock: no backend

  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const getSessionToken = deps.sessionTokenProvider ?? defaultSessionTokenProvider;

  try {
    const sessionToken = await getSessionToken();
    const query = `boardId=${encodeURIComponent(String(boardId))}&columnId=${encodeURIComponent(String(columnId))}`;
    const response = await doFetch(`${base}/api/guard/status?${query}`, {
      headers: { Authorization: sessionToken },
    });
    if (!response.ok) {
      logger.warn('guardStatus', `guard status answered ${response.status}`, { boardId, columnId });
      return UNKNOWN;
    }
    const body = await response.json();
    return { activated: body?.activated === true, enrolled: body?.enrolled === true };
  } catch (err) {
    // Best-effort: an unreachable status probe must not break the settings screen.
    logger.error('guardStatus', 'failed to read guard status', err);
    return UNKNOWN;
  }
}

async function defaultSessionTokenProvider() {
  const { default: mondaySdk } = await import('monday-sdk-js');
  const response = await mondaySdk().get('sessionToken');
  return response?.data;
}
