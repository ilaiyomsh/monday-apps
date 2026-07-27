import jwt from 'jsonwebtoken';
import logger from '../logger.js';

function bearer(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.startsWith('Bearer ') ? value.slice(7) : value;
}

export function verifySessionToken(rawToken, clientSecret) {
  try {
    const decoded = jwt.verify(bearer(rawToken), clientSecret);
    const accountId = decoded?.dat?.account_id;
    const userId = decoded?.dat?.user_id;
    if (accountId == null || userId == null) return null;
    return { accountId: String(accountId), userId: String(userId) };
  } catch (error) {
    logger.warn('invalid_session_token', 'auth', { error });
    return null;
  }
}

export function createSessionMiddleware({ clientSecret }) {
  return function requireSession(req, res, next) {
    const session = verifySessionToken(req.get('Authorization'), clientSecret);
    if (!session) {
      res.status(401).json({ error: 'invalid_session_token' });
      return;
    }
    req.session = session;
    next();
  };
}

export function verifyWebhookToken(rawToken, signingSecret, clientId) {
  try {
    const options = clientId ? { audience: clientId } : undefined;
    const decoded = jwt.verify(bearer(rawToken), signingSecret, options);
    const accountId = decoded?.accountId ?? decoded?.dat?.account_id;
    const userId = decoded?.userId ?? decoded?.dat?.user_id;
    if (accountId == null) return null;
    return {
      accountId: String(accountId),
      userId: userId == null ? null : String(userId),
      shortLivedToken: decoded?.shortLivedToken ?? null,
    };
  } catch (error) {
    logger.warn('invalid_webhook_token', 'auth', { error });
    return null;
  }
}
