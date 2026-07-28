// monday sessionToken verification for /api/* (spec §9): JWT signed with the
// app's Client Secret, identity under payload.dat { account_id, user_id }
// (reference: sync-calender session-token.js). V6 D15: allowedAccountIds is
// the tenant roster — empty = default-deny (nobody admitted), matching
// AMP_ALLOWED_SENDERS. Isolation remains structural via per-account storage
// namespacing; the list is also the scheduler/send roster.

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
