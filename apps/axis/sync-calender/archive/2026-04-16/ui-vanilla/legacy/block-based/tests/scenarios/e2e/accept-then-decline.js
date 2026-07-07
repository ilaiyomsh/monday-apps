// E2E — user accepts (item created) → later declines (item should be
// deleted). Before R8 fix, the webhook skipped declined events entirely,
// leaving stale items. R8 fix: treat self.responseStatus='declined' as a
// cancellation signal so the action removes the item.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName, waitForItemGone, snapshotRelayCount, waitForRelayAfter } from '../../lib/e2e-helper.js';
import { acceptedInvite, declinedInvite } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/accept-then-decline', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/accept-then-decline');

  const ts = Date.now();
  const eventId = `test-evt-acc-dec-${ts}`;
  const itemName = `test-acc-dec-${ts}`;
  const startIso = new Date(ts + 3600_000).toISOString();
  const endIso = new Date(ts + 2 * 3600_000).toISOString();
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'accept-then-decline' });
  try {
    // Phase 1 — accept
    await seedEvents(ctx.mock.baseUrl, [
      acceptedInvite({ id: eventId, summary: itemName, start: startIso, end: endIso }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items1 = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items1.length, 1, 'phase 1: item created after accept');
    const itemId = items1[0]?.id;
    r.record('createdItemId', itemId);

    // Phase 2 — decline. Snapshot first so we only look at NEW relays.
    const beforePhase2 = await snapshotRelayCount(ctx.mock.baseUrl);
    await seedEvents(ctx.mock.baseUrl, [
      declinedInvite({ id: eventId, summary: itemName, start: startIso, end: endIso }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });

    const relay = await waitForRelayAfter(ctx.mock.baseUrl, { eventId, sinceCount: beforePhase2, timeoutMs: 6000 });
    r.assert(!!relay, 'phase 2: relay fired for declined event (R8 fix active)');
    r.assertEq(relay?.cachedContext?.eventStatus, 'cancelled', 'phase 2: eventStatus remapped to cancelled');

    const gone = await waitForItemGone({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName, timeoutMs: 10000,
    });
    r.assert(gone, 'phase 2: item deleted from board');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
