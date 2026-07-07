// E2E — one webhook surfaces 3 events; 3 items land on the board.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelayCount, waitForItemByName } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/batch-multiple-events', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/batch-multiple-events');

  const ts = Date.now();
  const names = [`test-batch-${ts}-a`, `test-batch-${ts}-b`, `test-batch-${ts}-c`];
  const events = names.map((n, i) => buildGoogleEvent({
    id: `test-evt-batch-${ts}-${i}`,
    summary: n,
    start: new Date(ts + (i + 1) * 3600_000).toISOString(),
    end: new Date(ts + (i + 2) * 3600_000).toISOString(),
  }));
  r.record('eventIds', events.map(e => e.id));

  const ctx = await setupE2e({ scenarioName: 'batch-multiple-events' });
  try {
    await seedEvents(ctx.mock.baseUrl, events);
    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assertEq(wh.status, 200, 'webhook 200');

    const relays = await waitForRelayCount(ctx.mock.baseUrl, 3, { timeoutMs: 15000 });
    r.assert(!!relays && relays.length >= 3, '3 relay entries seen');

    const createdIds = [];
    for (const name of names) {
      const items = await waitForItemByName({
        token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name, timeoutMs: 10000,
      });
      r.assertEq(items.length, 1, `item "${name}" exists`);
      if (items[0]) createdIds.push(items[0].id);
    }
    r.record('createdItemIds', createdIds);
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
