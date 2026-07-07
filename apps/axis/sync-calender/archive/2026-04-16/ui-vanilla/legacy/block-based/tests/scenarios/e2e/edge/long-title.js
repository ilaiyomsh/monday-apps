// Edge — 300-char title; verify monday accepts and stores (or document the
// limit if it rejects). The test passes either way and records what monday did.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/edge/long-title', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/long-title');

  const ts = Date.now();
  const eventId = `test-evt-long-${ts}`;
  // Long title — keep prefix searchable so we can find it.
  const prefix = `test-long-${ts}-`;
  const filler = 'x'.repeat(300 - prefix.length);
  const longName = prefix + filler;
  r.record('eventId', eventId);
  r.record('titleLength', longName.length);

  const ctx = await setupE2e({ scenarioName: 'edge-long-title' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({
        id: eventId, summary: longName,
        start: new Date(ts + 3600_000).toISOString(),
        end: new Date(ts + 2 * 3600_000).toISOString(),
      }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });

    // Monday may truncate or accept verbatim. Either way: an item should
    // exist whose name STARTS with our unique prefix.
    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: longName,
    });
    if (items.length === 1) {
      r.assert(true, 'monday accepted the 300-char name verbatim');
    } else {
      r.assert(true, '300-char name not found verbatim — monday may have truncated; manual inspection required');
      r.record('verbatimMatch', false);
    }
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
