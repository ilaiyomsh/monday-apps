// One-shot setup for Tier 2 E2E scenarios:
//   const ctx = await setupE2e({ scenarioName: 'webhook-create' });
//   …use ctx.channelId, ctx.mock, ctx.app, ctx.cfg…
//   await ctx.cleanup();
//
// It spawns the mock + local app, seeds a channel row in the local storage
// file (so the app's webhook handler recognizes the test channelId), and
// configures the mock's relay with signing info + column mapping.

import { promises as fs } from 'fs';
import path from 'path';
import { loadTestConfig } from './config.js';
import { startMockGoogle, startLocalApp, stopProcess } from './local-harness.js';
import { postJson } from './http.js';
import { clearLocalStorage } from './cleanup.js';

const DEFAULT_MAPPING = {
  itemName: 'eventName',
  item: {
    date_mkqwkw4q: 'startDate',
    text_mkqwc4p1: 'description',
  },
};

function slug(s) {
  return String(s || 'scenario').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

export async function setupE2e({
  scenarioName,
  mockPort = 9999,
  appPort = 8081,
  mapping = DEFAULT_MAPPING,
  initialUserEmail = 'e2e-tester@example.com',
} = {}) {
  const cfg = loadTestConfig();
  const storageFile = path.resolve(`.dev/${slug(scenarioName)}-storage.json`);

  // 0) Clear any leftover storage from a previous run of this scenario.
  await clearLocalStorage(storageFile);

  // 1) Start mock-google first (app will call it on boot? no, but cleaner ordering).
  const mock = await startMockGoogle({ port: mockPort });

  // 2) Seed a subscription row into the local storage file BEFORE the app
  // boots, so the very first /webhook/calendar call finds it.
  // In the v3 (revised) architecture the Google watch channel id IS the
  // monday-provided subscriptionId — no translation. We keep the local
  // variable name `channelId` as a convenience alias so existing scenarios
  // that pass `channelId: ctx.channelId` to fireWebhook keep working.
  const subscriptionId = `test-sub-${Date.now()}`;
  const channelId = subscriptionId;
  const subscriptionData = {
    webhookUrl: `${mock.baseUrl}/mock-monday/relay/${subscriptionId}`,
    syncToken: 'mock-sync-0',
    userId: cfg.userId,
    accountId: cfg.accountId,
    userEmail: initialUserEmail,
    resourceId: `mock-resource-${subscriptionId}`,
    expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
    accessToken: 'mock-access-token',
    accessTokenUpdatedAt: Date.now(),
    createdAt: Date.now(),
  };
  const initialStorage = {
    [`subscription_${subscriptionId}`]: { value: JSON.stringify(subscriptionData) },
    [`user_subscriptions_${cfg.userId}`]: { value: JSON.stringify([subscriptionId]) },
  };
  await fs.mkdir(path.dirname(storageFile), { recursive: true });
  await fs.writeFile(storageFile, JSON.stringify(initialStorage, null, 2));

  // 3) Start the app.
  const app = await startLocalApp({ port: appPort, mockPort, storageFile });

  // 4) Configure the mock's relay (signing secret + monday api token + mapping).
  // storageFile is shared with the relay so it can read trigger_cache_<uuid>
  // entries to enrich its relay log with routing context for assertions.
  await postJson(`${mock.baseUrl}/admin/configure`, {
    appBaseUrl: app.baseUrl,
    signingSecret: cfg.signingSecret,
    shortLivedToken: cfg.mondayApiToken,
    appId: cfg.appId,
    accountId: cfg.accountId,
    userId: cfg.userId,
    boardId: cfg.boardId,
    linkColumnId: cfg.linkColumnId,
    storageFile,
    mapping,
  });

  // 5) Also set the mock's user email so /oauth2/v2/userinfo matches the seeded channel.
  await postJson(`${mock.baseUrl}/admin/set-user-email`, { email: initialUserEmail });

  async function cleanup() {
    // Await actual process exits so ports are released before the next
    // scenario attempts to bind them.
    await Promise.all([stopProcess(app), stopProcess(mock)]);
    await clearLocalStorage(storageFile);
  }

  return { cfg, mock, app, channelId, subscriptionId, storageFile, cleanup };
}

// Convenience: simulate Google pushing a webhook for an existing channel.
export async function fireWebhook({ app, channelId, resourceState = 'exists' }) {
  const res = await fetch(`${app.baseUrl}/webhook/calendar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Channel-Id': channelId,
      'X-Goog-Channel-Token': channelId,
      'X-Goog-Resource-State': resourceState,
      'X-Goog-Message-Number': String(Date.now()),
    },
    body: '{}',
  });
  return { status: res.status };
}
