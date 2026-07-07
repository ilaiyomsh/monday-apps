// E2E — user is invited but hasn't responded (needsAction). shouldSync=false,
// event.status=confirmed, not declined → webhook should SKIP (no trigger
// fired), no item created.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, assertNoRelay, waitForItemByName } from '../../lib/e2e-helper.js';
import { needsActionInvite } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/invited-no-response', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/invited-no-response');

  const ts = Date.now();
  const eventId = `test-evt-needs-${ts}`;
  const itemName = `test-needs-action-${ts}`;
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'invited-no-response' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      needsActionInvite({
        id: eventId,
        summary: itemName,
        start: new Date(ts + 3600_000).toISOString(),
        end: new Date(ts + 2 * 3600_000).toISOString(),
      }),
    ]);

    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assertEq(wh.status, 200, 'webhook 200');

    const noRelay = await assertNoRelay(ctx.mock.baseUrl);
    r.assert(noRelay, 'no trigger fired (event was skipped)');

    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName, timeoutMs: 1500,
    });
    r.assertEq(items.length, 0, 'no item created on board');
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
