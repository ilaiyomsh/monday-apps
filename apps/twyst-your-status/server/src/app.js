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

  return app;
}
