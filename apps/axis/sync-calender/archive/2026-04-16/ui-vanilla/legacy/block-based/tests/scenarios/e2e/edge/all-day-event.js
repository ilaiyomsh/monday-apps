// Edge — Google "all-day" events use `start.date` (YYYY-MM-DD) instead of
// `start.dateTime`. Per product decision, all-day events are NOT synced to
// the board: only events with a concrete start/end time become items.
//
// Expectation: no trigger fires, no item created.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, assertNoRelay, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/edge/all-day-event', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/all-day-event');

  const ts = Date.now();
  const eventId = `test-evt-allday-${ts}`;
  const itemName = `test-allday-${ts}`;
  const dateOnly = '2026-08-15';
  r.record('eventId', eventId);
  r.record('dateOnly', dateOnly);

  const ctx = await setupE2e({ scenarioName: 'edge-all-day' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({
        id: eventId, summary: itemName,
        start: dateOnly, end: '2026-08-16', allDay: true,
      }),
    ]);
    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assert(wh.status === 200, 'webhook 200 (all-day was fetched)');

    const noRelay = await assertNoRelay(ctx.mock.baseUrl);
    r.assert(noRelay, 'no trigger fired (all-day events are filtered out)');

    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName, timeoutMs: 1500,
    });
    r.assert(items.length === 0, 'no item created on board for all-day event');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
