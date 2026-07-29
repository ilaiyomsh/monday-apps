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
import { createRateLimiter } from './helpers/rate-limit.js';
import { createSecureStorageBackend } from './storage/secure-storage-backend.js';
import { createMemoryBackend } from './storage/memory-backend.js';
import { getEnv } from './helpers/environment.js';
import { createGmailSender } from './services/gmail-sender.js';
import logger, { logInfo, logWarn, health } from './helpers/logger.js';
import { attachAxiomServerSink, flushAxiom } from './helpers/axiomServerSink.js';
import {
  installProcessGuards,
  makeServerErrorHandler,
  readPackageVersion,
  safeBootInit,
} from './helpers/process-guards.js';

const env = getEnv();

if (env.allowedAccountIds.length === 0) {
  // D15: empty roster is default-deny. Surfacing loudly at boot so a missing
  // mapps code:env does not silently lock every tenant out.
  logger.logError(
    'server',
    'ALLOWED_ACCOUNT_IDS is empty — default-deny; nobody is admitted and the scheduler sends to nobody (D15)',
    {}
  );
}

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
// V6 §4 two buckets: A (per-IP, generous — abuse control before any secret
// work) and B (per accountId:ip, 30/min — protects the monday complexity
// budget after verification). Entropy blocks guessing; these protect
// resources.
const rateLimiters = {
  perIp: createRateLimiter({ capacity: 120 }),
  perAccount: createRateLimiter(),
};

// V6 T9: Gmail API is the only sending channel (Resend is gone). The sender is
// constructed only when an OAuth client pair is present — with neither an
// app-level pair nor (later) a per-tenant one there is nothing to authenticate
// with, and leaving the seam empty is what makes POST /api/digest/send answer a
// clean 409 email_not_configured instead of failing mid-flight.
const emailSender =
  env.googleOauthClientId && env.googleOauthClientSecret
    ? createGmailSender({
        storage,
        clientId: env.googleOauthClientId,
        clientSecret: env.googleOauthClientSecret,
      })
    : undefined;
if (!emailSender) {
  logWarn('server', 'Gmail sender not configured — digest sending is disabled', {});
}

// `version` is stamped in here, not in getEnv(): the number lives in
// package.json, which is a file read, not an env var. Without it /health
// answered `"dev"` on every deployment — so there was no way to tell from the
// outside which version a container was running, exactly when that mattered
// most (verifying a live deploy had actually landed).
const app = createApp({
  storage,
  api,
  rateLimiters,
  env: { ...env, version: APP_VERSION },
  emailSender,
});

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

// A rejected promise nobody awaited: log+ship but do NOT exit — unlike uncaughtException
// above, the process state is still known-good and killing it would drop in-flight /confirm
// requests. This deliberately overrides Node's modern default (terminate). Same policy and
// rationale as sync-calender's onUnhandledRejection (process-guards.js); telemetry-dashboard
// matches too — the three servers are aligned, this comment records why for deadline-confirm.
process.on('unhandledRejection', (reason) => {
  logger.logError('server', 'unhandled rejection', { reason: String(reason) });
});

// Drain the Axiom buffer on shutdown so the last records before exit are not lost.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    // return the promise (not floated): flushAxiom never throws, and exit(0) runs in finally.
    return flushAxiom().finally(() => process.exit(0));
  });
}
