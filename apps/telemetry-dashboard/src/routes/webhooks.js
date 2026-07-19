// Webhook routes — POST /lifecycle (feature-level lifecycle events) and
// POST /app-events (app-level install/subscription events). Mounted at
// /api/webhooks by app.js, BEFORE requireSession — webhooks carry their own
// JWT, verified by the injected auth middlewares (fail-closed: no secrets
// configured → 401).
//
// Response policy (fail-soft, retry-storm safe):
//   { challenge } handshake → 200 echo BEFORE auth (the only unauthenticated path);
//   missing/invalid JWT     → 401 (injected auth middleware);
//   authenticated           → 202 { ok: true } IMMEDIATELY, then processing
//                             continues off-request via setImmediate — monday
//                             never waits on board IO and never sees a 5xx.
//
// All collaborators are injected; the only app import is asyncHandler.

import express from 'express';
import { asyncHandler } from '../helpers/asyncHandler.js';

const TAG = 'webhooks';

/**
 * @param {object} deps
 * @param {{ handleFeatureEvent: Function, handleAppEvent: Function }} deps.lifecycleService
 * @param {import('express').RequestHandler} deps.lifecycleAuth - verifies the
 *   Signing-Secret JWT of feature-level events; sets req.webhook = { appSlug, decoded }
 * @param {import('express').RequestHandler} deps.appEventsAuth - verifies the
 *   Client-Secret JWT of app-level events; sets req.webhook = { appSlug, decoded }
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @returns {import('express').Router}
 */
export function createWebhooksRouter({ lifecycleService, lifecycleAuth, appEventsAuth, logger }) {
  const router = express.Router();

  // Developer Center sends a { challenge } handshake when a webhook URL is
  // registered. It must be echoed back BEFORE auth.
  const challengeEcho = (req, res, next) => {
    if (req.body && typeof req.body.challenge === 'string') {
      res.status(200).json({ challenge: req.body.challenge });
      return;
    }
    next();
  };

  const dispatch = (handlerName) =>
    asyncHandler(async (req, res) => {
      const eventId = req.get('X-Apps-Event-Id') || null;
      const appSlug = req.webhook?.appSlug ?? '';
      const body = req.body;
      // Ack first — monday must never wait on monday/board IO, and must never
      // receive a retry-storm-inducing error after auth.
      res.status(202).json({ ok: true });
      setImmediate(() => {
        Promise.resolve(lifecycleService[handlerName]({ appSlug, body, eventId })).catch((err) => {
          // The service is fail-soft by contract; this is the last-resort
          // funnel so a rejection can never become an unhandledRejection.
          logger.error('webhook_dispatch_failed', TAG, {
            handler: handlerName,
            app: appSlug,
            eventId,
            error: String(err?.message ?? err),
          });
        });
      });
    });

  router.post('/lifecycle', challengeEcho, lifecycleAuth, dispatch('handleFeatureEvent'));
  router.post('/app-events', challengeEcho, appEventsAuth, dispatch('handleAppEvent'));

  return router;
}
