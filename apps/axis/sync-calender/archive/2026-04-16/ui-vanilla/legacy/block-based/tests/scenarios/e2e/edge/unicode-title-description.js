// Edge — Hebrew + emoji round-trip through Google → server → monday.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';
import { getColumn, parseColumnValue } from '../../../lib/action-helper.js';

export async function run() {
  const runCtx = startRun('e2e/edge/unicode-title-description', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/unicode-title-description');

  const ts = Date.now();
  const eventId = `test-evt-uni-${ts}`;
  const itemName = `test-uni-${ts} 🎉 שלום עולם`;
  const desc = 'תיאור עם 中文 ועברית 🚀\nשורה שנייה';
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'edge-unicode' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({
        id: eventId, summary: itemName, description: desc,
        start: new Date(ts + 3600_000).toISOString(),
        end: new Date(ts + 2 * 3600_000).toISOString(),
      }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items.length, 1, 'unicode itemName preserved');
    if (items[0]) {
      const text = parseColumnValue(getColumn(items[0], ctx.cfg.textColumnId));
      r.assertEq(text, desc, 'unicode description preserved (incl. newlines + emoji)');
    }
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
