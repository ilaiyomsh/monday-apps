// Tier 1 — create an item, then invoke the action again with the same eventId
// but a different itemName. Monday should UPDATE the existing item (same id),
// not create a duplicate.
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, waitForItemGone } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/update-title', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/update-title');

  const ts = Date.now();
  const eventId = `test-evt-upd-title-${ts}`;
  const nameV1 = `test-update-title-${ts}-v1`;
  const nameV2 = `test-update-title-${ts}-v2`;
  r.record('eventId', eventId);

  // Create v1
  const res1 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({ cfg, eventId, itemName: nameV1, item: {} }),
  });
  r.assertEq(res1.status, 200, 'create returned 200');
  const items1 = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: nameV1,
  });
  r.assertEq(items1.length, 1, `item "${nameV1}" exists after create`);
  const originalId = items1[0]?.id;
  r.record('originalItemId', originalId);

  // Update title (same eventId, different itemName)
  const res2 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({ cfg, eventId, itemName: nameV2, item: {} }),
  });
  r.assertEq(res2.status, 200, 'update returned 200');

  const items2 = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: nameV2,
  });
  r.assertEq(items2.length, 1, `item "${nameV2}" exists after update`);
  r.assertEq(items2[0]?.id, originalId, 'itemId is unchanged (update, not new create)');
  r.record('finalItemId', items2[0]?.id);

  // v1 name should no longer exist
  const stillV1 = await waitForItemGone({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: nameV1, timeoutMs: 3000,
  });
  r.assert(stillV1, `old name "${nameV1}" no longer on board`);

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/update-title FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/update-title PASSED  (${summary.passed}/${summary.total})`);
}
