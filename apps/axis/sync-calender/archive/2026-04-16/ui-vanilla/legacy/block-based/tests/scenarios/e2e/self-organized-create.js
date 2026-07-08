// E2E — user creates their own event (no attendees). shouldSync returns true
// (no attendees ⇒ sync); webhook should fire trigger; action creates item.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/self-organized-create', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/self-organized-create');

  const ts = Date.now();
  const eventId = `test-evt-self-${ts}`;
  const itemName = `test-self-organized-${ts}`;
  const startIso = new Date(ts + 60 * 60 * 1000).toISOString();
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'self-organized-create' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({
        id: eventId,
        summary: itemName,
        description: 'I own this event',
        start: startIso,
        end: new Date(ts + 2 * 3600 * 1000).toISOString(),
      }),
    ]);

    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assertEq(wh.status, 200, 'webhook 200');

    const relay = await waitForRelay(ctx.mock.baseUrl, { eventId });
    r.assert(!!relay, 'relay forwarded');
    r.assertEq(relay?.cachedContext?.eventStatus, 'confirmed', 'status=confirmed');
    r.assertEq(relay?.forwardedStatus, 200, 'action returned 200');

    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items.length, 1, `item "${itemName}" exists on board`);
    if (items[0]) r.record('itemId', items[0].id);
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
