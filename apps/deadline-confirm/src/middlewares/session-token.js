// monday sessionToken verification for /api/* (spec §9): JWT signed with the
// app's Client Secret, identity under payload.dat { account_id, user_id }
// (reference: sync-calender session-token.js). v3 multi-tenant: the account
// gate is an OPTIONAL allowlist — empty list admits every account (isolation
// is structural, via per-account storage namespacing); a non-empty list
// refuses accounts outside it.

import jwt from 'jsonwebtoken';

/**
 * Verify a monday sessionToken (with or without a `Bearer ` prefix).
 * Pure — never throws; used by the admin middleware and /oauth/start.
 * @param {string} rawToken
 * @param {string} clientSecret
 * @returns {{ accountId: string, userId: string } | null}
 */
export function verifySessionToken(rawToken, clientSecret) {
  try {
    if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
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
 * Create the Express middleware guarding every admin route.
 * 401 { error: 'invalid_session_token' } for missing/invalid tokens;
 * 403 { error: 'forbidden_account' } when a non-empty allowlist excludes the
 * token's account; success → req.session = { accountId, userId } (strings).
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
    if (allowedAccountIds.length > 0 && !allowedAccountIds.includes(session.accountId)) {
      res.status(403).json({ error: 'forbidden_account' });
      return;
    }
    req.session = session;
    next();
  };
}
