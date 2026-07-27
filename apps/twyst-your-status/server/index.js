import 'dotenv/config';
import { EnvironmentVariablesManager } from '@mondaycom/apps-sdk';
import { createApp } from './app.js';
import { getEnv } from './env.js';
import logger from './logger.js';
import { installProcessGuards, setGracefulServer } from './processGuards.js';
import { createEnforcementService } from './services/enforcementService.js';
import { createMondayApi } from './services/mondayApi.js';
import { createMondayOauthClient } from './services/mondayOauthClient.js';
import { createOauthTokenProvider } from './services/oauthTokenProvider.js';
import { createWebhookManager } from './services/webhookManager.js';
import { createMemoryBackend } from './storage/memoryBackend.js';
import { createSecureStorageBackend } from './storage/secureStorageBackend.js';
import { createWorkflowStore } from './storage/workflowStore.js';

installProcessGuards(logger);
new EnvironmentVariablesManager({ updateProcessEnv: true });
const env = getEnv();
const backend = env.useMemoryStorage ? createMemoryBackend() : createSecureStorageBackend();
const store = createWorkflowStore({ backend });
const mondayApi = createMondayApi();
const oauthClient = createMondayOauthClient({
  clientId: env.clientId,
  clientSecret: env.clientSecret,
});
const tokenProvider = createOauthTokenProvider({ store, oauthClient, logger });
const webhookManager = createWebhookManager({ store, mondayApi, baseUrl: env.baseUrl });
const enforcementService = createEnforcementService({ store, mondayApi });
const app = createApp({
  store,
  mondayApi,
  webhookManager,
  enforcementService,
  tokenProvider,
  oauthClient,
  env,
});

const server = app.listen(env.port, () => {
  logger.info('server_started', 'process', { port: env.port });
});
setGracefulServer(server);
