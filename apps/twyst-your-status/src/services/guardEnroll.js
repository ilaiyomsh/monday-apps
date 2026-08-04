/**
 * guardEnroll — best-effort enrollment of a governed column with the guard
 * server (round322). Called fire-and-forget after a SUCCESSFUL settings save:
 * the save is the product action and never waits on — or fails because of —
 * the guard. Every outcome is a returned STATUS, never a throw.
 *
 * Statuses:
 *   'disabled'      — no guard URL configured for this build (local dev,
 *                     pre-activation deployments). Nothing was attempted.
 *   'enrolled'      — the guard confirmed the column's webhook (created now
 *                     or already present — the endpoint is idempotent).
 *   'not_activated' — the guard answered 409: the account has not completed
 *                     the one-time OAuth activation. Logged as a warning with
 *                     the activation pointer (GUARD-ACTIVATION.md).
 *   'failed'        — network error or any other non-200 answer. Logged.
 *
 * @param {{ boardId: string|number, columnId: string }} target
 * @param {{
 *   guardUrl?: string,                    // default: import.meta.env.VITE_TWYST_GUARD_URL
 *   sessionTokenProvider?: () => Promise<string>,  // default: monday.get('sessionToken')
 *   fetchImpl?: typeof fetch,
 * }} [deps]
 * @returns {Promise<'disabled'|'enrolled'|'not_activated'|'failed'>}
 */

import logger from '../utils/logger.js';

export async function enrollColumnGuard({ boardId, columnId }, deps = {}) {
  const guardUrl = (deps.guardUrl ?? import.meta.env.VITE_TWYST_GUARD_URL ?? '').replace(/\/$/, '');
  if (guardUrl === '') return 'disabled';

  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const getSessionToken = deps.sessionTokenProvider ?? defaultSessionTokenProvider;

  try {
    const sessionToken = await getSessionToken();
    const response = await doFetch(`${guardUrl}/api/guard/enroll`, {
      method: 'POST',
      headers: {
        Authorization: sessionToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ boardId: String(boardId), columnId: String(columnId) }),
    });
    if (response.ok) return 'enrolled';
    if (response.status === 409) {
      logger.warn('guardEnroll', 'guard not activated for this account — column saved unguarded (see docs/GUARD-ACTIVATION.md)', { boardId, columnId });
      return 'not_activated';
    }
    logger.error('guardEnroll', `guard enrollment answered ${response.status}`, { boardId, columnId });
    return 'failed';
  } catch (err) {
    // Best-effort by contract: the settings save already succeeded, and the
    // guard being unreachable must not turn that into a user-facing failure.
    logger.error('guardEnroll', 'guard enrollment failed', err);
    return 'failed';
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
