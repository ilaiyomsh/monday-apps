// Server entry — reads env, wires real dependencies, listens. Everything
// testable lives behind createApp (src/app.js).

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { EnvironmentVariablesManager } from '@mondaycom/apps-sdk';
// monday-code does NOT inject platform env vars into process.env — they live
// in a mounted secrets file the SDK reads (verified in apps-sdk source +
// live: containers saw empty MONDAY_CLIENT_ID/BASE_URL without this).
// updateProcessEnv copies them in; locally the manager is a no-op over
// process.env, so dotenv keeps working.
const envManager = new EnvironmentVariablesManager({ updateProcessEnv: true });
import { createApp } from './app.js';
import { createAppStorage } from './services/storage.js';
import { createMondayApi } from './services/monday-api.js';
import { createEmailSender } from './services/email-sender.js';
import { createRateLimiter } from './helpers/rate-limit.js';
import { createSecureStorageBackend } from './storage/secure-storage-backend.js';
import { createMemoryBackend } from './storage/memory-backend.js';
import { getEnv } from './helpers/environment.js';
import logger, { logInfo, health } from './helpers/logger.js';
import { attachAxiomServerSink, flushAxiom } from './helpers/axiomServerSink.js';
import {
  installProcessGuards,
  makeServerErrorHandler,
  readPackageVersion,
  safeBootInit,
} from './helpers/process-guards.js';

const env = getEnv();

// App version for boot health (read via fs so it works on plain node 20 without
// JSON import attributes). Never fatal, never a silent empty catch — the guard
// leaves a console breadcrumb if package.json becomes unreadable/corrupt.
const APP_VERSION = readPackageVersion({
  readFileSync,
  url: new URL('../package.json', import.meta.url),
});

// --- Axiom logging v2: PII scrub + remote sink (gated on AXIOM_* secrets) ---
// Strip the /confirm client ip from attempt records before they reach any sink
// (the local stdout line keeps it; the wire never does).
logger.setBeforeSend((record) => {
  if (record?.tag === 'attempt' && record.context && 'ip' in record.context) {
    record.context = { ...record.context, ip: undefined };
  }
  return record;
});

// Read the Axiom config through the SDK manager (NOT process.env) — monday-code
// injects platform secrets into the mounted file the manager reads.
const readEnv = (key) => {
  const v = envManager.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};
attachAxiomServerSink(logger, {
  token: readEnv('AXIOM_TOKEN'),
  dataset: readEnv('AXIOM_DATASET'),
  app: readEnv('AXIOM_APP_NAME'),
  env: readEnv('NODE_ENV') || 'production',
  ver: APP_VERSION, // stamped as ev.ver — release correlation (Fable #6)
  shipLevel: readEnv('LOG_SHIP_LEVEL'),
});

// Module-scope dependency init is guarded: a SecureStorage constructor throw
// (e.g. misconfigured platform secrets) would otherwise kill the process before
// app.listen or the Axiom sink can surface anything. safeBootInit ships the
// failure, races the flush, exits 1, and re-throws (no half-built server).
const backend = safeBootInit(
  () => (env.useLocalStorage ? createMemoryBackend() : createSecureStorageBackend()),
  'storage backend init',
  logger,
  { flush: flushAxiom },
);
const storage = createAppStorage({ backend });
const api = createMondayApi();
const rateLimiter = createRateLimiter();

// v4 digest sender — wired only when BOTH env values exist; otherwise the
// digest send endpoint answers 409 email_not_configured (admin shows a hint).
const emailSender =
  env.resendApiKey && env.digestFrom
    ? createEmailSender({ apiKey: env.resendApiKey, from: env.digestFrom })
    : undefined;

const app = createApp({ storage, api, rateLimiter, env, emailSender });

const server = app.listen(env.port, () => {
  logInfo('server', 'deadline-confirm listening', { port: env.port, localStorage: env.useLocalStorage });
  // Boot health (D5): one INFO health record at the init-done point.
  health('boot', { version: APP_VERSION, port: env.port });
});
// A listen-time failure (e.g. EADDRINUSE) emits 'error' with no default listener —
// Node would rethrow it as an uncaught exception and only dump to stderr. Catch it
// so it ships, flush, then exit(1).
server.on('error', makeServerErrorHandler(logger, { flush: flushAxiom }));

// Last-resort net: an uncaughtException means unknown state → log (ships) → flush → exit(1).
installProcessGuards(logger, { flush: flushAxiom });

process.on('unhandledRejection', (reason) => {
  logger.logError('server', 'unhandled rejection', { reason: String(reason) });
});

// Drain the Axiom buffer on shutdown so the last records before exit are not lost.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    flushAxiom().finally(() => process.exit(0));
  });
}
