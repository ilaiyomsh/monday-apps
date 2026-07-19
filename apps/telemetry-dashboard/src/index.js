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

// --- Lifecycle events → monday board (inert unless configured) -----------
// No token → no monday client; no board id → no board service. The lifecycle
// service is ALWAYS built: with eventsBoard null it warns once per route and
// skips recording, so webhooks still 202 and never error back at monday.
const mondayApi = env.mondayApiToken
  ? createMondayApi({ token: env.mondayApiToken, url: env.mondayApiUrl, logger })
  : null;
const eventsBoard =
  mondayApi && env.lifecycleBoardId
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
