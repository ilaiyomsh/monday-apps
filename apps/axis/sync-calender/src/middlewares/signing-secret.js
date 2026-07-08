// Verify inbound monday webhooks signed with the app's Signing Secret.
// Used by the lifecycle webhook endpoint (AppFeatureObject:create/delete/...).
// Attaches { payload } (decoded JWT body) to req.

import jwt from 'jsonwebtoken';
import logger from '../services/logger.js';

const TAG = 'signing_secret';

export function signingSecretMiddleware(req, res, next) {
  try {
    let token = req.headers.authorization || req.query.token || req.body?.token;
    if (!token) return res.status(401).json({ error: 'missing_signed_token' });
    if (typeof token === 'string' && token.startsWith('Bearer ')) token = token.slice(7);

    const decoded = jwt.verify(token, process.env.MONDAY_SIGNING_SECRET);
    req.payload = decoded;
    next();
  } catch (err) {
    logger.warn('signing secret verify failed', TAG, { error: err.message });
    return res.status(401).json({ error: 'invalid_signed_token' });
  }
}
