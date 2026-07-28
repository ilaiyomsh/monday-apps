// monday sessionToken verification for /api/* (spec §9): JWT signed with the
// app's Client Secret, identity under payload.dat { account_id, user_id }
// (reference: sync-calender session-token.js). V6 D15: allowedAccountIds is
// the tenant roster — empty = default-deny (nobody admitted), matching
// AMP_ALLOWED_SENDERS. Isolation remains structural via per-account storage
// namespacing; the list is also the scheduler/send roster.

import jwt from 'jsonwebtoken';
import logger from '../helpers/logger.js';
import { createLogThrottle } from '../helpers/log-throttle.js';

// Emission budget for the rejection WARN (audit finding 8). This log line is reachable
// WITHOUT credentials — /oauth/start takes ?st=<sessionToken> — and WARN ships to Axiom
// under the default policy, so an unbounded WARN here let an external caller drive our
// ingest volume: 10k unauthenticated requests were 10k Axiom writes. Keyed by REASON, not
// by IP, so a distributed prober cannot buy extra budget by spreading its source
// addresses. Suppressed occurrences are counted and reported on the next emitted line,
// so the cap never hides its own truncation.
const AUTH_WARN_LIMIT = 10;
const AUTH_WARN_WINDOW_MS = 60_000;
const authWarnThrottle = createLogThrottle({
  limit: AUTH_WARN_LIMIT,
  windowMs: AUTH_WARN_WINDOW_MS,
});

/**
 * Verify a monday sessionToken (with or without a `Bearer ` prefix).
 * Never throws; used by the admin middleware and /oauth/start. A verification
 * failure returns null (that IS the 401/403 handling) and is logged at WARN
 * with the failure REASON only (err.name — e.g. TokenExpiredError /
 * JsonWebTokenError), NEVER the token or its contents, so forged/tampered
 * admin-token attempts are visible in Axiom (WARN ships by default).
 *
 * The WARN is budget-bounded; the REJECTION never is. Every invalid token still
 * returns null on every call — throttling touches telemetry volume only, never the
 * security decision.
 * @param {string} rawToken
 * @param {string} clientSecret
 * @param {{ check(key: string): { suppressed: number } | null }} [throttle] - test seam
 * @returns {{ accountId: string, userId: string } | null}
 */
export function verifySessionToken(rawToken, clientSecret, throttle = authWarnThrottle) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
  const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
  let decoded;
  try {
    decoded = jwt.verify(token, clientSecret);
  } catch (err) {
    // Routine (expired/foreign token) but security-relevant: emit the reason only.
    const reason = String(err?.name ?? 'verify_error');
    const verdict = throttle.check(reason);
    if (verdict !== null) {
      logger.logWarn(
        'auth',
        'session token verification failed',
        // `suppressed` appears only when occurrences were actually dropped, so the
        // ordinary line keeps its existing shape and stays cheap to query.
        verdict.suppressed > 0 ? { reason, suppressed: verdict.suppressed } : { reason }
      );
    }
    return null;
  }
  const accountId = decoded?.dat?.account_id;
  const userId = decoded?.dat?.user_id;
  if (accountId == null || userId == null) return null;
  return { accountId: String(accountId), userId: String(userId) };
}

/**
 * Create the Express middleware guarding every admin route.
 * 401 { error: 'invalid_session_token' } for missing/invalid tokens;
 * 403 { error: 'forbidden_account' } when the account is not on the roster
 * (including when the roster is empty — D15 default-deny);
 * success → req.session = { accountId, userId } (strings).
 * @param {{ clientSecret: string, allowedAccountIds: string[] }} opts
 * @returns {import('express').RequestHandler}
 */
export function createSessionTokenMiddleware({ clientSecret, allowedAccountIds }) {
  return function requireSession(req, res, next) {
    const raw = req.headers?.authorization ?? req.get?.('Authorization') ?? null;
    const session = raw === null ? null : verifySessionToken(raw, clientSecret);
    if (!session) {
      res.status(401).json({ error: 'invalid_session_token' });
      return;
    }
    if (!allowedAccountIds.includes(session.accountId)) {
      res.status(403).json({ error: 'forbidden_account' });
      return;
    }
    req.session = session;
    next();
  };
}
