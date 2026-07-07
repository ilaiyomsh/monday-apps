// Edge — Google delivers a webhook for an event that was created+deleted
// before our server got around to fetching. listChanges returns the event
// with status='cancelled'. Webhook should fire trigger with eventStatus=
// 'cancelled'; action looks up by URL, finds nothing, no-op (no crash).
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/edge/event-already-deleted', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/event-already-deleted');

  const ts = Date.now();
  const eventId = `test-evt-pre-del-${ts}`;
  const itemName = `test-pre-del-${ts}`;
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'edge-event-already-deleted' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      // Event already cancelled — no prior item exists in monday.
      buildGoogleEvent({
        id: eventId, status: 'cancelled', summary: itemName,
        start: new Date(ts + 3600_000).toISOString(),
        end: new Date(ts + 2 * 3600_000).toISOString(),
      }),
    ]);
    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assertEq(wh.status, 200, 'webhook 200');
    const relay = await waitForRelay(ctx.mock.baseUrl, { eventId });
    r.assert(!!relay, 'relay fired (cancelled events are forwarded)');
    r.assertEq(relay?.cachedContext?.eventStatus, 'cancelled', 'eventStatus=cancelled');
    r.assertEq(relay?.forwardedStatus, 200, 'action returned 200 (no-op delete)');

    // No item created.
    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName, timeoutMs: 1500,
    });
    r.assertEq(items.length, 0, 'no item created (cancelled with no prior item)');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
