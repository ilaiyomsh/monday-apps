// GET/HEAD /confirm — the public one-click endpoint. Implements spec §6 in
// EXACT order; response space is exactly the three §7 static pages (plus a
// plain 429). Every attempt logs ONE structured line via logAttempt.

import express from 'express';
import { secretEquals } from '../services/secret.js';
import { performConfirm } from '../services/confirm-service.js';
import { successPage, invalidPage, badRequestPage } from '../helpers/pages.js';
import { logAttempt, logError } from '../helpers/logger.js';

const ITEM_ID_RE = /^\d{1,20}$/;

/**
 * Build the /confirm router — see the spec §6 order in the module header.
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('../services/monday-api.js').createMondayApi>} deps.api
 * @param {{ allow(ip: string): boolean }} deps.rateLimiter
 * @param {string} [deps.todayIso]
 * @returns {import('express').Router}
 */
export function createConfirmRouter({ storage, api, rateLimiter, todayIso }) {
  const router = express.Router();

  function sendHtml(res, status, html) {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  }

  // §6.1 — HEAD is a total no-op: no storage, no API, no logging side effects.
  router.head('/confirm', (_req, res) => {
    res.status(200).set('Cache-Control', 'no-store').end();
  });

  router.get('/confirm', async (req, res) => {
    const ip = req.ip ?? '';
    try {
      // §6.2 — parse & validate.
      const { itemId, k } = req.query;
      if (typeof itemId !== 'string' || !ITEM_ID_RE.test(itemId) || typeof k !== 'string' || k.length === 0) {
        logAttempt({ ip, itemId: typeof itemId === 'string' && ITEM_ID_RE.test(itemId) ? itemId : null, outcome: 'bad_request' });
        sendHtml(res, 400, badRequestPage());
        return;
      }

      // §6.3 — secret gate BEFORE anything that costs API quota (the stored
      // secret itself comes from the 60s memory cache).
      const linkSecret = await storage.getLinkSecret();
      if (!linkSecret) {
        logAttempt({ ip, itemId, outcome: 'no_config' });
        sendHtml(res, 200, invalidPage());
        return;
      }
      if (!secretEquals(k, linkSecret)) {
        logAttempt({ ip, itemId, outcome: 'bad_key' });
        sendHtml(res, 200, invalidPage());
        return;
      }

      // §6.4 — per-IP throttle. Plain 429, never a page.
      if (!rateLimiter.allow(ip)) {
        logAttempt({ ip, itemId, outcome: 'rate_limited' });
        res.status(429).set('Cache-Control', 'no-store').type('text').send('Too Many Requests');
        return;
      }

      // §6.5-6.9 — config/token load, item query, guards, mutations.
      const result = await performConfirm({ storage, api, itemId, todayIso });
      logAttempt({ ip, itemId, outcome: result.outcome });

      if (result.outcome === 'ok') {
        sendHtml(res, 200, successPage(result.toLabel ?? ''));
      } else {
        // §7.2 — one uniform page for every failure mode (HTTP 200).
        sendHtml(res, 200, invalidPage());
      }
    } catch (err) {
      // Last-resort catch: nothing beyond the three pages may leak.
      logError('confirm', 'unexpected handler failure', { error: String(err?.message ?? err) });
      logAttempt({ ip, itemId: null, outcome: 'api_error' });
      sendHtml(res, 200, invalidPage());
    }
  });

  return router;
}
