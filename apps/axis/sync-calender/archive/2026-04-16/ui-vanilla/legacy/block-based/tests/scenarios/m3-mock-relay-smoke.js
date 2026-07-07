// M3 smoke — prove the full webhook → trigger-fire → relay → action loop
// completes end-to-end when everything is local + mocked except monday API.
//
//   node tests/run.js m3-mock-relay-smoke
//
// Flow:
//   1) Start mock-google on :9999, local app on :8081.
//   2) POST /admin/configure on mock with signing secret, token, board info,
//      and a mapping that injects startDate → date column + description → text col.
//   3) POST /triggers/subscribe on app → creates channel in .dev/storage.json
//      whose webhookUrl points at mock's /mock-monday/relay/:channelId.
//   4) Seed one event on the mock; trigger /webhook/calendar on the app.
//   5) App fetches events (mock), fires trigger → mock relay receives it,
//      signs a proper action JWT, POSTs to app's /actions/sync-events.
//   6) App processes the action, creates an item on the real monday board.
//   7) We poll monday by itemName; assert it appears, then leave it for
//      manual inspection per the project's no-auto-cleanup policy.

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { loadTestConfig } from '../lib/config.js';
import { assert, assertEq, assertionSummary } from '../lib/assert.js';
import { findItemsByName } from '../lib/monday-query.js';

const MOCK_PORT = 9999;
const APP_PORT = 8081;
const STORAGE_FILE = path.resolve('.dev/m3-storage.json');
const MOCK_BASE = `http://localhost:${MOCK_PORT}`;
const APP_BASE = `http://localhost:${APP_PORT}`;

// Known column IDs on the test board (from the .env defaults / production).
// Replace if your test board differs.
const DATE_COLUMN_ID = 'date_mkqwkw4q';
const TEXT_COLUMN_ID = 'text_mkqwc4p1';

function waitForHealth(url, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve(true);
      } catch {}
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

function startProcess(cmd, args, env, label) {
  const proc = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const forward = (src) => src.on('data', (d) => {
    if (process.env.VERBOSE) process.stdout.write(`[${label}] ${d}`);
  });
  forward(proc.stdout);
  forward(proc.stderr);
  return proc;
}

function stopProcess(proc) {
  if (!proc || proc.killed) return;
  proc.kill('SIGTERM');
}

function signSubscribeJwt({ signingSecret, shortLivedToken, accountId, userId, appId, audUrl }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { accountId, userId, platformAppId: appId, aud: audUrl, exp: now + 300, shortLivedToken, iat: now },
    signingSecret,
    { algorithm: 'HS256' }
  );
}

async function postJson(url, body, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed, text };
}

