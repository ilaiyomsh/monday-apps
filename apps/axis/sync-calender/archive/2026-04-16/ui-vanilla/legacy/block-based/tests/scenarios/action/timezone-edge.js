// Tier 1 — create an event at Israel 23:45 (+03:00), which is UTC 20:45 the
// SAME DAY. Verifies normalizeColumnValue converts to UTC correctly AND the
// stored date doesn't flip a day forward (which would happen if we naively
// stripped the wall time).
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/timezone-edge', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/timezone-edge');

  const ts = Date.now();
  const eventId = `test-evt-tz-${ts}`;
  const itemName = `test-timezone-${ts}`;

  // Israel 23:45 = UTC 20:45, same date.
  // Use a future date so it's realistic (not before now).
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dateStr = tomorrow.toISOString().substring(0, 10); // YYYY-MM-DD
  const startIsoIsrael = `${dateStr}T23:45:00+03:00`;
  // Expected UTC: same date, time 20:45:00
  const expectedDate = dateStr;
  const expectedTime = '20:45:00';

  r.record('eventId', eventId);
  r.record('startIsoIsrael', startIsoIsrael);
  r.record('expectedDateUtc', expectedDate);
  r.record('expectedTimeUtc', expectedTime);

  const res = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName,
      item: { [cfg.dateColumnId]: startIsoIsrael },
    }),
  });
  r.assertEq(res.status, 200, 'action returned 200');

  const items = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName,
  });
  r.assertEq(items.length, 1, 'item created');
  if (items[0]) {
    r.record('itemId', items[0].id);
    const date = parseColumnValue(getColumn(items[0], cfg.dateColumnId));
    r.assertEq(date?.date, expectedDate, 'date column stored same day (no flip forward)');
    r.assertEq(date?.time, expectedTime, 'date column time is UTC 20:45:00');
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/timezone-edge FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/timezone-edge PASSED  (${summary.passed}/${summary.total})`);
}
