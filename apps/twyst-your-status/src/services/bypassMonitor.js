/**
 * bypassMonitor — the settings screen's read side of the guard's audit
 * (round323). Fetches the bypass events for a column in a [from, to] window
 * from the guard server, and returns a normalized result the monitor renders.
 *
 * Every outcome is a returned STATUS, never a throw — the monitor shows a
 * friendly state, never a stack:
 *   'disabled'      — the dev-harness mock (VITE_MONDAY_MOCK): no backend →
 *                     the monitor is not shown. In a real build the guard is
 *                     same-origin, so this status does not occur.
 *   'not_activated' — the guard is not connected for this account (409).
 *   'forbidden'     — the actor is not a column owner (403). Should not happen
 *                     behind the owner gate, but handled rather than thrown.
 *   'ok'            — { events } (newest first, as the server returns them).
 *   'failed'        — network error or any other non-200 answer.
 *
 * @param {{ boardId, columnId, fromMs, toMs }} q
 * @param {{ guardUrl?, sessionTokenProvider?, fetchImpl? }} [deps]
 * @returns {Promise<{ status: 'disabled'|'not_activated'|'forbidden'|'ok'|'failed', events?: object[] }>}
 */

import logger from '../utils/logger.js';
import { resolveGuardBase } from './guardBase.js';
import { getSessionTokenViaSdk } from './sessionToken.js';

export async function fetchBypasses({ boardId, columnId, fromMs, toMs }, deps = {}) {
  const base = resolveGuardBase(deps.guardUrl);
  if (base === null) return { status: 'disabled' };

  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const getSessionToken = deps.sessionTokenProvider ?? getSessionTokenViaSdk;

  try {
    const sessionToken = await getSessionToken();
    const url = `${base}/api/guard/bypasses?boardId=${encodeURIComponent(boardId)}`
      + `&columnId=${encodeURIComponent(columnId)}&from=${fromMs}&to=${toMs}`;
    const response = await doFetch(url, { headers: { Authorization: sessionToken } });
    if (response.ok) {
      const body = await response.json();
      return { status: 'ok', events: Array.isArray(body?.events) ? body.events : [] };
    }
    if (response.status === 409) return { status: 'not_activated' };
    if (response.status === 403) return { status: 'forbidden' };
    logger.error('bypassMonitor', `bypasses query answered ${response.status}`, { boardId, columnId });
    return { status: 'failed' };
  } catch (err) {
    logger.error('bypassMonitor', 'bypasses query failed', err);
    return { status: 'failed' };
  }
}
