// T10/T11 — monday-code digest scheduler + D8 operator summary.
// Dual path: /mndy-cronjob/digest-send (platform cron) and
// /scheduler/digest-send (manual test). No session auth — monday signs the
// cron request. Iterates env.allowedAccountIds and runs a tenant at its EXACT
// sendHour in Asia/Jerusalem — any other hour is a silent skip (not listed, no
// board reads). Incomplete tenants are listed with a skip reason and do not
// raise. Gmail OAuth (T9b/T9c) is deferred — when emailSender is absent, due
// tenants skip as email_not_configured.
//
// §7.4's CATCH-UP (round348) IS REVERSED (owner decision 2026-08-06). It made
// every tick from sendHour to midnight re-attempt the tenant, safely — the
// per-slot marker stopped anyone being mailed twice — but "safely" was not the
// objection. Someone who became eligible AFTER the scheduled hour (a users-board
// row filled in, a task's date or status changed, a recipient-gate label
// flipped) received a digest an hour later, and each such tick mailed the
// operator another summary + CSV. Measured in production 2026-08-06: the 10:00
// tick sent 4, the 11:00 catch-up sent 1 more and reported again. The owner's
// rule: the digest is a once-a-day event at a known hour, and whoever joined
// late waits for tomorrow.
//
// The cost, on the record: a tick that NEVER FIRES for a tenant's hour costs
// that tenant the day, recoverable only from the admin screen's resend. The
// platform's own retry (maxRetries 3, 60s backoff — docs/scheduling.md §2) still
// covers a tick that failed or timed out, and the per-slot marker is what keeps
// those retries from re-mailing anyone. That marker is unchanged: it solves
// retries, which is a different problem from catch-up.

import express from 'express';
import { hourInJerusalem, runDigestForAccount } from '../services/digest-run.js';
import { formatOperatorSummary } from '../helpers/operator-summary.js';
import { buildDigestSummaryReport } from '../helpers/digest-summary-report.js';
import { currentSlot, MANIFEST_TIMEZONE } from '../services/manifest-signature.js';
import { logError, logInfo } from '../helpers/logger.js';

const TAG = 'scheduler';

/**
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {{ getBoardItems(p: object): Promise<object> }} deps.api
 * @param {{ allowedAccountIds: string[], baseUrl: string, operatorEmail?: string | null }} deps.env
 * @param {{ send(p: object): Promise<{ id: string }> }} [deps.emailSender]
 * @param {string} [deps.todayIso]
 * @param {() => Date} [deps.now]
 * @returns {import('express').Router}
 */
