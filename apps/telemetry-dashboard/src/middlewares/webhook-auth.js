// monday webhook JWT verification for POST /api/webhooks/*. Feature-level
// lifecycle webhooks are signed with the SOURCE app's Signing Secret and
// app-level webhooks with its Client Secret — either way this app receives
// events from MANY apps, so verification tries every configured secret and
// identifies the sender by which one verifies (req.webhook.appSlug).
// Fail-closed: no secrets configured (empty map) → every request is 401.
// PRIVACY: nothing from the token or payload is ever logged — only the route.

import jwt from 'jsonwebtoken';

/**
 * Verify a webhook JWT (with or without a `Bearer ` prefix) against a map of
 * appSlug → secret. Pure — never throws.
 * @param {string} rawToken
 * @param {Record<string, string>} secretsBySlug
 * @returns {{ appSlug: string, decoded: object } | null} first slug whose
 *   secret verifies the token, else null (also for empty token / empty map)
 */
export function verifyWithSecrets(rawToken, secretsBySlug) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
  if (!secretsBySlug || typeof secretsBySlug !== 'object') return null;
  const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
  for (const [appSlug, secret] of Object.entries(secretsBySlug)) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    try {
      const decoded = jwt.verify(token, secret);
      return { appSlug, decoded };
    } catch {
      // Wrong secret for this slug (or expired/garbled token) is the routine
      // path when probing a multi-app secret map — trying the next slug IS
      // the handling; a token no secret verifies falls through to null.
    }
  }
  return null;
}

/**
 * Express middleware gating a webhook route.
 * 401 { error: 'invalid_webhook_token' } for missing/unverifiable tokens;
 * success → req.webhook = { appSlug, decoded }, next().
 * @param {{ secretsBySlug: Record<string, string>, logger: object, tag?: string }} opts
 * @returns {import('express').RequestHandler}
 */
export function createWebhookAuthMiddleware({ secretsBySlug, logger, tag = 'webhook_auth' }) {
  return function requireWebhookAuth(req, res, next) {
    const raw = req.headers?.authorization ?? req.get?.('Authorization') ?? null;
    const webhook = raw === null ? null : verifyWithSecrets(raw, secretsBySlug);
    if (!webhook) {
      // Route path only — never the token, never the body (privacy rule).
      logger.warn('webhook_auth_failed', tag, { path: req.path });
      res.status(401).json({ error: 'invalid_webhook_token' });
      return;
    }
    req.webhook = webhook;
    next();
  };
}
