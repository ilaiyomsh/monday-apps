// Express app factory — pure wiring, dependency-injected. src/index.js is the
// only place that reads process.env and listens.
//
// Security model: GET /api/telemetry is gated by a monday sessionToken check
// (401 for missing/invalid). Real per-account telemetry is served ONLY through
// that authenticated endpoint. The built dashboard SPA is served statically at
// /; it carries NO Axiom credentials and NO real data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSessionTokenMiddleware } from './middlewares/session-token.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

/**
 * @param {object} deps
 * @param {ReturnType<import('./server/telemetry-service.js').createTelemetryService>} deps.telemetry
 * @param {{ clientSecret: string, allowedAccountIds: string[], version?: string }} deps.env
 * @returns {import('express').Express}
 */
export function createApp({ telemetry, env }) {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: env.version ?? 'dev', axiom: telemetry.enabled });
  });

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
      console.error('telemetry endpoint error:', String(err?.message ?? err));
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
    console.error('unhandled middleware error:', req.path, String(err?.message ?? err));
    if (res.headersSent) return;
    res.status(err?.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'internal_error' });
  });

  return app;
}
