// Server entry — reads env, wires the telemetry service + lifecycle webhook
// pipeline, listens. Everything testable lives behind createApp (src/app.js).

import 'dotenv/config';
import { EnvironmentVariablesManager } from '@mondaycom/apps-sdk';
// monday-code does NOT inject platform env vars into process.env — they live in
// a mounted secrets file the SDK reads. updateProcessEnv copies them in;
// locally the manager is a no-op over process.env, so dotenv keeps working.
const envManager = new EnvironmentVariablesManager({ updateProcessEnv: true });

// logger.js still reads LOG_LEVEL from process.env at module load, so app-side
// imports stay DYNAMIC (top-level await) — a static import would hoist ABOVE the
// manager call and the platform env would be invisible. The Axiom sink is now
// OPTS-INJECTED (reads zero process.env itself): index.js resolves AXIOM_* here
// and passes them in, so this file is the single place env is read (error-guard
// server-patterns.md: sink configured via opts, no process.env inside the sink).
const { default: logger } = await import('./helpers/logger.js');
const { attachAxiomServerSink, flushAxiom } = await import('./helpers/axiomServerSink.js');
const { installProcessGuards, setGracefulServer } = await import('./helpers/processGuards.js');

// Resolve the Axiom sink config through the SDK manager (updateProcessEnv mirrors
// platform secrets into process.env, so either read path works; envManager.get is
// canonical). Without token+dataset+app the sink is structurally inert.
const axiomEnv = (key) => envManager.get(key) ?? process.env[key];

// Sink + process-level nets first, before anything else can throw.
attachAxiomServerSink(logger, {
  token: axiomEnv('AXIOM_TOKEN'),
  dataset: axiomEnv('AXIOM_DATASET'),
  app: axiomEnv('AXIOM_APP_NAME'),
  env: axiomEnv('NODE_ENV') || 'production',
  ver: axiomEnv('npm_package_version') || axiomEnv('APP_VERSION'),
  shipLevel: axiomEnv('LOG_SHIP_LEVEL'),
});
installProcessGuards(logger, { flush: flushAxiom });

const { createApp } = await import('./app.js');
const { createTelemetryService } = await import('./server/telemetry-service.js');
const { createMondayApi } = await import('./services/monday-api.js');
const { createEventsBoardService } = await import('./services/events-board.js');
const { createBoardProvisioner } = await import('./services/board-provisioner.js');
const { createLifecycleService } = await import('./services/lifecycle-service.js');
const { createStorageService } = await import('./services/storage.js');
const { createMondayOauthClient } = await import('./services/monday-oauth-client.js');
const { createOauthTokenProvider } = await import('./services/oauth-token-provider.js');
const { createSecureStorageBackend } = await import('./storage/secure-storage-backend.js');
const { getEnv } = await import('./helpers/environment.js');

const env = getEnv();

// environment.js parses JSON env vars silently (it is logger-free by design);
// the boot-time validation lives HERE: a var that is set but yielded nothing
// is a misconfiguration worth one warn (key name only — never the value).
for (const [key, parsed] of [
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
  logger,
});

// --- OAuth app-identity token (Change #143, OAuth 2.1 in #144) -------------
// The owner authorizes ONCE at /oauth/start (mounted in app.js); the token
// RECORD (access + rotating refresh + expiry) is stored in SecureStorage
// (services/storage.js, key owner:oauth_token) with a 60s read cache. The
// token provider refreshes proactively (5-min cushion, single-flight) and
// getWriteToken resolves it per monday-api call, falling back to the
// personal MONDAY_API_TOKEN only when no usable OAuth token exists.
const storageBackend = createSecureStorageBackend();
const storage = createStorageService({ backend: storageBackend, logger });
const oauthClient = createMondayOauthClient({
  clientId: env.mondayClientId,
  clientSecret: env.clientSecret,
});
const tokenProvider = createOauthTokenProvider({ storage, oauthClient, logger });
const getWriteToken = async () =>
  (await tokenProvider.getFreshAccessToken()) ?? (env.mondayApiToken || null);

// --- Lifecycle events → monday board (config now lives in SecureStorage) --
// The monday API client resolves its write token PER CALL (getWriteToken).
// The events board is ALWAYS built: it reads its config (board id, single
// group, column map) per event via storage.getBoardConfig() — provisioned
// from the Settings UI, not env. Until a board is provisioned, getBoardConfig
// yields null → recordEvent warns once and skips, so webhooks still 202 and
// never error back at monday. Once provisioned, a write with no OAuth token
// yet fails soft (MondayApiError 'no_write_token' → logged, null) — the token
// can arrive later via /oauth/start.
const mondayApi = createMondayApi({ getToken: getWriteToken, url: env.mondayApiUrl, logger });
const eventsBoard = createEventsBoardService({
  mondayApi,
  getConfig: () => storage.getBoardConfig(),
  logger,
});
const provisioner = createBoardProvisioner({ mondayApi, storage, logger });
const { createAccountSlugResolver } = await import('./services/account-slug.js');
const slugResolver = createAccountSlugResolver({ mondayApi, logger });
const lifecycleService = createLifecycleService({
  eventsBoard,
  logger,
  debugRawPayload: env.debugLifecyclePayload,
  slugResolver,
});

const app = createApp({
  telemetry,
  env,
  storage,
  provisioner,
  tokenProvider,
  oauthClient,
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
    lifecycleApps: Object.keys(env.lifecycleSigningSecrets).length,
    appEventApps: Object.keys(env.appEventsClientSecrets).length,
  });
});
// Lets SIGTERM/SIGINT (processGuards) close in-flight requests before exit.
setGracefulServer(server);
