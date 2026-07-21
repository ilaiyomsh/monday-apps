// v2 public endpoint. GET serves the JS auto-confirm landing page (scanner
// protection); POST performs the action. Response space: the §7 static pages
// + the landing page + a plain 429. One log line per request.
//
// Shared order for BOTH GET and POST (do not reorder):
// 1. parse+validate: itemId /^\d{1,20}$/, a /^\d{1,20}$/ (v3 account id),
//    k non-empty, btn /^[A-Za-z0-9_-]{1,64}$/
//    → any failure: 400 badRequestPage, outcome 'bad_request' (itemId null when invalid)
// 2. secret gate (cached, ACCOUNT-scoped link_secret): account has no stored
//    secret → invalid page, outcome 'no_config'; mismatch → invalid page 200,
//    outcome 'bad_key'
// 3. rate limit, bucket keyed `${a}:${ip}` → plain-text 429, outcome 'rate_limited'
// then:
// GET  → 200 confirmLandingPage({itemId,k,btn,a}), outcome 'page_served'
//        (NO config load beyond the secret, NO monday API call — scanners
//        without JS stop here)
// POST → performAction: 'ok' | 'already_done' → successPage(button.targetLabel);
//        every other outcome → invalidPage (HTTP 200).
// HEAD /confirm → 200 empty, NO side effects.

import express from 'express';
import { secretEquals } from '../services/secret.js';
import { performAction } from '../services/confirm-service.js';
import { successPage, invalidPage, badRequestPage, confirmLandingPage } from '../helpers/pages.js';
import logger, { logAttempt, track } from '../helpers/logger.js';

const ITEM_ID_RE = /^\d{1,20}$/;
const ACCOUNT_ID_RE = /^\d{1,20}$/;
const BTN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Build the /confirm router (see module-header contract).
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('../services/monday-api.js').createMondayApi>} deps.api
 * @param {{ allow(ip: string): boolean }} deps.rateLimiter
 * @returns {import('express').Router}
 */
export function createConfirmRouter({ storage, api, rateLimiter }) {
  const router = express.Router();

  function sendHtml(res, status, html) {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  }

  /**
   * Steps 1-3 shared by GET and POST. Returns the validated params or null
   * after having already responded (and logged).
   */
  async function gate(req, res, params) {
    const ip = req.ip ?? '';
    const { itemId, k, btn, a } = params;

    if (
      typeof itemId !== 'string' || !ITEM_ID_RE.test(itemId) ||
      typeof a !== 'string' || !ACCOUNT_ID_RE.test(a) ||
      typeof k !== 'string' || k.length === 0 ||
      typeof btn !== 'string' || !BTN_ID_RE.test(btn)
    ) {
      logAttempt({
        ip,
        itemId: typeof itemId === 'string' && ITEM_ID_RE.test(itemId) ? itemId : null,
        outcome: 'bad_request',
      });
      sendHtml(res, 400, badRequestPage());
      return null;
    }

    const linkSecret = await storage.forAccount(a).getLinkSecret();
    if (!linkSecret) {
      logAttempt({ ip, itemId, outcome: 'no_config' });
      sendHtml(res, 200, invalidPage());
      return null;
    }
    if (!secretEquals(k, linkSecret)) {
      logAttempt({ ip, itemId, outcome: 'bad_key' });
      sendHtml(res, 200, invalidPage());
      return null;
    }

    if (!rateLimiter.allow(`${a}:${ip}`)) {
      logAttempt({ ip, itemId, outcome: 'rate_limited' });
      res.status(429).set('Cache-Control', 'no-store').type('text').send('Too Many Requests');
      return null;
    }

    return { ip, itemId, k, btn, a };
  }

  // Mail-scanner first line: HEAD is a total no-op.
  router.head('/confirm', (_req, res) => {
    res.status(200).set('Cache-Control', 'no-store').end();
  });

  router.get('/confirm', async (req, res) => {
    try {
      const passed = await gate(req, res, req.query);
      if (!passed) return;
      logAttempt({ ip: passed.ip, itemId: passed.itemId, outcome: 'page_served' });
      sendHtml(res, 200, confirmLandingPage({ itemId: passed.itemId, k: passed.k, btn: passed.btn, a: passed.a }));
    } catch (err) {
      logger.logError('confirm', 'GET handler failure', { error: String(err?.message ?? err) });
      logAttempt({ ip: req.ip ?? '', itemId: null, outcome: 'api_error' });
      sendHtml(res, 200, invalidPage());
    }
  });

  router.post('/confirm', async (req, res) => {
    try {
      const passed = await gate(req, res, req.body ?? {});
      if (!passed) return;

      const result = await performAction({
        storage: storage.forAccount(passed.a),
        api,
        itemId: passed.itemId,
        btnId: passed.btn,
      });
      logAttempt({ ip: passed.ip, itemId: passed.itemId, outcome: result.outcome });
      // Usage telemetry (D3): the confirmation outcome, no PII (dims fold into message).
      // A successful status change whose attribution update failed is reported as
      // 'ok_no_audit' here (the attempt line above still carries the locked 'ok') so the
      // partial failure is visible in the usage/health signal instead of masked.
      const trackedOutcome = result.audit === 'failed' ? 'ok_no_audit' : result.outcome;
      track('confirm', { outcome: trackedOutcome, method: 'POST' });

      if (result.outcome === 'ok' || result.outcome === 'already_done') {
        sendHtml(res, 200, successPage(result.button?.targetLabel ?? ''));
      } else {
        // One uniform page for every failure mode (HTTP 200) — no data leaks.
        sendHtml(res, 200, invalidPage());
      }
    } catch (err) {
      logger.logError('confirm', 'POST handler failure', { error: String(err?.message ?? err) });
      logAttempt({ ip: req.ip ?? '', itemId: null, outcome: 'api_error' });
      sendHtml(res, 200, invalidPage());
    }
  });

  return router;
}
