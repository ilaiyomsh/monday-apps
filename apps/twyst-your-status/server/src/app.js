/**
 * app — express factory, DI for tests (deadline-confirm's shape). All logic
 * lives in the injected collaborators; this file only mounts them.
 */

import express from 'express';
import { createGuardRouter } from './routes/guard-routes.js';
import { createOauthRouter } from './routes/oauth.js';

/**
 * @param {{
 *   handleEvent: Function,
 *   tokenStore: object, enrollmentStore: object, api: object,
 *   env: object, logger: object, fetchImpl?: typeof fetch,
 * }} deps
 */
export function createApp(deps) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));

  // The settings iframe lives on the monday CDN — a different origin.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  app.use(createGuardRouter(deps));
  app.use(createOauthRouter(deps));

  // Terminal error middleware (error-guard server contract): the 4-arg signature
  // is what makes express route synchronous throws + next(err) here instead of
  // crashing the response. Log (ships via the sink) then answer a bare 500 — never
  // leak an error body to the caller.
  app.use((err, req, res, _next) => {
    deps.logger?.error?.('unhandled request error', 'http', {
      method: req.method, path: req.path, error: String(err?.message ?? err),
    });
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
