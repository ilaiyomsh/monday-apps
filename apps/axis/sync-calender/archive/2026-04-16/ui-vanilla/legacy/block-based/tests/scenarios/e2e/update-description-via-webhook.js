import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { waitFor } from '../../lib/http.js';

export async function run() {
  const runCtx = startRun('e2e/update-description-via-webhook', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/update-description-via-webhook');

  const ts = Date.now();
  const eventId = `test-evt-wh-desc-${ts}`;
  const itemName = `test-wh-desc-${ts}`;
  const start = new Date(ts + 3600_000).toISOString();
  const end = new Date(ts + 2 * 3600_000).toISOString();
  const d1 = 'description v1';
  const d2 = 'description v2 — changed';
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'update-description-via-webhook' });
  try {
    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: itemName, description: d1, start, end })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items1 = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items1.length, 1, 'item created with description v1');
    const originalId = items1[0]?.id;

    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: itemName, description: d2, start, end })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });

    const updated = await waitFor(async () => {
      const items = await waitForItemByName({
        token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName, timeoutMs: 2000,
      });
      const parsed = parseColumnValue(getColumn(items[0], ctx.cfg.textColumnId));
      return parsed === d2 ? items : null;
    }, { timeoutMs: 10000, intervalMs: 500 });
    r.assert(!!updated, 'description updated to v2');
    if (updated) r.assertEq(updated[0]?.id, originalId, 'itemId unchanged');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
