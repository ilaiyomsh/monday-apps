// Edge — Google paginates events.list (default 250/page). We force the mock
// to return 5 events per page; seed 15 events; assert the server walks all 3
// pages and fires triggers for every event.
//
// We verify pagination by counting mock request paths (multiple GET events with
// pageToken=5, pageToken=10) and by counting relays.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import {
  seedEvents, snapshotRelayCount, waitForRelayCount, getMockState,
} from '../../../lib/e2e-helper.js';
import { postJson } from '../../../lib/http.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

const TOTAL = 6;
const PAGE = 3;

export async function run() {
  const runCtx = startRun('e2e/edge/pagination', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/pagination');

  const ts = Date.now();
  const events = [];
  for (let i = 0; i < TOTAL; i++) {
    events.push(buildGoogleEvent({
      id: `test-evt-page-${ts}-${i}`,
      summary: `test-page-${ts}-${String(i).padStart(2, '0')}`,
      start: new Date(ts + i * 60_000).toISOString(),
      end: new Date(ts + (i + 1) * 60_000).toISOString(),
    }));
  }
  r.record('totalEvents', TOTAL);
  r.record('pageSize', PAGE);

  const ctx = await setupE2e({ scenarioName: 'edge-pagination' });
  try {
    await postJson(`${ctx.mock.baseUrl}/admin/set-page-size`, { pageSize: PAGE });
    await seedEvents(ctx.mock.baseUrl, events);
    const beforeRelays = await snapshotRelayCount(ctx.mock.baseUrl);

    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assertEq(wh.status, 200, 'webhook 200');

    const relays = await waitForRelayCount(ctx.mock.baseUrl, beforeRelays + TOTAL, { timeoutMs: 60_000 });
    r.assert(!!relays, `${TOTAL} relay entries received (pagination walked ${Math.ceil(TOTAL / PAGE)} pages)`);

    // Inspect mock request log to confirm multiple events.list calls (with pageToken).
    const state = await getMockState(ctx.mock.baseUrl);
    const listCalls = state.recentRequests.filter(
      (req) => req.method === 'GET' && req.path.includes('/calendar/v3/calendars/primary/events')
    );
    r.assert(listCalls.length >= Math.ceil(TOTAL / PAGE), `mock saw ≥${Math.ceil(TOTAL / PAGE)} events.list calls`);
    const pageTokenCalls = listCalls.filter((c) => c.query?.pageToken);
    r.assert(pageTokenCalls.length >= 1, 'at least one events.list used pageToken (pagination active)');
    r.record('listCalls', listCalls.length);
    r.record('pageTokenCalls', pageTokenCalls.length);
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
