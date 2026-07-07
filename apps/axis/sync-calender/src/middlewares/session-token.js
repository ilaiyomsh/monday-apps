// Verify `sessionToken` JWT from monday.get('sessionToken') in the iframe.
// Signed with the app's Client Secret (distinct from Signing Secret).
// On success attaches { userId, accountId } to req.session.

import jwt from 'jsonwebtoken';
import logger from '../services/logger.js';

const TAG = 'session_token';

export function sessionTokenMiddleware(req, res, next) {
  try {
    let token = req.headers.authorization || req.query.token;
    if (!token) return res.status(401).json({ error: 'missing_session_token' });
    if (token.startsWith('Bearer ')) token = token.slice(7);

    const decoded = jwt.verify(token, process.env.MONDAY_CLIENT_SECRET);
    // monday wraps identity in dat: { account_id, user_id } on sessionToken payloads.
    const accountId = decoded?.dat?.account_id ?? decoded?.accountId ?? decoded?.account_id;
    const userId = decoded?.dat?.user_id ?? decoded?.userId ?? decoded?.user_id;

    if (!accountId || !userId) {
      logger.warn('sessionToken decoded without identity', TAG, { keys: Object.keys(decoded || {}) });
      return res.status(401).json({ error: 'invalid_session_token' });
    }

    req.session = { accountId: String(accountId), userId: String(userId) };
    next();
  } catch (err) {
    logger.warn('sessionToken verify failed', TAG, { error: err.message });
    return res.status(401).json({ error: 'invalid_session_token' });
  }
}
