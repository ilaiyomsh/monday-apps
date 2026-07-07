// Edge — Google returns HTTP 410 Gone when the syncToken is no longer valid.
// In the v3 (revised) architecture there is NO fallback fire: the webhook
// logs an error, returns 200, leaves the stored syncToken untouched, and
// fires no triggers. The next successful sync will pick up the backlog.
// This test asserts graceful degradation: 200 status, events.list was
// actually attempted, no relay entries were produced.
import { setupE2e, fireWebhook } from '../../../lib/e2e-setup.js';
import { seedEvents, getMockState, snapshotRelayCount } from '../../../lib/e2e-helper.js';
import { postJson } from '../../../lib/http.js';
import { buildGoogleEvent } from '../../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/edge/sync-token-expired', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/edge/sync-token-expired');

  const ts = Date.now();
  const eventId = `test-evt-410-${ts}`;
  r.record('eventId', eventId);

  const ctx = await setupE2e({ scenarioName: 'edge-sync-token-expired' });
  try {
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({
        id: eventId, summary: `test-410-${ts}`,
        start: new Date(ts + 3600_000).toISOString(),
        end: new Date(ts + 2 * 3600_000).toISOString(),
      }),
    ]);
    await postJson(`${ctx.mock.baseUrl}/admin/force-410-next`, {});

    const beforeCount = await snapshotRelayCount(ctx.mock.baseUrl);
    const wh = await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    r.assertEq(wh.status, 200, 'webhook returned 200 even with 410 from Google');

    // Wait long enough for a relay to arrive IF one were going to arrive.
    await new Promise((res) => setTimeout(res, 1500));
    const state = await getMockState(ctx.mock.baseUrl);

    const sawList = state.recentRequests.some(
      (req) => req.method === 'GET' && req.path.includes('/calendar/v3/calendars/primary/events')
    );
    r.assert(sawList, 'mock saw an events.list call (which returned 410)');

    const afterCount = state.recentRelays?.length || 0;
    r.assertEq(afterCount, beforeCount, 'no relay fired (no fallback — webhook drops silently)');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
