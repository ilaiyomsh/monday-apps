// The per-tenant half of a scheduled tick, shared by the platform cron
// (routes/scheduler.js) and the admin screen's manual trigger
// (routes/admin-api.js, POST /api/digest/run-scheduled).
//
// Why this module exists: before it, the CSV summary report (§5.2) was produced
// ONLY inside the scheduler's loop, so the admin screen could send a digest but
// could never produce the report that describes it. `/api/digest/send` sends the
// mail and stops. An operator asking "run the scheduled action now, report and
// all" had no button, which is what this fixes.
//
// Only the ONE-TENANT part is shared. The cross-tenant operator summary (§5.1)
// stays in the scheduler: it summarises a sweep over every allowed account, and
// one tenant's manual run is not a sweep.

import { runDigestForAccount } from './digest-run.js';
import { buildDigestSummaryReport } from '../helpers/digest-summary-report.js';
import { logError, logInfo } from '../helpers/logger.js';

/**
 * Send one tenant's per-employee CSV report to that tenant's OWN sending
 * mailbox (§5.2). Never throws: the digests are already out by the time this
 * runs, and on the cron path a non-2xx would retry the whole tenant over a file
 * nobody is waiting on.
 *
 * @param {object} p
 * @param {{accountId: string, slot?: string, summaryRows?: unknown[], summarySections?: unknown[]}} p.tenant
 * @param {{forAccount(id: string): {getGoogleSender(): Promise<{senderAddress?: string} | null>}}} p.storage
 * @param {{send(m: object): Promise<unknown>}} [p.emailSender]
 * @param {string} p.tag - log tag of the calling surface
 * @returns {Promise<boolean>} whether a report was actually sent
 */
export async function sendTenantSummaryReport({ tenant, storage, emailSender, tag }) {
  // A tenant that skipped (no config / no secret / not connected) ran nothing,
  // so there is nothing to report on.
  if (!emailSender || !Array.isArray(tenant?.summaryRows)) return false;

  let senderAddress;
  try {
    senderAddress = (await storage.forAccount(tenant.accountId).getGoogleSender())?.senderAddress;
  } catch (err) {
    logError(tag, 'sender read failed — no summary file for this tenant', {
      accountId: tenant.accountId,
      error: String(err?.message ?? err),
    });
    return false;
  }
  if (!senderAddress) {
    logInfo(tag, 'no connected mailbox — summary file skipped', { accountId: tenant.accountId });
    return false;
  }

  try {
    const report = buildDigestSummaryReport({
      slot: tenant.slot,
      accountId: tenant.accountId,
      sections: tenant.summarySections,
      rows: tenant.summaryRows,
    });
    await emailSender.send({
      accountId: tenant.accountId,
      to: senderAddress,
      subject: report.subject,
      plain: report.plain,
      mime: report.mime,
    });
    return true;
  } catch (err) {
    logError(tag, 'summary file send failed', {
      accountId: tenant.accountId,
      error: String(err?.message ?? err),
    });
    return false;
  }
}

/**
 * Run ONE tenant and then produce its CSV report — the digest half of a tick,
 * for a single account.
 *
 * **`skipAlreadySent` defaults to FALSE, and the manual trigger keeps it false**
 * (owner decision 2026-08-05): the button re-sends to everyone, every time. Two
 * consequences follow from `digest-run.js`, and both are deliberate:
 *   - nobody is skipped, so pressing it twice mails twice;
 *   - the per-slot marker is written ONLY under `skipAlreadySent`, so a manual
 *     run leaves NO marker and therefore never suppresses the cron that follows
 *     it. A manual run at 09:00 and the scheduled run at 10:00 both deliver.
 * That matches `/api/digest/send`, whose whole purpose is a deliberate re-send;
 * the cron passes `true` and owns the marker alone (docs/scheduling.md §4).
 *
 * The clock is frozen for the same reason the cron freezes it: a long batch must
 * not straddle a slot boundary and sign two different slots.
 *
 * `durationMs` is measured around the run only — the report send is operator
 * reporting, not digest work, and folding it in would inflate the number §7.3
 * compares against the platform's 300s timeout.
 *
 * @returns {Promise<object>} the run result plus `durationMs` and `reportSent`
 */
export async function runScheduledForAccount({
  accountId,
  storage,
  api,
  baseUrl,
  emailSender,
  todayIso,
  now = () => new Date(),
  skipAlreadySent = false,
  tag = 'scheduled_run',
}) {
  const clock = now();
  const startedAt = now();
  const result = await runDigestForAccount({
    accountId,
    storage,
    api,
    baseUrl,
    emailSender,
    todayIso,
    now: () => clock,
    skipAlreadySent,
  });
  const durationMs = now() - startedAt;

  const tenant = { accountId, ...result };
  const reportSent = await sendTenantSummaryReport({ tenant, storage, emailSender, tag });

  // Dims ride INSIDE the message: `mapps code:logs` renders only `message` and
  // silently drops every sibling key, so numbers passed as context are invisible
  // in production (measured 2026-08-05 — 0.14.0's `tenant run finished` line
  // reported nothing readable). Same shape as `api_latency`.
  logInfo(
    tag,
    `scheduled_run_finished account=${accountId} durationMs=${durationMs} recipients=${
      result.results?.length ?? 0
    } reportSent=${reportSent} skipAlreadySent=${skipAlreadySent} skip=${result.skip ?? 'none'}`
  );

  return { ...result, accountId, durationMs, reportSent };
}
