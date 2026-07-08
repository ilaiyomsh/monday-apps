// Edge — event at exactly 00:00:00Z. Verify date column stores 00:00:00 with
// the correct date.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';
import { getColumn, parseColumnValue } from '../../../lib/action-helper.js';

export async function run() {
  const runCtx = startRun('e2e/edge/utc-midnight', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/utc-midnight');

  const ts = Date.now();
  const eventId = `test-evt-mid-${ts}`;
  const itemName = `test-utc-midnight-${ts}`;
  const startIso = '2026-06-14T00:00:00Z';
  const endIso = '2026-06-14T01:00:00Z';
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'edge-utc-midnight' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({ id: eventId, summary: itemName, start: startIso, end: endIso }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items.length, 1, 'item created');
    if (items[0]) {
      const date = parseColumnValue(getColumn(items[0], ctx.cfg.dateColumnId));
      r.assertEq(date?.date, '2026-06-14', 'date column has 2026-06-14');
      r.assertEq(date?.time, '00:00:00', 'date column has 00:00:00');
    }
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
