// E2E — user accepts (item created) → event cancelled (organizer cancelled the
// meeting or deleted it). event.status becomes 'cancelled'. webhook fires
// trigger with eventStatus='cancelled'; action deletes the item.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName, waitForItemGone, snapshotRelayCount, waitForRelayAfter } from '../../lib/e2e-helper.js';
import { acceptedInvite } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/accept-then-cancel-event', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/accept-then-cancel-event');

  const ts = Date.now();
  const eventId = `test-evt-acc-can-${ts}`;
  const itemName = `test-acc-cancel-${ts}`;
  const startIso = new Date(ts + 3600_000).toISOString();
  const endIso = new Date(ts + 2 * 3600_000).toISOString();
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'accept-then-cancel-event' });
  try {
    // Phase 1 — accept, item created
    await seedEvents(ctx.mock.baseUrl, [
      acceptedInvite({ id: eventId, summary: itemName, start: startIso, end: endIso }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items1 = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items1.length, 1, 'item created after accept');

    // Phase 2 — event cancelled by organizer
    const beforePhase2 = await snapshotRelayCount(ctx.mock.baseUrl);
    await seedEvents(ctx.mock.baseUrl, [
      acceptedInvite({ id: eventId, status: 'cancelled', summary: itemName, start: startIso, end: endIso }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relay = await waitForRelayAfter(ctx.mock.baseUrl, { eventId, sinceCount: beforePhase2, timeoutMs: 6000 });
    r.assert(!!relay, 'relay fired for cancelled event');
    r.assertEq(relay?.cachedContext?.eventStatus, 'cancelled', 'eventStatus=cancelled');

    const gone = await waitForItemGone({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assert(gone, 'item deleted from board');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
