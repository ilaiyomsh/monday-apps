// T10/T11 — monday-code digest scheduler + D8 operator summary.
// Dual path: /mndy-cronjob/digest-send (platform cron) and
// /scheduler/digest-send (manual test). No session auth — monday signs the
// cron request. Iterates env.allowedAccountIds; tenants whose sendHour does
// not match the current Asia/Jerusalem hour are silent-skipped (not listed);
// incomplete tenants are listed with a skip reason and do not raise.
// Gmail OAuth (T9b/T9c) is deferred — when emailSender is absent, due tenants
// skip as email_not_configured.

import express from 'express';
import { hourInJerusalem, runDigestForAccount } from '../services/digest-run.js';
import { formatOperatorSummary } from '../helpers/operator-summary.js';
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
        if (sendHour !== hour) {
          // Not due this hour — silent (no operator noise).
          continue;
        }

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
        // `due` marks the ones past the sendHour gate — the summary's audience.
        // It is stripped from the response so the wire shape stays what it was.
        tenants.push({ accountId, ...result, due: true });
      }

      let summarySent = false;
      // "Due" means the sendHour matched and the run was actually attempted — NOT
      // merely "appeared in the list". The old filter was `!t.skip || t.skip !==
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

      logInfo(TAG, 'cron_tick', {
        hour,
        tenants: tenants.length,
        due: dueTenants.length,
        summarySent,
      });
      // `due` is an internal marker for the summary audience — strip it so the
      // response keeps the exact shape its consumers (and tests) already expect.
      const reported = tenants.map(({ due: _due, ...rest }) => rest);
      res.status(200).json({ ok: true, hour, tenants: reported, summarySent });
    } catch (err) {
      logError(TAG, 'cron_tick failed', { error: String(err?.message ?? err) });
      res.status(500).json({ error: 'digest-send failed' });
    }
  }

  router.post(['/mndy-cronjob/digest-send', '/scheduler/digest-send'], handleDigestSend);
  return router;
}