export function createSchedulerRouter({ storage, api, env, emailSender, todayIso, now = () => new Date() }) {
  const router = express.Router();

  async function handleDigestSend(_req, res) {
    try {
      const clock = now();
      const hour = hourInJerusalem(clock);
      const tenants = [];

      for (const accountId of env.allowedAccountIds ?? []) {
        let config;
        try {
          config = await storage.forAccount(accountId).getConfig();
        } catch (err) {
          logError(TAG, 'config read failed', {
            accountId,
            error: String(err?.message ?? err),
          });
          tenants.push({ accountId, skip: 'config_read_failed' });
          continue;
        }

        if (!config?.digest) {
          tenants.push({ accountId, skip: 'digest_not_configured' });
          continue;
        }

        const sendHour = config.digest.sendHour ?? 8;
        // EXACT match, both directions (owner decision 2026-08-06, see header).
        // A tenant whose hour is not now is skipped SILENTLY — not pushed with a
        // reason: a listed tenant is summary audience (§5.1), and 23 hourly
        // "not your hour" entries are the noise that fix already closed once.
        if (sendHour !== hour) {
          continue;
        }

        // Wall time of this tenant's run. The platform kills the tick at its
        // configured timeout (300s as stored — docs/scheduling.md §2), and the
        // send loop is SERIAL: two board reads, then one SMTP connection per
        // recipient. Whether that fits was unmeasurable before this line — §7.3
        // asked the question and nothing in the logs could answer it. Everything
        // else in a tick is a cached config read, so these numbers sum to
        // essentially the whole request.
        const startedAt = now();
        const result = await runDigestForAccount({
          accountId,
          storage,
          api,
          baseUrl: env.baseUrl,
          emailSender,
          todayIso,
          now: () => clock,
          // ONLY the cron enforces the per-slot marker. The platform retries a
          // failed or timed-out tick (measured 2026-08-05: maxRetries 3,
          // minBackoffDuration 60s — and `-r 0` is silently ignored by the CLI),
          // so without this a tick killed at the 300s timeout re-sends to
          // everyone it had already emailed. The admin's manual send and
          // resend-today deliberately pass nothing: re-sending inside the same
          // slot is exactly what they are for.
          skipAlreadySent: true,
        });
        const durationMs = now() - startedAt;
        logInfo(TAG, 'tenant run finished', {
          accountId,
          durationMs,
          recipients: result.results?.length ?? 0,
          skip: result.skip,
        });
        // `due` marks the summary's audience (operator mail + CSV report). With
        // the exact-hour gate above, reaching this line IS the scheduled hour, so
        // it is unconditionally true — a tenant that ran gets its report even
        // with zero recipients, because its own hour is the expected reporting
        // moment. (Under the reverted catch-up this had to be conditional on
        // "did something", or every remaining hour of the day re-reported.) It is
        // stripped from the response so the wire shape stays what it was.
        // `durationMs` is NOT stripped: `scheduler:run` prints the response, so
        // the timeout question is answerable from one manual tick.
        tenants.push({ accountId, ...result, durationMs, due: true });
      }

      let summarySent = false;
      // "Due" means the sendHour matched and the run was actually attempted — NOT
      // merely "appeared in the list": a tenant with no digest config, or whose
      // config read failed, is pushed WITHOUT `due` and must stay out of the
      // summary. The old filter was `!t.skip || t.skip !==
      // 'wrong_hour'`, which is true for every possible value: `wrong_hour` is a
      // skip reason no code produces, because the not-due branch `continue`s
      // without pushing. So an account that had simply never configured a digest
      // counted as due on EVERY tick, and with an hourly cron that is a summary
      // mail every hour, all day (measured 2026-08-05).
      const dueTenants = tenants.filter((t) => t.due);
      if (emailSender && env.operatorEmail && dueTenants.length > 0) {
        const slot =
          dueTenants.find((t) => t.slot)?.slot ??
          currentSlot({ sendHour: hour, now: clock, timeZone: MANIFEST_TIMEZONE });
        const plain = formatOperatorSummary({ slot, tenants: dueTenants });
        try {
          await emailSender.send({
            // T9: the summary is cross-tenant but has to be sent AS somebody.
            // It goes out through the first due tenant's own connected mailbox
            // — the only sending identity this run is known to hold. If that
            // tenant is not connected the send throws and is caught below;
            // the digests themselves are unaffected.
            accountId: dueTenants[0].accountId,
            to: env.operatorEmail,
            subject: `deadline-confirm digest summary — ${slot}`,
            plain,
          });
          summarySent = true;
        } catch (err) {
          logError(TAG, 'operator summary send failed', {
            error: String(err?.message ?? err),
          });
        }
      }

      // Per-employee summary FILE — one per due tenant, to that tenant's OWN
      // sending mailbox (owner decision 2026-08-05, docs/scheduling.md §5.2).
      // Deliberately not OPERATOR_EMAIL: the report follows whatever mailbox the
      // admin screen connected, so rebinding a sender moves it along and there
      // is no second setting to drift. Sent LAST, after the digests and the
      // operator summary — the file describes a run that has already happened.
      let reportsSent = 0;
      if (emailSender) {
        for (const tenant of dueTenants) {
          // A tenant that skipped (no config / no secret / not connected) ran
          // nothing, so there is nothing to report on.
          if (!Array.isArray(tenant.summaryRows)) continue;
          let senderAddress;
          try {
            senderAddress = (await storage.forAccount(tenant.accountId).getGoogleSender())
              ?.senderAddress;
          } catch (err) {
            logError(TAG, 'sender read failed — no summary file for this tenant', {
              accountId: tenant.accountId,
              error: String(err?.message ?? err),
            });
            continue;
          }
          if (!senderAddress) {
            logInfo(TAG, 'no connected mailbox — summary file skipped', {
              accountId: tenant.accountId,
            });
            continue;
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
            reportsSent += 1;
          } catch (err) {
            // The digests are already out. A failed report must never become a
            // non-2xx tick, or the platform would retry the whole tenant over a
            // file nobody is waiting on.
            logError(TAG, 'summary file send failed', {
              accountId: tenant.accountId,
              error: String(err?.message ?? err),
            });
          }
        }
      }

      logInfo(TAG, 'cron_tick', {
        hour,
        tenants: tenants.length,
        due: dueTenants.length,
        summarySent,
        reportsSent,
      });
      // `due` is an internal marker for the summary audience, and the summary
      // rows are the report's raw material (they carry every employee's name and
      // address) — strip all three so the response keeps the exact shape its
      // consumers already expect and the tick answer stays counts-only.
      const reported = tenants.map(
        ({ due: _due, summaryRows: _rows, summarySections: _sections, ...rest }) => rest
      );
      res.status(200).json({ ok: true, hour, tenants: reported, summarySent, reportsSent });
    } catch (err) {
      logError(TAG, 'cron_tick failed', { error: String(err?.message ?? err) });
      res.status(500).json({ error: 'digest-send failed' });
    }
  }

  router.post(['/mndy-cronjob/digest-send', '/scheduler/digest-send'], handleDigestSend);
  return router;
}
