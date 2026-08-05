/**
 * guardAuthorize — opens the guard's one-time OAuth activation flow for the
 * signed-in owner (round325). The guard writes reverts AS the primary owner's
 * own identity, so that owner must authorize once (server: routes/oauth.js).
 * Until this button, activation had no in-app entry point — an owner had to
 * open `<BASE_URL>/oauth/start?st=<sessionToken>` by hand (GUARD-ACTIVATION.md).
 *
 * This mirrors guardEnroll: a returned STATUS for every outcome, never a throw.
 *
 * Statuses:
 *   'disabled' — the dev-harness mock (VITE_MONDAY_MOCK): no guard is reachable,
 *                so nothing is attempted. A real build is same-origin (the guard
 *                serves this SPA), so this does not occur there.
 *   'opened'   — the authorization tab was opened. Its own page reports success
 *                or failure (routes/oauth.js), so no further feedback is needed.
 *   'blocked'  — the browser refused the new tab (popup blocker); the caller
 *                should tell the user to allow pop-ups and retry.
 *   'failed'   — the sessionToken could not be obtained, or the opener threw.
 *
 * The base is same-origin ('') in a real build, so the opened URL is the
 * RELATIVE `/oauth/start?...`, which window.open resolves against THIS iframe's
 * origin (the guard) — the one origin that can serve it. That is why the opener
 * is window.open and NOT monday's openLinkInNewTab: the latter runs in the
 * monday parent and would resolve a relative path against monday.com.
 */

import logger from '../utils/logger.js';
import { resolveGuardBase } from './guardBase.js';
import { getSessionTokenViaSdk } from './sessionToken.js';

/**
 * @param {{
 *   guardUrl?: string|null,               // default: '' (same-origin); null skips
 *   sessionTokenProvider?: () => Promise<string>,  // default: monday.get('sessionToken')
 *   openImpl?: (url: string) => (Window|null),      // default: window.open(url,'_blank')
 * }} [deps]
 * @returns {Promise<'disabled'|'opened'|'blocked'|'failed'>}
 */
export async function startGuardAuthorization(deps = {}) {
  const base = resolveGuardBase(deps.guardUrl);
  if (base === null) return 'disabled';

  const getSessionToken = deps.sessionTokenProvider ?? getSessionTokenViaSdk;
  const openUrl = deps.openImpl ?? defaultOpen;

  try {
    const sessionToken = await getSessionToken();
    const url = `${base}/oauth/start?st=${encodeURIComponent(sessionToken)}`;
    const win = openUrl(url);
    if (!win) {
      logger.error('guardAuthorize', 'could not open the authorization tab (pop-up blocked?)', { base });
      return 'blocked';
    }
    return 'opened';
  } catch (err) {
    // Best-effort by contract: a failure to start authorization must surface as
    // a status, never a throw into the settings screen.
    logger.error('guardAuthorize', 'failed to start guard authorization', err);
    return 'failed';
  }
}

function defaultOpen(url) {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  // No 'noopener': the opened page is our own guard origin (we control it), and
  // omitting it lets us detect a popup-blocked null return.
  return window.open(url, '_blank');
}
