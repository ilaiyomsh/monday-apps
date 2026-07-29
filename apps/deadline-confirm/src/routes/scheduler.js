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
        });
        tenants.push({ accountId, ...result });
      }

      let summarySent = false;
      const dueTenants = tenants.filter((t) => !t.skip || t.skip !== 'wrong_hour');
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
        summarySent,
      });
      res.status(200).json({ ok: true, hour, tenants, summarySent });
    } catch (err) {
      logError(TAG, 'cron_tick failed', { error: String(err?.message ?? err) });
      res.status(500).json({ error: 'digest-send failed' });
    }
  }

  router.post(['/mndy-cronjob/digest-send', '/scheduler/digest-send'], handleDigestSend);
  return router;
}
