// Tier 1 — create an item, then in one action invocation update the title,
// date, and description together. Proves multi-column updates land atomically.
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { waitFor } from '../../lib/http.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/update-multiple', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/update-multiple');

  const ts = Date.now();
  const eventId = `test-evt-upd-multi-${ts}`;
  const nameV1 = `test-update-multi-${ts}-v1`;
  const nameV2 = `test-update-multi-${ts}-v2`;
  const startV1 = new Date(ts + 60 * 60 * 1000).toISOString();
  const startV2 = new Date(ts + 4 * 60 * 60 * 1000).toISOString();
  const descV1 = 'initial';
  const descV2 = 'everything changed';
  r.record('eventId', eventId);

  // Create v1
  const res1 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName: nameV1,
      item: { [cfg.dateColumnId]: startV1, [cfg.textColumnId]: descV1 },
    }),
  });
  r.assertEq(res1.status, 200, 'create returned 200');
  const items1 = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: nameV1,
  });
  r.assertEq(items1.length, 1, 'item created with v1 values');
  const originalId = items1[0]?.id;
  r.record('itemId', originalId);

  // Update everything at once
  const res2 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName: nameV2,
      item: { [cfg.dateColumnId]: startV2, [cfg.textColumnId]: descV2 },
    }),
  });
  r.assertEq(res2.status, 200, 'update returned 200');

  // Verify v2 — title, date, description all reflect new values, same itemId
  const expectedTime = startV2.substring(11, 19);
  const updated = await waitFor(async () => {
    const items = await waitForItemByName({
      token: cfg.mondayApiToken, boardId: cfg.boardId, name: nameV2, timeoutMs: 2000,
    });
    if (items.length === 0) return null;
    const date = parseColumnValue(getColumn(items[0], cfg.dateColumnId));
    const text = parseColumnValue(getColumn(items[0], cfg.textColumnId));
    return date?.time === expectedTime && text === descV2 ? { items, date, text } : null;
  }, { timeoutMs: 10000, intervalMs: 500 });
  r.assert(!!updated, 'all three columns reflect v2 values');
  if (updated) {
    r.assertEq(updated.items[0]?.id, originalId, 'itemId unchanged');
    r.record('finalItemId', updated.items[0]?.id);
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/update-multiple FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/update-multiple PASSED  (${summary.passed}/${summary.total})`);
}
