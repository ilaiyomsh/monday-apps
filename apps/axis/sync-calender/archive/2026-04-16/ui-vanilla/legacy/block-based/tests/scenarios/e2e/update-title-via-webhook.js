// E2E — create event → change title → re-fire webhook → item renamed.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName, waitForItemGone } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/update-title-via-webhook', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/update-title-via-webhook');

  const ts = Date.now();
  const eventId = `test-evt-wh-title-${ts}`;
  const nameV1 = `test-wh-title-${ts}-v1`;
  const nameV2 = `test-wh-title-${ts}-v2`;
  const startIso = new Date(ts + 3600_000).toISOString();
  const endIso = new Date(ts + 2 * 3600_000).toISOString();
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'update-title-via-webhook' });
  try {
    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: nameV1, start: startIso, end: endIso })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items1 = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: nameV1,
    });
    r.assertEq(items1.length, 1, 'v1 item created');
    const originalId = items1[0]?.id;

    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: nameV2, start: startIso, end: endIso })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });

    const items2 = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: nameV2,
    });
    r.assertEq(items2.length, 1, 'v2 item found by new name');
    r.assertEq(items2[0]?.id, originalId, 'itemId unchanged');
    const v1Gone = await waitForItemGone({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: nameV1, timeoutMs: 4000,
    });
    r.assert(v1Gone, 'v1 name no longer present');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
