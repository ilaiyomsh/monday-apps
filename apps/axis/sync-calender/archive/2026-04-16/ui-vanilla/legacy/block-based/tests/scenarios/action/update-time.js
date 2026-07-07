// Tier 1 — create an item, then update its date column by sending a new
// startDate. Asserts the date column value reflects the new UTC-converted time
// and the same itemId.
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { waitFor } from '../../lib/http.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/update-time', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/update-time');

  const ts = Date.now();
  const eventId = `test-evt-upd-time-${ts}`;
  const itemName = `test-update-time-${ts}`;
  const startIsoV1 = new Date(ts + 60 * 60 * 1000).toISOString();
  const startIsoV2 = new Date(ts + 3 * 60 * 60 * 1000).toISOString();
  r.record('eventId', eventId);
  r.record('startIsoV1', startIsoV1);
  r.record('startIsoV2', startIsoV2);

  const res1 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName, item: { [cfg.dateColumnId]: startIsoV1 },
    }),
  });
  r.assertEq(res1.status, 200, 'create returned 200');
  const items1 = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName,
  });
  r.assertEq(items1.length, 1, 'item exists after create');
  const originalId = items1[0]?.id;
  r.record('itemId', originalId);
  const v1Date = parseColumnValue(getColumn(items1[0], cfg.dateColumnId));
  r.assertEq(v1Date?.time, startIsoV1.substring(11, 19), 'v1 date column has initial UTC time');

  // Update start time
  const res2 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName, item: { [cfg.dateColumnId]: startIsoV2 },
    }),
  });
  r.assertEq(res2.status, 200, 'update returned 200');

  // Re-query item; wait for the date column to reflect v2.
  const expectedV2Time = startIsoV2.substring(11, 19);
  const updated = await waitFor(async () => {
    const items = await waitForItemByName({
      token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName, timeoutMs: 2000,
    });
    const parsed = parseColumnValue(getColumn(items[0], cfg.dateColumnId));
    return parsed?.time === expectedV2Time ? { items, parsed } : null;
  }, { timeoutMs: 8000, intervalMs: 500 });
  r.assert(!!updated, `date column updated to ${expectedV2Time}`);
  if (updated) {
    r.assertEq(updated.items[0]?.id, originalId, 'itemId unchanged (update, not new create)');
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/update-time FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/update-time PASSED  (${summary.passed}/${summary.total})`);
}
