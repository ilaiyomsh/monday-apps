/**
 * index — env + wiring + listen. Nothing testable lives here (app.js is the
 * testable factory); this file is the deploy entrypoint monday-code starts.
 *
 * Env (platform: `mapps code:env`; local: shell):
 *   MONDAY_CLIENT_ID / MONDAY_CLIENT_SECRET — OAuth + sessionToken verification
 *   MONDAY_SIGNING_SECRET                   — webhook JWT verification
 *   BASE_URL                                — this service's public URL
 *   ALLOW_UNSIGNED_WEBHOOKS                 — 'true' ONLY during sandbox bring-up
 *   PORT                                    — platform-injected
 *   AXIOM_TOKEN / AXIOM_DATASET / AXIOM_APP_NAME — remote error shipping (gated)
 *   LOG_SHIP_LEVEL                          — widen ship policy in incidents (optional)
 *
 * monday-code does NOT inject platform env into process.env — the SDK reads a
 * mounted secrets file. EnvironmentVariablesManager({updateProcessEnv:true})
 * copies them in so the process.env reads below work in production; locally it
 * is a no-op over process.env (shell/CI env keeps working).
 */

import { readFileSync } from 'node:fs';
import { EnvironmentVariablesManager, SecureStorage, Storage } from '@mondaycom/apps-sdk';

const envManager = new EnvironmentVariablesManager({ updateProcessEnv: true });

import { createApp } from './app.js';
import logger from './helpers/logger.js';
import { installSdkLogFilter } from './helpers/sdk-log-filter.js';
import { createResilientSecureStorage } from './helpers/secure-storage-resilient.js';
import { attachAxiomServerSink, flushAxiom } from './helpers/axiomServerSink.js';

// Silence apps-sdk 0.1.4's per-read console chatter (SecureStorage/Storage "Got
// data for key…") BEFORE any storage call runs — it buries the guard's own log
// lines in `code:logs` and leaks storage keys. Errors/warns are untouched.
installSdkLogFilter();
import {
  installProcessGuards,
  makeServerErrorHandler,
  readPackageVersion,
  safeBootInit,
} from './helpers/process-guards.js';
import { evaluateStatusChange } from './guard/evaluateStatusChange.js';
import { createStatusChangeHandler } from './guard/handleStatusChangeEvent.js';
import { createMondayApi } from './services/monday-api.js';
import { createMondayOauthClient } from './services/monday-oauth-client.js';
import { createBypassLog, createEnrollmentStore, createRulesStore, createTokenStore } from './services/stores.js';

const env = {
  clientId: process.env.MONDAY_CLIENT_ID ?? '',
  clientSecret: process.env.MONDAY_CLIENT_SECRET ?? '',
  signingSecret: process.env.MONDAY_SIGNING_SECRET ?? '',
  baseUrl: (process.env.BASE_URL ?? '').replace(/\/$/, ''),
  allowUnsignedWebhooks: process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true',
  oauthAppVersionId: process.env.MONDAY_APP_VERSION_ID ?? '',
};

// App version (read via fs — works on plain node 20 without JSON import attributes).
const APP_VERSION = readPackageVersion({
  readFileSync,
  url: new URL('../package.json', import.meta.url),
});

// --- Axiom remote error shipping (gated on the AXIOM_* secrets) --------------
// Read the Axiom config through the SDK manager (NOT process.env directly) —
// monday-code injects platform secrets into the mounted file the manager reads.
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

// SecureStorage construction can throw on misconfigured platform secrets; guard it
// so the failure SHIPS, races the flush, exits 1, and re-throws (no half-built server).
const rawSecureStorage = safeBootInit(
  () => new SecureStorage(),
  'secure storage init',
  logger,
  { flush: flushAxiom },
);
// Wrap it so the platform's transient Vault hiccups (cold-start `…/vault-server…
// /auth/gcp/login` HTML bodies, "accessing secure storage") retry instead of
// bubbling up as 502s, and so a burst of same-key reads shares one round-trip.
const secureStorage = createResilientSecureStorage(rawSecureStorage, { logger });

const api = createMondayApi({ logger });
const oauthClient = createMondayOauthClient({ clientId: env.clientId, clientSecret: env.clientSecret, logger });
const tokenStore = createTokenStore({ secureStorage, oauthClient, logger });
const enrollmentStore = createEnrollmentStore({ secureStorage });
const rulesStore = createRulesStore({ storageFactory: (token) => new Storage(token), logger });
const bypassLog = createBypassLog({ secureStorage, logger });
const handleEvent = createStatusChangeHandler({ api, tokenStore, rulesStore, bypassLog, logger, evaluate: evaluateStatusChange });

const app = createApp({
  handleEvent, tokenStore, enrollmentStore, rulesStore, bypassLog, api, oauthClient, env, logger,
});

const port = Number(process.env.PORT ?? 8080);
const server = app.listen(port, () => {
  logger.info('guard listening', 'boot', { port, baseUrlConfigured: env.baseUrl !== '' });
});
// A listen-time failure (e.g. EADDRINUSE) emits 'error' with no default listener —
// Node would rethrow it as an uncaught exception and only dump to stderr. Catch it
// so it ships, flush, then exit(1).
server.on('error', makeServerErrorHandler(logger, { flush: flushAxiom }));

// Last-resort net: an uncaughtException means unknown state → log (ships) → flush → exit(1).
installProcessGuards(logger, { flush: flushAxiom });

// A rejected promise nobody awaited: log+ship but do NOT exit — the process state
// is still known-good and killing it would drop in-flight webhook handling.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', 'process', { error: String(reason?.message ?? reason) });
});

// Drain the Axiom buffer on shutdown so the last records before exit are not lost.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => flushAxiom().finally(() => process.exit(0)));
}
