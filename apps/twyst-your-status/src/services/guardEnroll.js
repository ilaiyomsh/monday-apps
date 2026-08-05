/**
 * guardEnroll — best-effort enrollment of a governed column with the guard
 * server (round322). Called after a SUCCESSFUL settings save: the save is the
 * product action and never FAILS because of the guard. Every outcome is a
 * returned STATUS, never a throw.
 *
 * round329 — the caller AWAITS this; it used to be fire-and-forget, and had to
 * stop being one. The first thing this does is ask monday for a sessionToken — a
 * postMessage round trip to the parent window — while the caller closes the
 * settings surface right after the save. Closing destroys the iframe, so a
 * forgotten call was killed before the POST was ever sent: every save claimed
 * success and no column was ever enrolled. Two consequences, both load-bearing:
 *   - the wait is BOUNDED (timeoutMs) — an unreachable guard must not trap the
 *     owner in a settings screen that will not close;
 *   - the request is `keepalive`, so one already in flight survives a teardown
 *     that races it anyway.
 *
 * Statuses:
 *   'disabled'      — the dev-harness mock (VITE_MONDAY_MOCK): no backend is
 *                     reachable, so nothing was attempted. In a real build the
 *                     guard is same-origin (this SPA is served BY it), so this
 *                     status does not occur.
 *   'enrolled'      — the guard confirmed the column's webhook (created now
 *                     or already present — the endpoint is idempotent).
 *   'not_activated' — the guard answered 409: the account has not completed
 *                     the one-time OAuth activation. Logged as a warning with
 *                     the activation pointer (GUARD-ACTIVATION.md).
 *   'not_board_owner' — the guard answered 403: creating a board webhook is a
 *                     BOARD owner's right, and a column owner is not necessarily
 *                     one. Its own status (round330) because the manual register
 *                     button must say so — retrying cannot fix a permission.
 *   'failed'        — network error, timeout, or any other non-200 answer. Logged.
 */

import logger from '../utils/logger.js';
import { resolveGuardBase } from './guardBase.js';

/** Long enough for a cold monday-code container, short enough to close a modal on. */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * @param {{ boardId: string|number, columnId: string }} target
 * @param {{
 *   guardUrl?: string|null,               // default: '' (same-origin); null skips
 *   sessionTokenProvider?: () => Promise<string>,  // default: monday.get('sessionToken')
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,                   // default 8s — the caller awaits this
 * }} [deps]
 * @returns {Promise<'disabled'|'enrolled'|'not_activated'|'not_board_owner'|'failed'>}
 */
export async function enrollColumnGuard({ boardId, columnId }, deps = {}) {
  const base = resolveGuardBase(deps.guardUrl);
  if (base === null) return 'disabled';

  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const getSessionToken = deps.sessionTokenProvider ?? defaultSessionTokenProvider;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The caller waits for this before closing the settings surface, so the wait
  // is capped: a guard that never answers costs one bounded pause, not a modal
  // the owner cannot dismiss.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const sessionToken = await getSessionToken();
    const response = await doFetch(`${base}/api/guard/enroll`, {
      method: 'POST',
      headers: {
        Authorization: sessionToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ boardId: String(boardId), columnId: String(columnId) }),
      signal: controller.signal,
      // The settings surface may still be torn down while this is in flight
      // (monday destroys the iframe on close). keepalive lets the browser finish
      // the request anyway — the body is a few dozen bytes, far under the cap.
      keepalive: true,
    });
    if (response.ok) return 'enrolled';
    if (response.status === 409) {
      logger.warn('guardEnroll', 'guard not activated for this account — column saved unguarded (see docs/GUARD-ACTIVATION.md)', { boardId, columnId });
      return 'not_activated';
    }
    if (response.status === 403) {
      logger.warn('guardEnroll', 'not a board owner — a board webhook cannot be created by this user', { boardId, columnId });
      return 'not_board_owner';
    }
    logger.error('guardEnroll', `guard enrollment answered ${response.status}`, { boardId, columnId });
    return 'failed';
  } catch (err) {
    // Best-effort by contract: the settings save already succeeded, and the
    // guard being unreachable must not turn that into a user-facing failure.
    // A timeout is reported as such — "no answer in 8s" and "network refused"
    // are different operational stories (the AbortError itself carries neither).
    if (timedOut) {
      logger.error('guardEnroll', `guard enrollment timed out after ${timeoutMs}ms`, { boardId, columnId });
      return 'failed';
    }
    logger.error('guardEnroll', 'guard enrollment failed', err);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

async function defaultSessionTokenProvider() {
  // Dynamic import keeps this module inert for suites that stub the SDK — the
  // dev-harness alias (VITE_MONDAY_MOCK) resolves here exactly as it does in
  // mondayService.
  const { default: mondaySdk } = await import('monday-sdk-js');
  const response = await mondaySdk().get('sessionToken');
  return response?.data;
}
