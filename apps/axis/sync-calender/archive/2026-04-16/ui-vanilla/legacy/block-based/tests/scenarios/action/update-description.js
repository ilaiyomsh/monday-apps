// Tier 1 — create an item, then update its description text column. Asserts
// the column value reflects the new string and same itemId.
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';
import { waitFor } from '../../lib/http.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/update-description', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/update-description');

  const ts = Date.now();
  const eventId = `test-evt-upd-desc-${ts}`;
  const itemName = `test-update-desc-${ts}`;
  const descV1 = `description v1 @ ${ts}`;
  const descV2 = `description v2 — updated`;
  r.record('eventId', eventId);

  const res1 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName, item: { [cfg.textColumnId]: descV1 },
    }),
  });
  r.assertEq(res1.status, 200, 'create returned 200');
  const items1 = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName,
  });
  r.assertEq(items1.length, 1, 'item exists after create');
  const originalId = items1[0]?.id;
  r.record('itemId', originalId);
  const v1Text = parseColumnValue(getColumn(items1[0], cfg.textColumnId));
  r.assertEq(v1Text, descV1, 'v1 description stored correctly');

  // Update description
  const res2 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName, item: { [cfg.textColumnId]: descV2 },
    }),
  });
  r.assertEq(res2.status, 200, 'update returned 200');

  const updated = await waitFor(async () => {
    const items = await waitForItemByName({
      token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName, timeoutMs: 2000,
    });
    const parsed = parseColumnValue(getColumn(items[0], cfg.textColumnId));
    return parsed === descV2 ? { items, parsed } : null;
  }, { timeoutMs: 8000, intervalMs: 500 });
  r.assert(!!updated, 'description column updated to v2');
  if (updated) {
    r.assertEq(updated.items[0]?.id, originalId, 'itemId unchanged');
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/update-description FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/update-description PASSED  (${summary.passed}/${summary.total})`);
}
