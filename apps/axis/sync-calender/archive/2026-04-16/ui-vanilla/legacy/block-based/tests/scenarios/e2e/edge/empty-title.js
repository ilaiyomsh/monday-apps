// Edge — Google allows events without a summary. The action falls back to
// '(no title)' when itemName is empty (see resolvedName in actions.js).
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/edge/empty-title', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/empty-title');

  const ts = Date.now();
  const eventId = `test-evt-empty-title-${ts}`;
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'edge-empty-title' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({
        id: eventId, summary: '',
        start: new Date(ts + 3600_000).toISOString(),
        end: new Date(ts + 2 * 3600_000).toISOString(),
      }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relay = await waitForRelay(ctx.mock.baseUrl, { eventId });
    r.assert(!!relay, 'relay fired for empty-title event');

    // The relay's mapping uses eventName (which is '') for itemName.
    // The action falls back to '(no title)' when itemName is falsy.
    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: '(no title)',
    });
    r.assert(items.length >= 1, 'an item named "(no title)" appeared on board');
    if (items[0]) r.record('itemId', items[0].id);
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
