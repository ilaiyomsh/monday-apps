// Tier 1 — invoke the action with eventStatus='cancelled' for an eventId that
// was never previously created. Asserts the server returns 200 no-op (no
// crash, no stray item created).
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/cancelled-no-item', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/cancelled-no-item');

  const ts = Date.now();
  const eventId = `test-evt-cancel-noop-${ts}`;
  const itemName = `test-cancel-noop-${ts}`;
  r.record('eventId', eventId);

  const res = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({ cfg, eventId, eventStatus: 'cancelled', itemName, item: {} }),
  });
  r.assertEq(res.status, 200, 'cancelled-no-item returned 200');

  // Ensure no item with this name ended up on the board.
  // Give monday a second to stabilize then confirm.
  await new Promise((r) => setTimeout(r, 1500));
  const items = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName, timeoutMs: 1500,
  });
  r.assertEq(items.length, 0, 'no item was created');

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/cancelled-no-item FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/cancelled-no-item PASSED  (${summary.passed}/${summary.total})`);
}