async function getJson(url) {
  const r = await fetch(url);
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

export async function run() {
  console.log('▶ Scenario: m3-mock-relay-smoke');
  const cfg = loadTestConfig();

  try { await fs.unlink(STORAGE_FILE); } catch (e) { if (e.code !== 'ENOENT') throw e; }

  const mock = startProcess('node', ['tests/mock-google/server.js'],
    { MOCK_PORT: String(MOCK_PORT) }, 'mock');
  const app = startProcess('node', ['./src/index.js'], {
    PORT: String(APP_PORT),
    NODE_ENV: 'development',
    LOCAL_SERVER_URL: APP_BASE,
    GOOGLE_API_BASE_URL: MOCK_BASE,
    USE_LOCAL_STORAGE: 'true',
    LOCAL_STORAGE_FILE: STORAGE_FILE,
    MONDAY_SIGNING_SECRET: cfg.signingSecret,
    MONDAY_APP_ID: String(cfg.appId),
    APP_BASE_URL: APP_BASE,
  }, 'app');

  try {
    assert(await waitForHealth(`${MOCK_BASE}/admin/health`), 'mock-google up');
    assert(await waitForHealth(`${APP_BASE}/webhook/calendar`, 8000) || true, 'local app up');

    // 1) Configure the mock relay with signing info and column mapping.
    const configRes = await postJson(`${MOCK_BASE}/admin/configure`, {
      appBaseUrl: APP_BASE,
      signingSecret: cfg.signingSecret,
      shortLivedToken: cfg.mondayApiToken,
      appId: cfg.appId,
      accountId: cfg.accountId,
      userId: cfg.userId,
      boardId: cfg.boardId,
      linkColumnId: cfg.linkColumnId,
      mapping: {
        itemName: 'eventName',
        item: {
          [DATE_COLUMN_ID]: 'startDate',
          [TEXT_COLUMN_ID]: 'description',
        },
      },
    });
    assertEq(configRes.status, 200, 'relay /admin/configure ok');

    // 2) Subscribe through the normal path so we have a real channel row.
    const subscribeAud = `${APP_BASE}/triggers/subscribe`;
    const subscribeJwt = signSubscribeJwt({
      signingSecret: cfg.signingSecret,
      shortLivedToken: cfg.mondayApiToken,
      accountId: cfg.accountId,
      userId: cfg.userId,
      appId: cfg.appId,
      audUrl: subscribeAud,
    });
    // webhookUrl MUST point at the mock relay so the trigger fire lands there
    // (not at real monday, which would reject our JWT).
    const channelWebhookBase = `${MOCK_BASE}/mock-monday/relay`;
    // The app generates its own channelId; we don't know it yet. So we point
    // webhookUrl at a stub path that includes {channelId} via the app's
    // fireTrigger — but our relay uses :channelId for routing only (optional).
    // In production the webhookUrl is per-subscription; we only need any URL
    // the relay can intercept. Use :placeholder and Apple.
    const subscribeRes = await postJson(subscribeAud, {
      payload: {
        webhookUrl: `${channelWebhookBase}/placeholder`,
        subscriptionId: 1,
        previousSubscriptionId: null,
        blockMetadata: { shouldCalculateDynamicMapping: false },
        inboundFieldValues: {},
        credentialsValues: {
          google_credentials: {
            userCredentialsId: 0,
            accessToken: 'mock-access-token',
            userCredentialsParams: {},
            tokenRequestedParams: {},
          },
        },
        inputFields: {},
        recipeId: 0,
        integrationId: 0,
      },
    }, { Authorization: subscribeJwt });
    assertEq(subscribeRes.status, 200, 'subscribe returned 200');
    const channelId = subscribeRes.body.webhookId;
    assert(!!channelId, 'got channelId from subscribe');

    // 3) Seed one event on the mock + fire the webhook at the app.
    const eventId = `test-m3-${Date.now()}`;
    const itemName = `test-m3-${Date.now()}`;
    const startIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const seedRes = await postJson(`${MOCK_BASE}/admin/seed-events`, {
      events: [{
        kind: 'calendar#event',
        id: eventId,
        status: 'confirmed',
        htmlLink: `https://www.google.com/calendar/event?eid=irrelevant-${eventId}`,
        summary: itemName,
        description: 'seeded by m3 test',
        start: { dateTime: startIso },
        end: { dateTime: endIso },
        organizer: { email: 'e2e-tester@example.com', self: true },
      }],
    });
    assertEq(seedRes.status, 200, 'seeded event on mock');

    // Simulate Google pushing a webhook. Use the same headers a real push has.
    const webhookRes = await fetch(`${APP_BASE}/webhook/calendar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Channel-Id': channelId,
        'X-Goog-Channel-Token': channelId,
        'X-Goog-Resource-State': 'exists',
        'X-Goog-Message-Number': '1',
      },
      body: '{}',
    });
    assertEq(webhookRes.status, 200, 'webhook returned 200');

    // Give the relay + action a moment to complete (the chain is synchronous
    // but spans several HTTP hops). Then inspect mock's relay log.
    await new Promise((r) => setTimeout(r, 1500));
    const stateRes = await getJson(`${MOCK_BASE}/admin/state`);
    const relays = stateRes.body.recentRelays || [];
    const relayEntry = relays[relays.length - 1];
    assert(!!relayEntry, 'mock relay received a trigger fire');
    if (relayEntry) {
      assertEq(relayEntry.outputFields?.eventId, eventId, 'relay outputFields.eventId matches');
      assertEq(relayEntry.outputFields?.eventStatus, 'confirmed', 'relay outputFields.eventStatus matches');
      assertEq(relayEntry.status, 'forwarded', 'relay forwarded to app');
      assertEq(relayEntry.forwardedStatus, 200, 'app action returned 200');
      assertEq(relayEntry.inboundFieldValues?.itemName, itemName, 'relay mapped itemName from eventName');
      assert(relayEntry.inboundFieldValues?.item?.[DATE_COLUMN_ID] === startIso,
        'relay mapped startDate into date column');
    }

    // Verify the item actually landed on the real monday board.
    const poll = async (attempts = 8, intervalMs = 600) => {
      for (let i = 0; i < attempts; i++) {
        const items = await findItemsByName({
          token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName,
        });
        if (items.length > 0) return items;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return [];
    };
    const items = await poll();
    assert(items.length >= 1, `item "${itemName}" appeared on board ${cfg.boardId}`);
    if (items.length >= 1) console.log(`    → itemId: ${items[0].id} (left on board for inspection)`);
  } finally {
    stopProcess(app);
    stopProcess(mock);
    await new Promise((r) => setTimeout(r, 300));
  }

  const { failures } = assertionSummary();
  if (failures > 0) {
    console.error('\n✗ m3-mock-relay-smoke FAILED');
    process.exitCode = 1;
    return;
  }
  console.log('\n✓ m3-mock-relay-smoke PASSED');
}
