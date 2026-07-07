// Tier 1 — create a new event via the action endpoint; verify item exists on
// board with link column URL and UTC-converted date.
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/create-event', 'action');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: action/create-event');

  const ts = Date.now();
  const eventId = `test-evt-create-${ts}`;
  const itemName = `test-create-${ts}`;
  const startIso = new Date(ts + 60 * 60 * 1000).toISOString(); // +1h, uses UTC Z

  r.record('eventId', eventId);
  r.record('itemName', itemName);
  r.record('startIso', startIso);

  const res = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName,
      item: { [cfg.dateColumnId]: startIso },
    }),
  });
  r.assertEq(res.status, 200, 'action returned 200');
  r.record('responseBody', res.text);

  const items = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName,
  });
  r.assertEq(items.length, 1, `exactly one item named "${itemName}"`);
  if (items[0]) {
    r.record('itemId', items[0].id);
    const link = getColumn(items[0], cfg.linkColumnId);
    r.assert(!!link, `item has link column ${cfg.linkColumnId}`);
    if (link) {
      const parsed = parseColumnValue(link);
      r.assert(parsed?.url?.startsWith('https://www.google.com/calendar/event?eid='),
        'link column url is a Google Calendar URL');
      r.assertEq(parsed?.text, parsed?.url, 'link column text equals url (search-friendly)');
      r.record('linkUrl', parsed?.url);
    }
    const date = getColumn(items[0], cfg.dateColumnId);
    r.assert(!!date, 'item has date column');
    if (date) {
      const parsed = parseColumnValue(date);
      const expectedUtcTime = startIso.substring(11, 19); // already UTC Z
      r.assert(/^\d{4}-\d{2}-\d{2}$/.test(parsed?.date || ''), 'date column has YYYY-MM-DD');
      r.assertEq(parsed?.time, expectedUtcTime, 'date column time is UTC-aligned');
    }
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ action/create-event FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ action/create-event PASSED  (${summary.passed}/${summary.total})`);
}
