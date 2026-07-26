// V5 public endpoint — Gmail dynamic email (AMP for Email).
//
// The digest's `text/x-amp-html` part (helpers/digest-amp.js) renders one
// <amp-form> per section inside Gmail; submitting it posts EVERY ticked task
// here at once. This is therefore the app's only bulk mutation path, and the
// only endpoint whose caller is an email client rather than a browser.
//
// Ordered contract (security contract — do not reorder):
// 1. AMP CORS gate (helpers/amp-cors.js). Pure header work, no I/O, so it runs
//    FIRST: a caller who is not an allow-listed sender's email never reaches
//    storage, cannot probe whether a secret is valid, and receives NO CORS
//    headers — which makes the email client discard the response rather than
//    render it. Default deny while AMP_ALLOWED_SENDERS is empty.
// 2. parse+validate: a /^\d{1,20}$/, k non-empty, btn /^[A-Za-z0-9_-]{1,64}$/,
//    every item /^\d{1,20}$/, 1..MAX_ITEMS items
//    → 400 bad_request | no_items | too_many_items
// 3. secret gate (constant-time, against `forAccount(a)`'s secret) → 403 invalid
// 4. rate limit, bucket `${a}:${ip}` → 429
// 5. performAction per item — the SAME engine as /confirm, so already-at-target
//    stays a silent success and nothing is ever written twice.
//
// Responses from step 2 onwards carry the CORS headers and are JSON (amp-form
// feeds them to the <template type="amp-mustache"> blocks). They report counts
// and a Hebrew message ONLY — never item, board or account data. A request that
// authorized cleanly but updated nothing answers 502 so the reader sees the
// error template instead of a green message.

import express from 'express';
import { secretEquals } from '../services/secret.js';
import { performAction } from '../services/confirm-service.js';
import { resolveAmpCors } from '../helpers/amp-cors.js';
import { logAttempt, logError, logInfo, track } from '../helpers/logger.js';

