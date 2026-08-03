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
 */

import { SecureStorage, Storage } from '@mondaycom/apps-sdk';
import { createApp } from './app.js';
import logger from './helpers/logger.js';
import { evaluateStatusChange } from './guard/evaluateStatusChange.js';
import { createStatusChangeHandler } from './guard/handleStatusChangeEvent.js';
import { createMondayApi } from './services/monday-api.js';
import { createEnrollmentStore, createRulesStore, createTokenStore } from './services/stores.js';

const env = {
  clientId: process.env.MONDAY_CLIENT_ID ?? '',
  clientSecret: process.env.MONDAY_CLIENT_SECRET ?? '',
  signingSecret: process.env.MONDAY_SIGNING_SECRET ?? '',
  baseUrl: (process.env.BASE_URL ?? '').replace(/\/$/, ''),
  allowUnsignedWebhooks: process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true',
};

const secureStorage = new SecureStorage();
const api = createMondayApi({ logger });
const tokenStore = createTokenStore({ secureStorage });
const enrollmentStore = createEnrollmentStore({ secureStorage });
const rulesStore = createRulesStore({ storageFactory: (token) => new Storage(token), logger });
const handleEvent = createStatusChangeHandler({ api, tokenStore, rulesStore, logger, evaluate: evaluateStatusChange });

const app = createApp({ handleEvent, tokenStore, enrollmentStore, api, env, logger });

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  logger.info('guard listening', 'boot', { port, baseUrlConfigured: env.baseUrl !== '' });
});

process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection', 'process', { error: String(err?.message ?? err) });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', 'process', { error: String(err?.message ?? err) });
});
