// E2E — a single webhook surfaces the same eventId twice with different data.
// After the webhook completes, the final state (last version) should be what
// sits on the board (monday applies updates sequentially; last write wins).
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelayCount, waitForItemByName } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { getColumn, parseColumnValue } from '../../lib/action-helper.js';

export async function run() {
  const runCtx = startRun('e2e/create-then-update-same-batch', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/create-then-update-same-batch');

  const ts = Date.now();
  const eventId = `test-evt-dup-batch-${ts}`;
  const nameV1 = `test-dup-batch-${ts}-v1`;
  const nameV2 = `test-dup-batch-${ts}-v2`;
  const start = new Date(ts + 3600_000).toISOString();
  const end = new Date(ts + 2 * 3600_000).toISOString();
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'create-then-update-same-batch' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({ id: eventId, summary: nameV1, description: 'first', start, end }),
      buildGoogleEvent({ id: eventId, summary: nameV2, description: 'second', start, end }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });

    // The server fires a trigger per event → 2 relay entries expected.
    const relays = await waitForRelayCount(ctx.mock.baseUrl, 2, { timeoutMs: 15000 });
    r.assert(!!relays && relays.length >= 2, '2 relay entries (one per duplicate)');

    // Final item on board should be v2 state.
    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: nameV2, timeoutMs: 15000,
    });
    r.assertEq(items.length, 1, 'final item has v2 name');
    if (items[0]) {
      const desc = parseColumnValue(getColumn(items[0], ctx.cfg.textColumnId));
      r.assertEq(desc, 'second', 'final description is v2');
    }
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
