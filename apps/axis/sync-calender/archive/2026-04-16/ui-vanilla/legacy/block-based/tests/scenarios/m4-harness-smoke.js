// M4 smoke — exercise every harness lib end-to-end:
//   - local-harness: spawn mock + app, ready waits, stopProcess cleanup.
//   - http: postJson / getJson / waitFor / waitForPort.
//   - e2e-setup: seeds channel, configures mock, returns cleanup().
//   - cleanup: clearLocalStorage removes the storage file.
//   - results-log: writes to tests/results.log + tests/results.jsonl.
//
//   node tests/run.js m4-harness-smoke

import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { setupE2e, fireWebhook } from '../lib/e2e-setup.js';
import { postJson, getJson, waitFor } from '../lib/http.js';
import { clearLocalStorage } from '../lib/cleanup.js';
import { startRun, createRecorder, finishRun } from '../lib/results-log.js';

const LOG_FILE = path.resolve('tests/results.log');
const JSONL_FILE = path.resolve('tests/results.jsonl');

export async function run() {
  const runCtx = startRun('m4-harness-smoke', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: m4-harness-smoke');

  // Capture sizes of log files before the run so we can verify growth.
  const logSizeBefore = existsSync(LOG_FILE) ? (await fs.stat(LOG_FILE)).size : 0;
  const jsonlSizeBefore = existsSync(JSONL_FILE) ? (await fs.stat(JSONL_FILE)).size : 0;

  let ctx;
  try {
    ctx = await setupE2e({ scenarioName: 'm4-harness-smoke' });
    r.assert(!!ctx.mock?.proc, 'mock process handle returned');
    r.assert(!!ctx.app?.proc, 'app process handle returned');
    r.assert(!!ctx.channelId, 'channelId generated');
    r.record('channelId', ctx.channelId);

    // Storage file was pre-seeded with a channel row — verify.
    const storageRaw = await fs.readFile(ctx.storageFile, 'utf8');
    const storage = JSON.parse(storageRaw);
    r.assert(!!storage[`channel_${ctx.channelId}`], 'storage file pre-seeded with channel row');
    const channel = JSON.parse(storage[`channel_${ctx.channelId}`].value);
    r.assert(channel.userEmail === 'e2e-tester@example.com', 'seeded channel has userEmail');
    r.assert(!!channel.webhookUrl.includes('/mock-monday/relay/'), 'webhookUrl points at mock relay');

    // Verify the mock is configured (relay info present).
    const state = await getJson(`${ctx.mock.baseUrl}/admin/state`);
    r.assert(state.body.config?.appBaseUrl === ctx.app.baseUrl, 'mock relay knows appBaseUrl');
    r.assert(state.body.config?.signingSecret?.length > 0, 'mock relay has signingSecret');
    r.assert(state.body.config?.boardId === ctx.cfg.boardId, 'mock relay has boardId');

    // Seed one event so the app has something to fire a trigger for.
    const itemName = `test-m4-harness-${Date.now()}`;
    const startIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const seedRes = await postJson(`${ctx.mock.baseUrl}/admin/seed-events`, {
      events: [{
        kind: 'calendar#event',
        id: `test-m4-evt-${Date.now()}`,
        status: 'confirmed',
        htmlLink: 'https://www.google.com/calendar/event?eid=irrelevant',
        summary: itemName,
        description: 'seeded by m4 harness smoke',
        start: { dateTime: startIso },
        end: { dateTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString() },
        organizer: { email: 'e2e-tester@example.com', self: true },
      }],
    });
    r.assert(seedRes.status === 200, 'seeded an event on mock');
    r.record('seededItemName', itemName);

    // fireWebhook sanity: hits the app; app should now fetch → fire trigger.
    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assert(wh.status === 200, 'fireWebhook returned 200');

    // waitFor sanity — poll the mock's relay log until a relay entry appears.
    const relayEntry = await waitFor(async () => {
      const s = await getJson(`${ctx.mock.baseUrl}/admin/state`);
      const relays = s.body.recentRelays || [];
      return relays[relays.length - 1] || null;
    }, { timeoutMs: 5000 });
    r.assert(!!relayEntry, 'waitFor saw a relay entry');
    if (relayEntry) r.record('relayForwardedStatus', relayEntry.forwardedStatus);
  } finally {
    if (ctx) await ctx.cleanup();
  }

  // After cleanup, storage file should be gone.
  const storageGone = !existsSync(path.resolve('.dev/m4-harness-smoke-storage.json'));
  r.assert(storageGone, 'cleanup() removed the storage file');

  // Finish the run — this appends to both results.log and results.jsonl.
  const summary = await finishRun(runCtx, 'pass');

  // Verify the logs grew.
  const logSizeAfter = existsSync(LOG_FILE) ? (await fs.stat(LOG_FILE)).size : 0;
  const jsonlSizeAfter = existsSync(JSONL_FILE) ? (await fs.stat(JSONL_FILE)).size : 0;
  r.assert(logSizeAfter > logSizeBefore, 'tests/results.log grew');
  r.assert(jsonlSizeAfter > jsonlSizeBefore, 'tests/results.jsonl grew');

  // Verify the jsonl tail is valid JSON and matches this run.
  const jsonl = await fs.readFile(JSONL_FILE, 'utf8');
  const lastLine = jsonl.trim().split('\n').pop();
  const parsed = JSON.parse(lastLine);
  r.assert(parsed.scenario === 'm4-harness-smoke', 'jsonl tail has this scenario');

  if (summary.failed > 0) {
    console.error(`\n✗ m4-harness-smoke FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ m4-harness-smoke PASSED  (${summary.passed}/${summary.total}, ${(summary.durationMs / 1000).toFixed(1)}s)`);
}
