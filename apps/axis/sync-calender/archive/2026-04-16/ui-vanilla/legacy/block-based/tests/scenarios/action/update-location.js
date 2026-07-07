// Tier 1 — mirror of update-description but semantically covering "location".
// The test board has a single generic text column (text_mkqwc4p1); in a real
// deployment users map Location to a dedicated column. This scenario
// demonstrates that any text-column mapping is updated correctly.
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { waitFor } from '../../lib/http.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/update-location', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/update-location');

  const ts = Date.now();
  const eventId = `test-evt-upd-loc-${ts}`;
  const itemName = `test-update-location-${ts}`;
  const locV1 = 'Tel Aviv Office';
  const locV2 = 'Jerusalem HQ — 2nd floor';
  r.record('eventId', eventId);

  const res1 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName, item: { [cfg.textColumnId]: locV1 },
    }),
  });
  r.assertEq(res1.status, 200, 'create returned 200');
  const items1 = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName,
  });
  r.assertEq(items1.length, 1, 'item exists after create');
  const originalId = items1[0]?.id;
  r.record('itemId', originalId);
  const v1 = parseColumnValue(getColumn(items1[0], cfg.textColumnId));
  r.assertEq(v1, locV1, 'v1 location stored');

  const res2 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName, item: { [cfg.textColumnId]: locV2 },
    }),
  });
  r.assertEq(res2.status, 200, 'update returned 200');

  const updated = await waitFor(async () => {
    const items = await waitForItemByName({
      token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName, timeoutMs: 2000,
    });
    const parsed = parseColumnValue(getColumn(items[0], cfg.textColumnId));
    return parsed === locV2 ? { items, parsed } : null;
  }, { timeoutMs: 8000, intervalMs: 500 });
  r.assert(!!updated, 'location column updated to v2');
  if (updated) r.assertEq(updated.items[0]?.id, originalId, 'itemId unchanged');

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/update-location FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/update-location PASSED  (${summary.passed}/${summary.total})`);
}
