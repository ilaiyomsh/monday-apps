// Server entry — reads env, wires the telemetry service + lifecycle webhook
// pipeline, listens. Everything testable lives behind createApp (src/app.js).

import 'dotenv/config';
import { EnvironmentVariablesManager } from '@mondaycom/apps-sdk';
// monday-code does NOT inject platform env vars into process.env — they live in
// a mounted secrets file the SDK reads. updateProcessEnv copies them in;
// locally the manager is a no-op over process.env, so dotenv keeps working.
new EnvironmentVariablesManager({ updateProcessEnv: true });

// Everything app-side is imported DYNAMICALLY (top-level await): logger.js and
// axiomServerSink.js read LOG_LEVEL / AXIOM_* from process.env at module load,
// and a static import would hoist ABOVE the manager call — the platform
// secrets would be invisible and the Axiom sink permanently inert in prod.
const { default: logger } = await import('./helpers/logger.js');
const { attachAxiomServerSink, flushAxiom } = await import('./helpers/axiomServerSink.js');
const { installProcessGuards, setGracefulServer } = await import('./helpers/processGuards.js');

// Sink + process-level nets first, before anything else can throw.
attachAxiomServerSink(logger);
installProcessGuards(logger, { flush: flushAxiom });

const { createApp } = await import('./app.js');
const { createTelemetryService } = await import('./server/telemetry-service.js');
const { createMondayApi } = await import('./services/monday-api.js');
const { createEventsBoardService } = await import('./services/events-board.js');
const { createLifecycleService } = await import('./services/lifecycle-service.js');
const { createStorageService } = await import('./services/storage.js');
const { createSecureStorageBackend } = await import('./storage/secure-storage-backend.js');
const { getEnv } = await import('./helpers/environment.js');

const env = getEnv();

// environment.js parses JSON env vars silently (it is logger-free by design);
// the boot-time validation lives HERE: a var that is set but yielded nothing
// is a misconfiguration worth one warn (key name only — never the value).
for (const [key, parsed] of [
  ['LIFECYCLE_BOARD_COLUMNS', env.lifecycleBoardColumns],
  ['LIFECYCLE_SIGNING_SECRETS', env.lifecycleSigningSecrets],
  ['APP_EVENTS_CLIENT_SECRETS', env.appEventsClientSecrets],
]) {
  const raw = process.env[key];
  if (typeof raw === 'string' && raw.trim().length > 0 && Object.keys(parsed).length === 0) {
    logger.warn('env_json_invalid', 'server', { key });
  }
}

const telemetry = createTelemetryService({
  axiomToken: env.axiomToken,
  axiomDataset: env.axiomDataset,
  axiomOrgId: env.axiomOrgId,
});

// --- OAuth app-identity token (Change #143 continuation) ------------------
// The owner authorizes ONCE at /oauth/start (mounted in app.js); the token is
// stored in SecureStorage (services/storage.js, key owner:oauth_token) with
// a 60s read cache. getWriteToken resolves it per monday-api call, falling
// back to the personal MONDAY_API_TOKEN only when no OAuth token exists yet.
const storageBackend = createSecureStorageBackend();
const storage = createStorageService({ backend: storageBackend, logger });
const getWriteToken = async () => (await storage.getOwnerToken()) ?? (env.mondayApiToken || null);

// --- Lifecycle events → monday board (inert unless a board id is set) ----
// The monday API client resolves its write token PER CALL (getWriteToken
// above), so the events board is built whenever a board id is configured —
// even before the owner has authorized, since the token can arrive later via
// OAuth. Until then, each write attempt fails soft: monday-api throws
// MondayApiError('no_write_token'), which events-board's recordEvent catches
// like any other failure (logs, returns null) — it never reaches the webhook
// path. The lifecycle service is ALWAYS built: with eventsBoard null (no
// board id at all) it warns 'lifecycle_not_configured' once per route and
// skips recording, so webhooks still 202 and never error back at monday.
const mondayApi = createMondayApi({ getToken: getWriteToken, url: env.mondayApiUrl, logger });
const eventsBoard = env.lifecycleBoardId
  ? createEventsBoardService({
      mondayApi,
      boardId: env.lifecycleBoardId,
      columns: env.lifecycleBoardColumns,
      logger,
    })
  : null;
const lifecycleService = createLifecycleService({ eventsBoard, logger });

const app = createApp({
  telemetry,
  env,
  storage,
  lifecycle: {
    service: lifecycleService,
    signingSecrets: env.lifecycleSigningSecrets,
    clientSecrets: env.appEventsClientSecrets,
  },
});

const server = app.listen(env.port, () => {
  logger.info('server_boot', 'server', {
    port: env.port,
    axiom: telemetry.enabled ? 'live' : 'seed-mode',
    allowlist: env.allowedAccountIds.length,
    lifecycleBoard: Boolean(eventsBoard),
    lifecycleApps: Object.keys(env.lifecycleSigningSecrets).length,
    appEventApps: Object.keys(env.appEventsClientSecrets).length,
  });
});
// Lets SIGTERM/SIGINT (processGuards) close in-flight requests before exit.
setGracefulServer(server);
