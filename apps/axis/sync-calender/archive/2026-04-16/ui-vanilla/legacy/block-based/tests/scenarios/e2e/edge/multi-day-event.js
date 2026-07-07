// Edge — event spans multiple days (start day N, end day N+2). Verify item
// is created with start time correct (we don't separately track end-day in
// monday's date column, but at least nothing crashes on multi-day).
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/edge/multi-day-event', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/multi-day-event');

  const ts = Date.now();
  const eventId = `test-evt-multi-day-${ts}`;
  const itemName = `test-multi-day-${ts}`;
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'edge-multi-day' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({
        id: eventId, summary: itemName,
        start: '2026-09-10T09:00:00Z',
        end: '2026-09-12T17:00:00Z', // +2 days
      }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relay = await waitForRelay(ctx.mock.baseUrl, { eventId });
    r.assert(!!relay, 'relay fired for multi-day event');
    r.assertEq(relay?.outputFields?.startDate, '2026-09-10T09:00:00Z', 'startDate is start day');
    r.assertEq(relay?.outputFields?.endDate, '2026-09-12T17:00:00Z', 'endDate is end day +2');

    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items.length, 1, 'item created');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
