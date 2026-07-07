// E2E — create event → change start time → re-fire webhook → date column updates.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { waitFor } from '../../lib/http.js';

export async function run() {
  const runCtx = startRun('e2e/update-time-via-webhook', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/update-time-via-webhook');

  const ts = Date.now();
  const eventId = `test-evt-wh-time-${ts}`;
  const itemName = `test-wh-time-${ts}`;
  const startV1 = new Date(ts + 3600_000).toISOString();
  const startV2 = new Date(ts + 5 * 3600_000).toISOString();
  const endIso = new Date(ts + 6 * 3600_000).toISOString();
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'update-time-via-webhook' });
  try {
    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: itemName, start: startV1, end: endIso })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items1 = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items1.length, 1, 'initial item created');
    const originalId = items1[0]?.id;

    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: itemName, start: startV2, end: endIso })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });

    const expectedTime = startV2.substring(11, 19);
    const updated = await waitFor(async () => {
      const items = await waitForItemByName({
        token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName, timeoutMs: 2000,
      });
      const parsed = parseColumnValue(getColumn(items[0], ctx.cfg.dateColumnId));
      return parsed?.time === expectedTime ? { items, parsed } : null;
    }, { timeoutMs: 10000, intervalMs: 500 });
    r.assert(!!updated, `date column updated to ${expectedTime}`);
    if (updated) r.assertEq(updated.items[0]?.id, originalId, 'itemId unchanged');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
