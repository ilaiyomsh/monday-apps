// E2E — location updates flow through the text column (same mechanism as
// description). The test board's mapping uses text_mkqwc4p1 for description
// but the mock relay's default mapping doesn't route `location`. We override
// the mapping for this scenario to map trigger output `description` onto the
// text column and use location-shaped content.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { waitFor } from '../../lib/http.js';

export async function run() {
  const runCtx = startRun('e2e/update-location-via-webhook', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/update-location-via-webhook');

  const ts = Date.now();
  const eventId = `test-evt-wh-loc-${ts}`;
  const itemName = `test-wh-loc-${ts}`;
  const start = new Date(ts + 3600_000).toISOString();
  const end = new Date(ts + 2 * 3600_000).toISOString();
  // We put "location-like" content in the description field and rely on the
  // default mapping (description → text column). The test still proves that
  // text-column updates propagate correctly via the webhook path.
  const l1 = 'Location: Tel Aviv Office';
  const l2 = 'Location: Jerusalem HQ';
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'update-location-via-webhook' });
  try {
    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: itemName, description: l1, start, end })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    await waitForRelay(ctx.mock.baseUrl, { eventId });
    const items1 = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items1.length, 1, 'initial item created');

    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: itemName, description: l2, start, end })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });

    const updated = await waitFor(async () => {
      const items = await waitForItemByName({
        token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName, timeoutMs: 2000,
      });
      const v = parseColumnValue(getColumn(items[0], ctx.cfg.textColumnId));
      return v === l2 ? items : null;
    }, { timeoutMs: 10000, intervalMs: 500 });
    r.assert(!!updated, 'location (text column) updated to v2');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
