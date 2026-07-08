// E2E — trigger output includes `duration` (HOURS, decimal, stringified)
// computed from start.dateTime → end.dateTime. Lets the user map Duration to
// a numbers column on the board via the Item Values field.
//
// We fire two webhooks back-to-back on two separate events so one scenario
// covers both a partial-hour case (90 min ⇒ "1.5") and a whole-hour case
// (60 min ⇒ "1"), proving trailing zeros are stripped.
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, snapshotRelayCount, waitForRelayAfter } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/duration-field', 'e2e');
  const r = createRecorder(runCtx);
  console.log('▶ Scenario: e2e/duration-field');

  const ts = Date.now();
  // Event A: 90 minutes → 1.5 hours
  const eventIdA = `test-evt-dur-a-${ts}`;
  const startA = new Date(ts + 3600_000).toISOString();
  const endA = new Date(ts + 3600_000 + 90 * 60_000).toISOString();
  // Event B: 60 minutes → 1 hour
  const eventIdB = `test-evt-dur-b-${ts}`;
  const startB = new Date(ts + 24 * 3600_000).toISOString();
  const endB = new Date(ts + 24 * 3600_000 + 60 * 60_000).toISOString();
  r.record('eventIdA', eventIdA);
  r.record('eventIdB', eventIdB);

  const ctx = await setupE2e({ scenarioName: 'duration-field' });
  try {
    // Fire #1 — partial hour
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({ id: eventIdA, summary: `test-dur-a-${ts}`, start: startA, end: endA }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relayA = await waitForRelay(ctx.mock.baseUrl, { eventId: eventIdA });
    r.assert(!!relayA, 'relay A fired');
    r.assertEq(relayA?.outputFields?.duration, '1.5', '90-minute event → duration="1.5" hours');

    // Fire #2 — whole hour
    const before = await snapshotRelayCount(ctx.mock.baseUrl);
    await seedEvents(ctx.mock.baseUrl, [
      buildGoogleEvent({ id: eventIdB, summary: `test-dur-b-${ts}`, start: startB, end: endB }),
    ]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relayB = await waitForRelayAfter(ctx.mock.baseUrl, { eventId: eventIdB, sinceCount: before });
    r.assert(!!relayB, 'relay B fired');
    r.assertEq(relayB?.outputFields?.duration, '1', '60-minute event → duration="1" (no trailing ".0")');
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) {
    console.error(`\n✗ FAILED  (${summary.failed}/${summary.total})`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
