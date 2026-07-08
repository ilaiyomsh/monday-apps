// E2E — user was invited and accepted (self.responseStatus='accepted');
// webhook fires trigger and action creates item.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../lib/e2e-helper.js';
import { acceptedInvite } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/accepted-create', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/accepted-create');

  const ts = Date.now();
  const eventId = `test-evt-accept-${ts}`;
  const itemName = `test-accepted-${ts}`;
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'accepted-create' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      acceptedInvite({
        id: eventId,
        summary: itemName,
        description: 'invited and accepted',
        start: new Date(ts + 3600_000).toISOString(),
        end: new Date(ts + 2 * 3600_000).toISOString(),
      }),
    ]);

    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assertEq(wh.status, 200, 'webhook 200');

    const relay = await waitForRelay(ctx.mock.baseUrl, { eventId });
    r.assert(!!relay, 'relay forwarded');

    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items.length, 1, `item "${itemName}" created`);
    if (items[0]) r.record('itemId', items[0].id);
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1; return;
  }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
