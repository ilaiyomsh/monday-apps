import express from 'express';
import { verifyWebhookToken } from '../auth/jwt.js';
import logger from '../logger.js';

export function createWebhookRouter({
  tokenProvider,
  enforcementService,
  env,
  schedule = queueMicrotask,
}) {
  const router = express.Router();

  router.post('/status-change', (req, res) => {
    if (req.body?.challenge) {
      res.json({ challenge: req.body.challenge });
      return;
    }
    const identity = verifyWebhookToken(req.get('Authorization'), env.signingSecret, env.clientId);
    if (!identity) {
      res.status(401).json({ error: 'invalid_webhook_token' });
      return;
    }

    res.json({ ok: true });
    const job = async () => {
      try {
        const token = identity.shortLivedToken
          ?? await tokenProvider.getFreshAccessToken(identity.accountId);
        if (!token) {
          logger.warn('oauth_connection_missing', 'webhook', { accountId: identity.accountId });
          return;
        }
        await enforcementService.handleStatusChange({
          accountId: identity.accountId,
          event: req.body,
          token,
        });
      } catch (error) {
        logger.error('status_change_enforcement_failed', 'webhook', {
          error,
          accountId: identity.accountId,
        });
      }
    };
    try {
      schedule(job);
    } catch (error) {
      logger.error('status_change_schedule_failed', 'webhook', {
        error,
        accountId: identity.accountId,
      });
    }
  });

  return router;
}
