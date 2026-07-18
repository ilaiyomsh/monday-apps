// Server entry — reads env, wires the telemetry service, listens. Everything
// testable lives behind createApp (src/app.js).

import 'dotenv/config';
import { EnvironmentVariablesManager } from '@mondaycom/apps-sdk';
// monday-code does NOT inject platform env vars into process.env — they live in
// a mounted secrets file the SDK reads. updateProcessEnv copies them in;
// locally the manager is a no-op over process.env, so dotenv keeps working.
new EnvironmentVariablesManager({ updateProcessEnv: true });

import { createApp } from './app.js';
import { createTelemetryService } from './server/telemetry-service.js';
import { getEnv } from './helpers/environment.js';

const env = getEnv();

const telemetry = createTelemetryService({
  axiomToken: env.axiomToken,
  axiomDataset: env.axiomDataset,
  axiomOrgId: env.axiomOrgId,
});

const app = createApp({ telemetry, env });

app.listen(env.port, () => {
  console.log(
    `telemetry-dashboard listening on ${env.port} ` +
      `(axiom=${telemetry.enabled ? 'live' : 'seed-mode'}, ` +
      `allowlist=${env.allowedAccountIds.length || 'open'})`
  );
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection:', String(reason));
});
