// monday sessionToken verification for GET /api/telemetry. The token is a JWT
// signed with the app's Client Secret; the monday identity lives under
// payload.dat { account_id, user_id } (same shape used across the monorepo,
// see deadline-confirm / sync-calender session-token.js). Access control:
// a valid token is ALWAYS required (401 otherwise); an optional non-empty
// allowlist further restricts which accounts may read (403 otherwise).

import jwt from 'jsonwebtoken';
import { createLogThrottle } from '../helpers/log-throttle.js';

// Emission budget for the pre-auth rejection WARN (audit finding 8). session_token_rejected
// is emitted BEFORE any credential is verified — any caller reaches it with no token at all
// — and WARN ships to Axiom under the default policy, so an unbounded WARN here let an
// external caller drive our ingest volume: 10k unauthenticated requests were 10k Axiom
// writes. Keyed by REASON, not by IP, so a distributed prober cannot buy extra budget by
// spreading source addresses. Suppressed occurrences are counted and reported on the next
// emitted line, so the cap never hides its own truncation.
const AUTH_WARN_LIMIT = 10;
const AUTH_WARN_WINDOW_MS = 60_000;

/**
 * Verify a monday sessionToken (with or without a `Bearer ` prefix).
 * Never throws — an invalid/expired token resolves to null (the caller turns that into a
 * 401 and logs the actionable WARN). An optional logger records the raw verify failure at
 * DEBUG (funnel-level, off in prod) so the catch is never silent; no token bytes are logged.
 * @param {string} rawToken
 * @param {string} clientSecret
 * @param {{ debug?: Function }} [logger]
 * @returns {{ accountId: string, userId: string } | null}
 */
export function verifySessionToken(rawToken, clientSecret, logger) {
  try {
    if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
    if (typeof clientSecret !== 'string' || clientSecret.length === 0) return null;
    const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
    const decoded = jwt.verify(token, clientSecret);
    const accountId = decoded?.dat?.account_id;
    const userId = decoded?.dat?.user_id;
    if (accountId == null || userId == null) return null;
    return { accountId: String(accountId), userId: String(userId) };
  } catch (err) {
    // Verification failure is routine (expired/foreign token) — null IS the handling for
    // the caller. Record the funnel event at DEBUG (reason only, never the token) so the
    // catch is not silent; the middleware ships the WARN summary.
    logger?.debug?.('session_token_verify_failed', 'auth', { reason: err?.name ?? 'verify_error' });
    return null;
  }
}

/**
 * Express middleware gating the telemetry endpoint.
 * 401 { error: 'invalid_session_token' } for missing/invalid tokens;
 * 403 { error: 'forbidden_account' } when a non-empty allowlist excludes the
 * token's account; success → req.session = { accountId, userId }.
 * Auth denials are logged at WARN (observability gap #6) — reason + account id only,
 * NEVER any token contents — so a spike of rejected reads is visible in the sink. The
 * pre-auth WARN is budget-bounded (finding 8); the 401 never is.
 * @param {{ clientSecret: string, allowedAccountIds: string[], logger?: { warn: Function },
 *           throttle?: { check(key: string): { suppressed: number } | null } }} opts
 * @returns {import('express').RequestHandler}
 */
export function createSessionTokenMiddleware({ clientSecret, allowedAccountIds, logger, throttle }) {
  const allow = Array.isArray(allowedAccountIds) ? allowedAccountIds : [];
  // Bounded by default — never opt-in. An injected throttle is the test seam.
  const warnBudget =
    throttle ?? createLogThrottle({ limit: AUTH_WARN_LIMIT, windowMs: AUTH_WARN_WINDOW_MS });
  return function requireSession(req, res, next) {
    const raw = req.headers?.authorization ?? req.get?.('Authorization') ?? null;
    const session = raw === null ? null : verifySessionToken(raw, clientSecret, logger);
    if (!session) {
      // reason distinguishes a probe with no header from a present-but-bad token; no token bytes.
      const reason = raw === null ? 'missing' : 'invalid';
      const verdict = warnBudget.check(reason);
      if (verdict !== null) {
        // `suppressed` appears only when occurrences were actually dropped, so the ordinary
        // line keeps its existing shape and stays cheap to query.
        logger?.warn(
          'session_token_rejected',
          'auth',
          verdict.suppressed > 0 ? { reason, suppressed: verdict.suppressed } : { reason }
        );
      }
      res.status(401).json({ error: 'invalid_session_token' });
      return;
    }
    if (allow.length > 0 && !allow.includes(session.accountId)) {
      logger?.warn('session_forbidden_account', 'auth', { acc: session.accountId });
      res.status(403).json({ error: 'forbidden_account' });
      return;
    }
    req.session = session;
    next();
  };
}
