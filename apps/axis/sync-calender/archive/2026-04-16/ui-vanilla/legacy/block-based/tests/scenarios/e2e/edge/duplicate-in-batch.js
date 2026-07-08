// Edge — same eventId twice in one fetch with different data. Server fires
// trigger per event, action processes them sequentially. Final monday state
// reflects the SECOND (last) version.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, waitForRelayCount, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/edge/duplicate-in-batch', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/duplicate-in-batch');

  const ts = Date.now();
  const eventId = `test-evt-dup-${ts}`;
  const nameLast = `test-dup-${ts}-LAST`;
  const start = new Date(ts + 3600_000).toISOString();
  const end = new Date(ts + 2 * 3600_000).toISOString();
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'edge-duplicate-in-batch' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({ id: eventId, summary: `test-dup-${ts}-FIRST`, start, end }),
      buildGoogleEvent({ id: eventId, summary: nameLast, start, end }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relays = await waitForRelayCount(ctx.mock.baseUrl, 2, { timeoutMs: 15000 });
    r.assert(!!relays && relays.length >= 2, '2 trigger fires (one per occurrence)');

    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: nameLast, timeoutMs: 15000,
    });
    r.assertEq(items.length, 1, 'final item has the LAST name (last write wins)');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
