// Server entry — reads env, wires real dependencies, listens. Everything
// testable lives behind createApp (src/app.js).

import 'dotenv/config';
import { createApp } from './app.js';
import { createAppStorage } from './services/storage.js';
import { createMondayApi } from './services/monday-api.js';
import { createRateLimiter } from './helpers/rate-limit.js';
import { createSecureStorageBackend } from './storage/secure-storage-backend.js';
import { createMemoryBackend } from './storage/memory-backend.js';
import { getEnv } from './helpers/environment.js';
import { logInfo, logError } from './helpers/logger.js';

const env = getEnv();

const backend = env.useLocalStorage ? createMemoryBackend() : createSecureStorageBackend();
const storage = createAppStorage({ backend });
const api = createMondayApi();
const rateLimiter = createRateLimiter();

const app = createApp({ storage, api, rateLimiter, env });

app.listen(env.port, () => {
  logInfo('server', 'deadline-confirm listening', { port: env.port, localStorage: env.useLocalStorage });
});

process.on('unhandledRejection', (reason) => {
  logError('server', 'unhandled rejection', { reason: String(reason) });
});
