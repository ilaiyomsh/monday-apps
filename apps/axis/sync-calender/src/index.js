import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { EnvironmentVariablesManager } from '@mondaycom/apps-sdk';
import { getPort } from './helpers/environment.js';
import logger from './services/logger.js';
import { attachAxiomServerSink, flushAxiom } from './services/axiomServerSink.js';
import { createErrorMiddleware } from './middlewares/error-middleware.js';
import { installProcessGuards } from './process-guards.js';
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

// monday-code does NOT inject platform env vars into process.env — they live in
// a mounted secrets file the SDK reads (verified in apps-sdk source + live).
// updateProcessEnv:true copies them in; locally the manager reads process.env
// directly, so dotenv keeps working. envManager.get(key) is therefore the single
// resolver for both platform and local (deadline-confirm pattern).
const envManager = new EnvironmentVariablesManager({ updateProcessEnv: true });
const readEnv = (key) => {
  const v = envManager.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

// Version layer (docs/monday-cicd-spec.md): package.json is the source of
// truth for the server's own version, logged at boot alongside the deployed
// commit SHA (CI sets BUILD_SHA; unset locally). A corrupt package.json must
// never crash boot — fall back to a breadcrumb via the logger (which renders to
// console; the Axiom sink is not attached yet so this stays local by design).
let pkg = { name: 'sync-calender', version: '0.0.0' };
try {
  pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
} catch (e) {
  logger.error('boot_pkg_read_failed', 'server', { stage: 'boot', cause: e?.message || String(e), error: e });
}

// Register the Axiom v2 sink on the logger. Config is OPTS-INJECTED, resolved
// through EnvironmentVariablesManager (NOT process.env — monday-code injects
// platform secrets into the mounted file the manager reads). No-op unless
// AXIOM_TOKEN + AXIOM_DATASET + AXIOM_APP_NAME are all present (local dev without
// them stays console-only).
attachAxiomServerSink(logger, {
  token: readEnv('AXIOM_TOKEN'),
  dataset: readEnv('AXIOM_DATASET'),
  app: readEnv('AXIOM_APP_NAME') || 'calendar-sync',
  env: readEnv('NODE_ENV') || 'production',
  ver: pkg.version, // stamped as ev.ver — release correlation (Fable #6)
  shipLevel: readEnv('LOG_SHIP_LEVEL'),
});

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

// Terminal error middleware — LAST in the chain. Any error forwarded via
// next(err) (or thrown by a route that hands off to it) ships through the logger
// and returns a 500 JSON envelope instead of Express's default HTML page.
app.use(createErrorMiddleware(logger));

// Process crash nets — ship + (for uncaught) flush then exit(1). Installed before
// listen so a boot-time throw is still caught.
installProcessGuards({ logger, flush: flushAxiom });

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
  } catch (e) {
    // Non-fatal: the server may already be closing. Record a breadcrumb rather
    // than swallow it so an unexpected close failure is still visible.
    logger.warn('server_close_failed', 'server', { signal, cause: e?.message || String(e) });
  }
  await Promise.race([
    flushAxiom(),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
