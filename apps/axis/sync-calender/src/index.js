import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { getPort } from './helpers/environment.js';
import logger from './services/logger.js';
import { attachAxiomServerSink, flushAxiom } from './services/axiomServerSink.js';
import webhookRoutes from './routes/webhook.js';
import webhookMicrosoftRoutes from './routes/webhook-microsoft.js';
import schedulerRoutes from './routes/scheduler.js';
import oauthGoogleRoutes from './routes/oauth-google.js';
import oauthMicrosoftRoutes from './routes/oauth-microsoft.js';
import oauthMondayRoutes from './routes/oauth-monday.js';
import lifecycleRoutes from './routes/lifecycle.js';
import configsRoutes from './routes/configs.js';
import policyRoutes from './routes/policy.js';
import debugRoutes from './routes/debug.js';
import migrationRoutes from './routes/migration.js';

// Version layer (docs/monday-cicd-spec.md): package.json is the source of
// truth for the server's own version, logged at boot alongside the deployed
// commit SHA (CI sets BUILD_SHA; unset locally).
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Register the Axiom v2 sink on the logger. No-op unless AXIOM_TOKEN +
// AXIOM_DATASET are configured (local dev stays console-only).
attachAxiomServerSink(logger);

const app = express();
app.use(express.json());

// Terse access log: one INFO per request, emitted on `finish` so we capture
// the status + duration. Skips infra noise (Cloud Run health checks and the
// admin SPA's static asset bundle). No headers, no body, no auth — set
// LOG_LEVEL=DEBUG to get the verbose dump back if you need to inspect a
// request payload during a debug session.
const ACCESS_LOG_SKIP = (path) =>
  path === '/health' || path.startsWith('/admin') || path === '/favicon.ico';

// Webhook + sync routes log their own ops with full context, so the access
// log only fires for failures (5xx) and non-2xx infra responses worth
// noticing. 4xx skips intentionally — most are auth/validation rejections at
// boundary that the originating route already logs.
app.use((req, res, next) => {
  if (ACCESS_LOG_SKIP(req.path)) return next();
  const start = Date.now();
  res.on('finish', () => {
    if (res.statusCode < 500) return;
    logger.error('error', 'http', {
      stage: 'request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  // DEBUG-only verbose dump for forensic sessions.
  logger.debug('request', 'http', { method: req.method, path: req.path, query: req.query });
  next();
});

app.use(webhookRoutes);
app.use(webhookMicrosoftRoutes);
app.use(schedulerRoutes);
app.use(oauthGoogleRoutes);
app.use(oauthMicrosoftRoutes);
app.use(oauthMondayRoutes);
app.use(lifecycleRoutes);
app.use(configsRoutes);
app.use(policyRoutes);
app.use(debugRoutes);
app.use(migrationRoutes);

// Serve the Custom Object admin UI (React + Vite build output).
// Static assets come from public/admin; any unmatched /admin/* path falls
// back to index.html so deep-linked SPA routes resolve correctly.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.resolve(__dirname, '..', 'public', 'admin');
app.use('/admin', express.static(UI_DIR));
app.get(/^\/admin(\/.*)?$/, (_req, res) => res.sendFile(path.join(UI_DIR, 'index.html')));

app.get('/health', (req, res) => res.json({ ok: true, version: pkg.version }));

const port = getPort();
const server = app.listen(port, () => {
  logger.info('server_boot', 'server', { port, level: process.env.LOG_LEVEL || 'INFO' });
  logger.info(`${pkg.name} v${pkg.version} (sha ${process.env.BUILD_SHA || 'unknown'})`, 'server');
  // v2 boot health signal (D5): one INFO record, domainKind 'health', alwaysShip.
  logger.health('server_boot', { port, version: pkg.version });
});

// Graceful shutdown — drain the Axiom buffer before exit. Race the flush
// against a 2-second timeout so we never block container teardown if Axiom
// is unreachable. SIGTERM is sent by monday code on deploy; SIGINT covers
// local Ctrl-C in `npm run dev`.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server_shutdown', 'server', { signal });
  try {
    server.close();
  } catch { /* server may already be closing */ }
  await Promise.race([
    flushAxiom(),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
