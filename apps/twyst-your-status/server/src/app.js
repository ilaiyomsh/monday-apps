/**
 * app — express factory, DI for tests (deadline-confirm's shape). All logic
 * lives in the injected collaborators; this file only mounts them.
 *
 * Same-origin unification (round324): this server ALSO serves the app's SPA
 * (the status-column surfaces — picker / settings / settings-full — built by
 * vite, copied into server/public by CI). The SPA and the /api/guard + /oauth
 * routes share one origin, so the client calls the API with relative paths —
 * no configured guard URL, no CORS. The status-column feature URLs in the
 * Developer Center load THIS service's URL, not the CDN.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { createGuardRouter } from './routes/guard-routes.js';
import { createOauthRouter } from './routes/oauth.js';

// Resolves to server/public whether the entrypoint is dist/index.js (prod
// bundle) or src/index.js (dev:server) — dirname/../public is the same for both.
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

/**
 * @param {{
 *   handleEvent: Function,
 *   tokenStore: object, enrollmentStore: object, api: object,
 *   rulesStore: object, bypassLog: object, oauthClient: object,
 *   env: object, logger: object, now?: () => number,
 *   publicDir?: string,   // override the SPA dir (tests); default server/public
 * }} deps
 */
export function createApp(deps) {
  const publicDir = deps.publicDir ?? PUBLIC_DIR;
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  app.use(createGuardRouter(deps));
  app.use(createOauthRouter(deps));

  // The app's pages (built by vite, copied into server/public by CI). Same
  // origin as the API above, so the client fetches /api/guard/* with no
  // configured URL and no CORS. This is a MULTI-PAGE build — each feature is
  // its own HTML entry (/picker/, /settings/, /settings-full/, /required-fields/,
  // and the root /) — so express.static's directory-index + trailing-slash
  // redirect resolves every configured feature URL directly; there is no
  // single-page catch-all (it would serve the wrong surface for an unknown
  // path). Absent in tests and local server runs → skipped entirely.
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

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
