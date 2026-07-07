// Edge — Israel DST transitions last Sunday of March (+02:00 → +03:00) and
// last Sunday of October (+03:00 → +02:00). Google sends ISO strings with the
// correct offset; Date parsing + toISOString converts to UTC robustly. Assert
// the UTC time the server stores matches what `new Date().toISOString()` would
// produce for that wall-clock moment.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';
import { getColumn, parseColumnValue } from '../../../lib/action-helper.js';

export async function run() {
  const runCtx = startRun('e2e/edge/dst-boundary', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/dst-boundary');

  const ts = Date.now();
  const eventId = `test-evt-dst-${ts}`;
  const itemName = `test-dst-${ts}`;
  // Israel switches from +02:00 to +03:00 on last Sunday of March.
  // Using 2026-03-27 03:30 +03:00 = 00:30 UTC same day (after DST kick-in).
  const startIso = '2026-03-27T03:30:00+03:00';
  const expectedUtcDate = '2026-03-27';
  const expectedUtcTime = '00:30:00';
  r.record('eventId', eventId);
  r.record('startIso', startIso);

  const ctx = await setupE2e({ scenarioName: 'edge-dst-boundary' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({
        id: eventId, summary: itemName,
        start: startIso, end: '2026-03-27T04:30:00+03:00',
      }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relay = await waitForRelay(ctx.mock.baseUrl, { eventId });
    r.assert(!!relay, 'relay fired');

    const items = await waitForItemByName({
      token: ctx.cfg.mondayApiToken, boardId: ctx.cfg.boardId, name: itemName,
    });
    r.assertEq(items.length, 1, 'item created');
    if (items[0]) {
      const date = parseColumnValue(getColumn(items[0], ctx.cfg.dateColumnId));
      r.assertEq(date?.date, expectedUtcDate, 'date is UTC-converted');
      r.assertEq(date?.time, expectedUtcTime, 'time is UTC-converted');
    }
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