const ITEM_ID_RE = /^\d{1,20}$/;
const ACCOUNT_ID_RE = /^\d{1,20}$/;
const BTN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** One submission may not carry more tasks than this (one section's worth). */
export const MAX_ITEMS = 50;

const MESSAGES = {
  bad_request: 'הבקשה אינה תקינה.',
  no_items: 'לא סומנה אף משימה — סמנו לפחות משימה אחת ולחצו שוב.',
  too_many_items: `אפשר לעדכן עד ${MAX_ITEMS} משימות בפעם אחת.`,
  invalid: 'הקישור אינו בתוקף. אפשר לעדכן ישירות בלוח.',
  rate_limited: 'יותר מדי בקשות — נסו שוב בעוד דקה.',
  none_updated: 'לא הצלחנו לעדכן את המשימות שסומנו. אפשר לעדכן ישירות בלוח.',
};

/** Hebrew count phrasing (1 gets the singular form). */
function phrase(count, singular, plural) {
  return count === 1 ? singular : `${count} ${plural}`;
}

/**
 * Build the /amp/confirm router (see module-header contract).
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('../services/monday-api.js').createMondayApi>} deps.api
 * @param {{ allow(ip: string): boolean }} deps.rateLimiter
 * @param {string[]} deps.allowedSenders - AMP_ALLOWED_SENDERS; empty = deny all
 * @returns {import('express').Router}
 */
export function createAmpRouter({ storage, api, rateLimiter, allowedSenders }) {
  const router = express.Router();

  /** Step 1 for both verbs. Responds + logs on rejection and returns null. */
  function corsGate(req, res) {
    const verdict = resolveAmpCors({
      senderHeader: req.get('AMP-Email-Sender'),
      originHeader: req.get('Origin'),
      sourceOrigin: typeof req.query.__amp_source_origin === 'string' ? req.query.__amp_source_origin : undefined,
      allowedSenders,
    });
    if (!verdict.ok) {
      // Deliberately headerless: an unauthorized caller gets nothing to read.
      logAttempt({ ip: req.ip ?? '', itemId: null, outcome: `amp_${verdict.reason}` });
      res.status(403).set('Cache-Control', 'no-store').json({ error: verdict.reason, message: MESSAGES.invalid });
      return null;
    }
    res.set(verdict.headers);
    return verdict;
  }

  function sendJson(res, status, body) {
    res.status(status).set('Cache-Control', 'no-store').json(body);
  }

  router.options('/amp/confirm', (req, res) => {
    if (!corsGate(req, res)) return;
    res
      .status(200)
      .set('Cache-Control', 'no-store')
      .set('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .set('Access-Control-Allow-Headers', 'Content-Type')
      .end();
  });

  router.post('/amp/confirm', async (req, res) => {
    try {
      if (!corsGate(req, res)) return;

      const ip = req.ip ?? '';
      const { a, k, btn } = req.body ?? {};
      if (
        typeof a !== 'string' || !ACCOUNT_ID_RE.test(a) ||
        typeof k !== 'string' || k.length === 0 ||
        typeof btn !== 'string' || !BTN_ID_RE.test(btn)
      ) {
        logAttempt({ ip, itemId: null, outcome: 'bad_request' });
        sendJson(res, 400, { error: 'bad_request', message: MESSAGES.bad_request });
        return;
      }

      const raw = req.body.item;
      const submitted = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
      if (submitted.length === 0) {
        logAttempt({ ip, itemId: null, outcome: 'amp_no_items' });
        sendJson(res, 400, { error: 'no_items', message: MESSAGES.no_items });
        return;
      }
      if (submitted.length > MAX_ITEMS) {
        logAttempt({ ip, itemId: null, outcome: 'amp_too_many_items' });
        sendJson(res, 400, { error: 'too_many_items', message: MESSAGES.too_many_items });
        return;
      }
      if (!submitted.every((id) => typeof id === 'string' && ITEM_ID_RE.test(id))) {
        logAttempt({ ip, itemId: null, outcome: 'bad_request' });
        sendJson(res, 400, { error: 'bad_request', message: MESSAGES.bad_request });
        return;
      }
      // A checkbox cannot legitimately repeat, but a crafted body can.
      const itemIds = [...new Set(submitted)];

      const scopedStorage = storage.forAccount(a);
      const linkSecret = await scopedStorage.getLinkSecret();
      if (!linkSecret || !secretEquals(k, linkSecret)) {
        logAttempt({ ip, itemId: null, outcome: linkSecret ? 'bad_key' : 'no_config' });
        sendJson(res, 403, { error: 'invalid', message: MESSAGES.invalid });
        return;
      }

      if (!rateLimiter.allow(`${a}:${ip}`)) {
        logAttempt({ ip, itemId: null, outcome: 'rate_limited' });
        sendJson(res, 429, { error: 'rate_limited', message: MESSAGES.rate_limited });
        return;
      }

      let updated = 0;
      let already = 0;
      let failed = 0;
      for (const itemId of itemIds) {
        const result = await performAction({ storage: scopedStorage, api, itemId, btnId: btn });
        logAttempt({ ip, itemId, outcome: result.outcome });
        if (result.outcome === 'ok') updated += 1;
        else if (result.outcome === 'already_done') already += 1;
        else failed += 1;
      }

      const parts = [];
      if (updated > 0) parts.push(updated === 1 ? 'עודכנה משימה אחת' : `עודכנו ${updated} משימות`);
      if (already > 0) parts.push(`${phrase(already, 'משימה אחת', 'משימות')} היו מעודכנות כבר`);
      if (failed > 0) parts.push(`${phrase(failed, 'משימה אחת', 'משימות')} לא עודכנו`);

      const anySucceeded = updated + already > 0;
      logInfo('amp', 'bulk confirm finished', { items: itemIds.length, updated, already, failed });
      track('amp_confirm', { ok: failed === 0, method: 'POST' });

      sendJson(res, anySucceeded ? 200 : 502, {
        ok: failed === 0,
        updated,
        already,
        failed,
        message: anySucceeded ? parts.join(' · ') : MESSAGES.none_updated,
      });
    } catch (err) {
      logError('amp', 'POST handler failure', { error: String(err?.message ?? err) });
      logAttempt({ ip: req.ip ?? '', itemId: null, outcome: 'api_error' });
      sendJson(res, 502, { error: 'internal_error', message: MESSAGES.none_updated });
    }
  });

  return router;
}
