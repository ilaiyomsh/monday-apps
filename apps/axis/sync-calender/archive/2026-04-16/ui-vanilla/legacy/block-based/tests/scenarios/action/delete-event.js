// Tier 1 — create an item, then re-invoke the action with eventStatus='cancelled'.
// Asserts the item is deleted from the board.
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, waitForItemGone } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/delete-event', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/delete-event');

  const ts = Date.now();
  const eventId = `test-evt-del-${ts}`;
  const itemName = `test-delete-${ts}`;
  r.record('eventId', eventId);

  // Create
  const res1 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({ cfg, eventId, itemName, item: {} }),
  });
  r.assertEq(res1.status, 200, 'create returned 200');
  const items1 = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName,
  });
  r.assertEq(items1.length, 1, 'item exists after create');
  r.record('itemId', items1[0]?.id);

  // Delete (eventStatus='cancelled')
  const res2 = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({ cfg, eventId, eventStatus: 'cancelled', itemName, item: {} }),
  });
  r.assertEq(res2.status, 200, 'cancelled invocation returned 200');

  const gone = await waitForItemGone({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName, timeoutMs: 10000,
  });
  r.assert(gone, `item "${itemName}" deleted from board`);

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/delete-event FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/delete-event PASSED  (${summary.passed}/${summary.total})`);
}
