// Express app factory — pure wiring, dependency-injected. src/index.js is the
// only place that reads process.env and listens.
//
// Security model: GET /api/telemetry is gated by a monday sessionToken check
// (401 for missing/invalid). Real per-account telemetry is served ONLY through
// that authenticated endpoint. The built dashboard SPA is served statically at
// /; it carries NO Axiom credentials and NO real data.
//
// Webhooks: POST /api/webhooks/{lifecycle,app-events} carry their OWN JWT
// (verified against per-app Signing/Client Secret maps — fail-closed 401 when
// no secrets are configured) and are mounted BEFORE the static/SPA block and
// deliberately OUTSIDE the requireSession gate.
//
// OAuth (Change #143 continuation): GET /oauth/start + /oauth/callback are
// mounted BEFORE the static block and are also OUTSIDE requireSession — OAuth
// is its own auth (the code-exchange proves the caller controls the monday
// account performing the authorization). See routes/oauth.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSessionTokenMiddleware } from './middlewares/session-token.js';
import { createWebhookAuthMiddleware } from './middlewares/webhook-auth.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createOauthRouter } from './routes/oauth.js';
import { createLifecycleService } from './services/lifecycle-service.js';
import logger from './helpers/logger.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

/**
 * @param {object} deps
 * @param {ReturnType<import('./server/telemetry-service.js').createTelemetryService>} deps.telemetry
 * @param {{ clientSecret: string, allowedAccountIds: string[], version?: string }} deps.env
 * @param {{ service?: { handleFeatureEvent: Function, handleAppEvent: Function },
 *           signingSecrets?: Record<string, string>,
 *           clientSecrets?: Record<string, string> }} [deps.lifecycle]
 *   Webhook wiring (index.js always provides it). Omitted deps degrade to the
 *   inert-by-default posture: routes still mount, challenge echo works, auth
 *   is fail-closed 401, nothing is recorded.
 * @param {ReturnType<import('./services/storage.js').createStorageService>} [deps.storage]
 *   Owner-token storage for the OAuth flow (index.js always provides it).
 * @param {typeof fetch} [deps.fetchImpl] - injected for tests; the oauth
 *   router's exchange/identity calls only (defaults to global fetch).
 * @returns {import('express').Express}
 */
export function createApp({ telemetry, env, lifecycle = {}, storage, fetchImpl }) {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: env.version ?? 'dev', axiom: telemetry.enabled });
  });

  // --- OAuth app-identity token (own auth — NOT behind requireSession) ---
  app.use('/oauth', createOauthRouter({ env, storage, logger, fetchImpl }));

  // --- Webhooks (own JWT auth — NOT behind requireSession) ---------------
  const lifecycleService =
    lifecycle.service ?? createLifecycleService({ eventsBoard: null, logger });
  const lifecycleAuth = createWebhookAuthMiddleware({
    secretsBySlug: lifecycle.signingSecrets ?? {},
    logger,
    tag: 'webhooks',
  });
  const appEventsAuth = createWebhookAuthMiddleware({
    secretsBySlug: lifecycle.clientSecrets ?? {},
    logger,
    tag: 'webhooks',
  });
  app.use(
    '/api/webhooks',
    createWebhooksRouter({ lifecycleService, lifecycleAuth, appEventsAuth, logger })
  );

  // --- Authenticated telemetry endpoint ---------------------------------
  const requireSession = createSessionTokenMiddleware({
    clientSecret: env.clientSecret,
    allowedAccountIds: env.allowedAccountIds,
  });

  app.get('/api/telemetry', requireSession, async (req, res) => {
    try {
      const payload = await telemetry.getTelemetry(String(req.query.window ?? '7d'));
      res.json(payload);
    } catch (err) {
      logger.error('telemetry_endpoint_error', 'http', {
        path: req.path,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      res.status(502).json({ error: 'telemetry_unavailable' });
    }
  });

  // --- Static dashboard SPA (built by vite into public/) -----------------
  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
    // SPA fallback for any non-API GET.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });
  }

  // Terminal error handler — never leak a stack to the client.
  app.use((err, req, res, _next) => {
    logger.error('unhandled_middleware_error', 'http', {
      path: req.path,
      error: err instanceof Error ? err : new Error(String(err?.message ?? err)),
    });
    if (res.headersSent) return;
    res.status(err?.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'internal_error' });
  });

  return app;
}
