// E2E — one webhook delivers an event; then another webhook delivers the
// same event with title + time + description all changed. Assert the
// existing item is updated in all three aspects.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { waitFor } from '../../lib/http.js';

export async function run() {
  const runCtx = startRun('e2e/update-multiple-via-webhook', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/update-multiple-via-webhook');

  const ts = Date.now();
  const eventId = `test-evt-wh-multi-${ts}`;
  const nameV1 = `test-wh-multi-${ts}-v1`;
  const nameV2 = `test-wh-multi-${ts}-v2`;
  const startV1 = new Date(ts + 3600_000).toISOString();
  const startV2 = new Date(ts + 5 * 3600_000).toISOString();
  const end = new Date(ts + 6 * 3600_000).toISOString();
  const descV1 = 'v1 description';
  const descV2 = 'v2 description';
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'update-multiple-via-webhook' });
  try {
    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({
      id: eventId, summary: nameV1, description: descV1, start: startV1, end,
    })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items1 = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: nameV1,
    });
    r.assertEq(items1.length, 1, 'v1 item created');
    const originalId = items1[0]?.id;

    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({
      id: eventId, summary: nameV2, description: descV2, start: startV2, end,
    })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });

    const expectedTime = startV2.substring(11, 19);
    const updated = await waitFor(async () => {
      const items = await waitForItemByName({
        token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: nameV2, timeoutMs: 2000,
      });
      if (items.length === 0) return null;
      const d = parseColumnValue(getColumn(items[0], ctx.cfg.dateColumnId));
      const t = parseColumnValue(getColumn(items[0], ctx.cfg.textColumnId));
      return d?.time === expectedTime && t === descV2 ? items : null;
    }, { timeoutMs: 15000, intervalMs: 500 });
    r.assert(!!updated, 'name + date + description all reflect v2');
    if (updated) r.assertEq(updated[0]?.id, originalId, 'itemId unchanged');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
