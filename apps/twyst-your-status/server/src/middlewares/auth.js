/**
 * auth — the two JWT verifications the guard's HTTP surface needs.
 *
 * verifyWebhookJwt(rawAuthorization, signingSecret) — board webhooks created via
 *   create_webhook deliver with an Authorization JWT signed by the app's SIGNING
 *   secret. Fail-closed: no secret configured or bad signature → null. The
 *   ALLOW_UNSIGNED_WEBHOOKS env escape lives in the ROUTE (visible in wiring),
 *   not here — this function never guesses.
 *
 * verifySessionToken(rawToken, clientSecret) — monday sessionToken (client
 *   secret) from the settings iframe; returns { accountId, userId } or null.
 *   Accepts both payload shapes observed on the platform: claims at the root
 *   and claims under `dat` (telemetry-dashboard's middleware, same contract).
 *
 * Verify failures are logged at DEBUG (telemetry-dashboard's convention): they
 * are an expected, attacker-controllable condition — the 401 is the signal,
 * and per-attempt ERROR records would let a retry storm flood the log.
 */

import jwt from 'jsonwebtoken';

const stripBearer = (raw) => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const trimmed = raw.trim();
  return trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed;
};

/** @returns {object|null} decoded claims, or null when unverifiable */
export function verifyWebhookJwt(rawAuthorization, signingSecret, logger) {
  const token = stripBearer(rawAuthorization);
  if (!token || !signingSecret) return null;
  try {
    return jwt.verify(token, signingSecret);
  } catch (err) {
    logger?.debug?.('webhook_jwt_verify_failed', 'auth', { reason: err?.name ?? 'verify_error' });
    return null; // fail-closed; the route answers 401
  }
}

/** @returns {{ accountId: string, userId: string, slug: string|null }|null} */
export function verifySessionToken(rawToken, clientSecret, logger) {
  const token = stripBearer(rawToken);
  if (!token || !clientSecret) return null;
  try {
    const decoded = jwt.verify(token, clientSecret);
    const claims = decoded?.dat && typeof decoded.dat === 'object' ? decoded.dat : decoded;
    const accountId = claims?.account_id ?? claims?.accountId;
    const userId = claims?.user_id ?? claims?.userId;
    if (accountId == null || userId == null) return null;
    // round328 — the account slug rides the sessionToken; the OAuth start uses it
    // to PIN the authorize page to this account (a multi-account browser session
    // otherwise consents on whichever account is active). Signed by monday, but
    // it becomes a hostname — accept only a safe slug shape.
    const rawSlug = claims?.slug;
    const slug = typeof rawSlug === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(rawSlug) ? rawSlug : null;
    return { accountId: String(accountId), userId: String(userId), slug };
  } catch (err) {
    logger?.debug?.('session_token_verify_failed', 'auth', { reason: err?.name ?? 'verify_error' });
    return null; // fail-closed; the route answers 401
  }
}
