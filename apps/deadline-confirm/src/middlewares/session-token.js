// monday sessionToken verification for /api/* (spec §9): JWT signed with the
// app's Client Secret, identity under payload.dat { account_id, user_id }
// (reference: sync-calender session-token.js). Single-tenant lockdown: the
// token's account must equal ALLOWED_ACCOUNT_ID or the request is refused.

import jwt from 'jsonwebtoken';

/**
 * Create the Express middleware guarding every admin route.
 * 401 { error: 'invalid_session_token' } for missing/invalid tokens;
 * 403 { error: 'forbidden_account' } for the wrong account;
 * success → req.session = { accountId, userId } (strings).
 * @param {{ clientSecret: string, allowedAccountId: string }} opts
 * @returns {import('express').RequestHandler}
 */
export function createSessionTokenMiddleware({ clientSecret, allowedAccountId }) {
  return function requireSession(req, res, next) {
    try {
      let token = req.headers?.authorization ?? req.get?.('Authorization') ?? null;
      if (!token) {
        res.status(401).json({ error: 'invalid_session_token' });
        return;
      }
      if (token.startsWith('Bearer ')) token = token.slice(7);

      const decoded = jwt.verify(token, clientSecret);
      const accountId = decoded?.dat?.account_id;
      const userId = decoded?.dat?.user_id;

      if (accountId == null || userId == null) {
        res.status(401).json({ error: 'invalid_session_token' });
        return;
      }
      if (String(accountId) !== String(allowedAccountId)) {
        res.status(403).json({ error: 'forbidden_account' });
        return;
      }

      req.session = { accountId: String(accountId), userId: String(userId) };
      next();
    } catch (_err) {
      // Verification failure is routine (expired/foreign token) — the 401
      // response IS the handling; no detail leaks.
      res.status(401).json({ error: 'invalid_session_token' });
    }
  };
}
