// Edge — Google sometimes pings the webhook even when nothing has changed.
// listChanges returns an empty items array. Webhook should fire 0 triggers
// and return 200.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, snapshotRelayCount, getMockState } from '../../../lib/e2e-helper.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/edge/empty-changes', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/empty-changes');

  const ctx = await setupE2e({ scenarioName: 'edge-empty-changes' });
  try {
    await seedEvents(ctx.mock.baseUrl, []); // explicit empty
    const before = await snapshotRelayCount(ctx.mock.baseUrl);
    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assertEq(wh.status, 200, 'webhook 200 on empty changes');
    await new Promise((r) => setTimeout(r, 1500));
    const after = await snapshotRelayCount(ctx.mock.baseUrl);
    r.assertEq(after, before, 'no relay fired (no events to broadcast)');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
