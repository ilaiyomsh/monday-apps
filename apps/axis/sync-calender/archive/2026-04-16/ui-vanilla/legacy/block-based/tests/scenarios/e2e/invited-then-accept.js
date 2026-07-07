// E2E — user invited (needsAction) → no item; later the user accepts and
// Google pushes an update → item is created at acceptance time.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, assertNoRelay, waitForItemByName, getMockState, snapshotRelayCount, waitForRelayAfter } from '../../lib/e2e-helper.js';
import { needsActionInvite, acceptedInvite } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/invited-then-accept', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/invited-then-accept');

  const ts = Date.now();
  const eventId = `test-evt-inv-then-${ts}`;
  const itemName = `test-invited-accept-${ts}`;
  const startIso = new Date(ts + 3600_000).toISOString();
  const endIso = new Date(ts + 2 * 3600_000).toISOString();
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'invited-then-accept' });
  try {
    // Phase 1 — invited, no response
    await seedEvents(ctx.mock.baseUrl, [
      needsActionInvite({ id: eventId, summary: itemName, start: startIso, end: endIso }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const noRelay = await assertNoRelay(ctx.mock.baseUrl);
    r.assert(noRelay, 'phase 1: no relay (needsAction skipped)');
    const phase1Items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName, timeoutMs: 1500,
    });
    r.assertEq(phase1Items.length, 0, 'phase 1: no item on board yet');

    // Phase 2 — user accepts; mock returns the updated event
    const beforePhase2 = await snapshotRelayCount(ctx.mock.baseUrl);
    await seedEvents(ctx.mock.baseUrl, [
      acceptedInvite({ id: eventId, summary: itemName, start: startIso, end: endIso }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relay = await waitForRelayAfter(ctx.mock.baseUrl, { eventId, sinceCount: beforePhase2 });
    r.assert(!!relay, 'phase 2: relay fired after acceptance');
    r.assertEq(relay?.cachedContext?.eventStatus, 'confirmed', 'phase 2: status=confirmed');

    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items.length, 1, 'phase 2: item created upon acceptance');
    if (items[0]) r.record('itemId', items[0].id);
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
