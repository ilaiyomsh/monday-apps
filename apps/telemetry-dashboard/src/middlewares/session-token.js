// monday sessionToken verification for GET /api/telemetry. The token is a JWT
// signed with the app's Client Secret; the monday identity lives under
// payload.dat { account_id, user_id } (same shape used across the monorepo,
// see deadline-confirm / sync-calender session-token.js). Access control:
// a valid token is ALWAYS required (401 otherwise); an optional non-empty
// allowlist further restricts which accounts may read (403 otherwise).

import jwt from 'jsonwebtoken';

/**
 * Verify a monday sessionToken (with or without a `Bearer ` prefix).
 * Pure — never throws.
 * @param {string} rawToken
 * @param {string} clientSecret
 * @returns {{ accountId: string, userId: string } | null}
 */
export function verifySessionToken(rawToken, clientSecret) {
  try {
    if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
    if (typeof clientSecret !== 'string' || clientSecret.length === 0) return null;
    const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
    const decoded = jwt.verify(token, clientSecret);
    const accountId = decoded?.dat?.account_id;
    const userId = decoded?.dat?.user_id;
    if (accountId == null || userId == null) return null;
    return { accountId: String(accountId), userId: String(userId) };
  } catch {
    // Verification failure is routine (expired/foreign token) — null IS the handling.
    return null;
  }
}

/**
 * Express middleware gating the telemetry endpoint.
 * 401 { error: 'invalid_session_token' } for missing/invalid tokens;
 * 403 { error: 'forbidden_account' } when a non-empty allowlist excludes the
 * token's account; success → req.session = { accountId, userId }.
 * @param {{ clientSecret: string, allowedAccountIds: string[] }} opts
 * @returns {import('express').RequestHandler}
 */
export function createSessionTokenMiddleware({ clientSecret, allowedAccountIds }) {
  const allow = Array.isArray(allowedAccountIds) ? allowedAccountIds : [];
  return function requireSession(req, res, next) {
    const raw = req.headers?.authorization ?? req.get?.('Authorization') ?? null;
    const session = raw === null ? null : verifySessionToken(raw, clientSecret);
    if (!session) {
      res.status(401).json({ error: 'invalid_session_token' });
      return;
    }
    if (allow.length > 0 && !allow.includes(session.accountId)) {
      res.status(403).json({ error: 'forbidden_account' });
      return;
    }
    req.session = session;
    next();
  };
}
