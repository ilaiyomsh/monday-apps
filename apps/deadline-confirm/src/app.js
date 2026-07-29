// Express app factory — pure wiring, dependency-injected so tests run the
// REAL request pipeline with fake storage/API. src/index.js is the only
// place that reads process.env and listens.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAmpRouter } from './routes/amp.js';
import { createOauthRouter } from './routes/oauth.js';
import { createGoogleOauthRouter } from './routes/oauth-google.js';
import { createAdminRouter } from './routes/admin-api.js';
import { createSchedulerRouter } from './routes/scheduler.js';
import { createSessionTokenMiddleware } from './middlewares/session-token.js';
import { logError } from './helpers/logger.js';

const ADMIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/admin');

/**
 * Assemble the Express app. See the stub JSDoc contract (git history).
 * @param {object} deps
 * @param {ReturnType<import('./services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('./services/monday-api.js').createMondayApi>} deps.api
 * @param {{ perIp: { allow(key: string): boolean }, perAccount: { allow(key: string): boolean } }} deps.rateLimiters
 *   V6 §4 two-bucket limiting: perIp (bucket A) runs BEFORE any secret work,
 *   perAccount (bucket B, key `${accountId}:${ip}`) after verification.
 * @param {{ clientId: string, clientSecret: string, allowedAccountIds: string[], baseUrl: string, version?: string }} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string} [deps.todayIso]
 * @param {() => Date} [deps.now] - injectable clock (slot check on /amp/confirm)
 * @param {{ send(p: object): Promise<{ id: string }> }} [deps.emailSender] - digest sender seam (Gmail-send, future round); absent → /api/digest/send answers 409
 * @returns {import('express').Express}
 */
export function createApp({ storage, api, rateLimiters, env, fetchImpl, todayIso, emailSender, now }) {
  const app = express();
  app.set('trust proxy', true); // monday code fronts the container — req.ip must be the client
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(express.urlencoded({ extended: false })); // amp-form posts application/x-www-form-urlencoded

  // V6: the ONLY public write path — Gmail dynamic email bulk confirm.
  app.use(createAmpRouter({ storage, api, rateLimiters, allowedSenders: env.ampAllowedSenders ?? [], now }));

  app.use(createOauthRouter({ storage, api, env, fetchImpl }));

  // T9b: connect the tenant's Gmail sending mailbox. Same admit gate as the
  // monday flow (sessionToken + tenant roster) — see routes/oauth-google.js for
  // why the per-tenant sending identity retires D13's operator-only gate.
  app.use(createGoogleOauthRouter({ storage, env, fetchImpl }));

  // T10/T11: monday-code scheduler — no session auth (platform cron signing).
  app.use(createSchedulerRouter({ storage, api, env, emailSender, todayIso, now }));

  const requireSession = createSessionTokenMiddleware({
    clientSecret: env.clientSecret,
    allowedAccountIds: env.allowedAccountIds,
  });
  app.use(createAdminRouter({ storage, api, env, requireSession, emailSender, todayIso, now }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: env.version ?? 'dev' });
  });

  // Admin SPA (built by vite into public/admin). Missing in tests — skipped.
  if (fs.existsSync(ADMIN_DIR)) {
    app.use('/admin', express.static(ADMIN_DIR));
    app.get('/admin/*', (_req, res) => {
      res.sendFile(path.join(ADMIN_DIR, 'index.html'));
    });
  }
  app.get('/', (_req, res) => res.redirect('/admin/'));

  // Terminal error handler — express json parse errors etc. Never a stack to the client.
  app.use((err, req, res, _next) => {
    logError('app', 'unhandled middleware error', {
      path: req.path,
      error: String(err?.message ?? err),
    });
    if (res.headersSent) return;
    res.status(err?.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'internal_error' });
  });

  return app;
}
