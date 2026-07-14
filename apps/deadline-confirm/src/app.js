// Express app factory — pure wiring, dependency-injected so tests run the
// REAL request pipeline with fake storage/API. src/index.js is the only
// place that reads process.env and listens.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createConfirmRouter } from './routes/confirm.js';
import { createOauthRouter } from './routes/oauth.js';
import { createAdminRouter } from './routes/admin-api.js';
import { createSessionTokenMiddleware } from './middlewares/session-token.js';
import { logError } from './helpers/logger.js';

const ADMIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/admin');

/**
 * Assemble the Express app. See the stub JSDoc contract (git history).
 * @param {object} deps
 * @param {ReturnType<import('./services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('./services/monday-api.js').createMondayApi>} deps.api
 * @param {{ allow(ip: string): boolean }} deps.rateLimiter
 * @param {{ clientId: string, clientSecret: string, allowedAccountId: string, baseUrl: string, version?: string }} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string} [deps.todayIso]
 * @returns {import('express').Express}
 */
export function createApp({ storage, api, rateLimiter, env, fetchImpl, todayIso }) {
  const app = express();
  app.set('trust proxy', true); // monday code fronts the container — req.ip must be the client
  app.disable('x-powered-by');
  app.use(express.json());

  // Hot path first.
  app.use(createConfirmRouter({ storage, api, rateLimiter, todayIso }));

  app.use(createOauthRouter({ storage, api, env, fetchImpl }));

  const requireSession = createSessionTokenMiddleware({
    clientSecret: env.clientSecret,
    allowedAccountId: env.allowedAccountId,
  });
  app.use(createAdminRouter({ storage, api, env, requireSession }));

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
