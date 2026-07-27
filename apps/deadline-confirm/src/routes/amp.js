// V6 public endpoint — Gmail dynamic email (AMP for Email), the app's ONLY
// public write path (docs/v6-amp-only-decisions.md D2).
//
// The digest's `text/x-amp-html` part posts here from inside the message.
// V6 replaces the V5 static-secret wire format (k+btn+item[]) with ONE
// SIGNED MANIFEST per message: hidden fields carry the account (a), the
// recipient person (p), the send slot (s), the canonical manifest (m) and
// its HMAC (sig); selections ride as item_<itemId>=<btnId> fields. The base
// link secret NEVER leaves the server (D3).
//
// Ordered contract (spec §3 verification order — do NOT reorder):
//  1. AMP CORS sender gate (helpers/amp-cors.js). Pure header work, no I/O:
//     an unlisted sender never reaches storage, cannot probe anything, and
//     gets NO CORS headers — the email client discards the response.
//     Default deny while AMP_ALLOWED_SENDERS is empty.
//  2. rate limit bucket A — perIp.allow(<bare client ip>), BEFORE any
//     storage read or field validation (abuse control; bucket B protects
//     the monday complexity budget and must not be drainable by
//     unauthenticated callers behind the same NAT).
//  3. parse a /^\d{1,20}$/, p /^\d{1,20}$/, s /^\d{8}$/, sig non-empty,
//     m strictly canonical (parseManifest) → 400 (bad_fields / bad_manifest).
//  4. load the account's link_secret (+config) via storage.forAccount(a) —
//     missing → 403 no_config.
//  5. s must equal currentSlot for config.digest.sendHour (default 8),
//     Asia/Jerusalem. NO grace for the previous slot → 403 bad_slot.
//  6. HMAC over `${a}|${p}|${s}|${m}` verified constant-time BEFORE the
//     selection fields are read → 403 bad_sig.
//  7. selections: only field names matching ^item_\d{1,20}$ count (others
//     ignored); none → 400 no_items; identical duplicates collapse; the
//     same item with two DIFFERENT buttons → 400 conflict_item; more than
//     MAX_ITEMS → 400 too_many_items; every (item, button) pair must be in
//     the VERIFIED manifest → 403 manifest_violation.
//  8. all-or-nothing for integrity failures (3–7): the whole request is
//     rejected with ZERO monday API calls — the response returns counts,
//     so partial execution here would be a verification oracle.
//  9. rate limit bucket B — perAccount.allow(`${a}:${ip}`) → 429.
// 10. performAction per selection with that selection's OWN btnId and
//     expectedPersonId = p (D11). State failures (not_assignee, not_found,
//     api_error…) are PER ITEM and never fail their batch-mates.
//
// Responses from step 2 onwards carry the CORS headers and are JSON
// (amp-mustache templates): { ok, updated, already, failed, message } —
// counts and a Hebrew message ONLY, never item/board/account data.
// Each failure path has a distinct `error` code + `[E…]` tag in `message`
// so operators can diagnose from the AMP error box / Network tab.
// A request that verified cleanly but updated nothing answers 502.

import express from 'express';
import { performAction } from '../services/confirm-service.js';
import { parseManifest, verifyManifest, currentSlot, MAX_MANIFEST_ITEMS } from '../services/manifest-signature.js';
import { resolveAmpCors } from '../helpers/amp-cors.js';
import { logAttempt, logError, logInfo, track } from '../helpers/logger.js';

const ACCOUNT_ID_RE = /^\d{1,20}$/;
const PERSON_ID_RE = /^\d{1,20}$/;
const SLOT_RE = /^\d{8}$/;
const SELECTION_FIELD_RE = /^item_(\d{1,20})$/;

/** One submission may not carry more tasks than this (one message's worth). */
export const MAX_ITEMS = MAX_MANIFEST_ITEMS;

/** Slot fallback when the account has no digest config (schema default). */
const DEFAULT_SEND_HOUR = 8;

/**
 * Distinct Hebrew messages — `[E…]` tags map 1:1 to gates for diagnosis.
 * No item/board/account ids in the text (no verification oracle payload).
 */
export const MESSAGES = {
  // E1 — CORS (step 1); body may be discarded by the client without CORS headers
  cors_not_configured: '[E1a] שער AMP לא מוגדר (AMP_ALLOWED_SENDERS ריק).',
  cors_sender_not_allowed: '[E1b] כתובת השולח אינה ברשימת AMP המורשית.',
  cors_missing_source_origin: '[E1c] חסר __amp_source_origin בבקשת AMP.',
  cors_no_amp_headers: '[E1d] חסרים כותרות AMP (AMP-Email-Sender / Origin).',
  // E2 / E9 — rate limits
  rate_limited: '[E2] יותר מדי בקשות מהכתובת — נסו שוב בעוד דקה.',
  rate_limited_account: '[E9] יותר מדי בקשות לחשבון — נסו שוב בעוד דקה.',
  // E3 — field / manifest shape
  bad_fields: '[E3a] שדות החתימה (a/p/s/sig/m) חסרים או בפורמט שגוי — בדקו העתקה ל־playground.',
  bad_manifest: '[E3b] המניפסט (m) אינו תקין או נפגם בהעתקה.',
  // E4–E6 / E8 — authz (were all "invalid")
  no_config: '[E4] אין הגדרות/סוד לחשבון — הקישור אינו בתוקף.',
  bad_slot: '[E5] חלון הזמן (s) פג או לא תואם — הקישור אינו בתוקף להיום.',
  bad_sig: '[E6] החתימה (sig) אינה תקינה — ייתכן שהטופס נפגם או הוחלף.',
  manifest_violation: '[E8] הבחירה אינה מורשית במניפסט החתום.',
  // E7 — selections
  no_items: '[E7a] לא סומנה אף משימה — סמנו לפחות משימה אחת ולחצו שוב.',
  conflict_item: '[E7b] אותה משימה סומנה עם שני סטטוסים שונים (בשני מקבצים) — בחרו אחד.',
  too_many_items: `[E7c] אפשר לעדכן עד ${MAX_ITEMS} משימות בפעם אחת.`,
  // E10 / E99
  none_updated: '[E10] לא הצלחנו לעדכן את המשימות שסומנו. אפשר לעדכן ישירות בלוח.',
  internal_error: '[E99] שגיאת שרת פנימית. נסו שוב או עדכנו ישירות בלוח.',
};

const CORS_MESSAGES = {
  not_configured: MESSAGES.cors_not_configured,
  sender_not_allowed: MESSAGES.cors_sender_not_allowed,
  missing_source_origin: MESSAGES.cors_missing_source_origin,
  no_amp_headers: MESSAGES.cors_no_amp_headers,
};

/** Hebrew count phrasing (1 gets the singular form). */
function phrase(count, singular, plural) {
  return count === 1 ? singular : `${count} ${plural}`;
}

/**
 * Extract the selection fields from a parsed body. Only names matching
 * ^item_<digits>$ participate; anything else is ignored. Returns
 * { selections: Array<{ itemId, btnId }> } (identical duplicates collapsed)
 * or { error: 'no_items' | 'too_many_items' | 'conflict_item' }.
 */
function extractSelections(body) {
  /** @type {Map<string, string>} itemId -> btnId */
  const byItem = new Map();
  for (const [field, rawValue] of Object.entries(body)) {
    const match = SELECTION_FIELD_RE.exec(field);
    if (!match) continue;
    const itemId = match[1];
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (typeof value !== 'string' || value.trim().length === 0) continue; // empty select = no change
      const existing = byItem.get(itemId);
      if (existing === undefined) byItem.set(itemId, value);
      // One item, two DIFFERENT buttons in one submission is not producible
      // by a single-table form — with multi-cluster tables it can happen when
      // the same item is marked in two sections.
      else if (existing !== value) return { error: 'conflict_item' };
    }
  }
  if (byItem.size === 0) return { error: 'no_items' };
  if (byItem.size > MAX_ITEMS) return { error: 'too_many_items' };
  return { selections: [...byItem.entries()].map(([itemId, btnId]) => ({ itemId, btnId })) };
}

/**
 * Build the /amp/confirm router (see module-header contract).
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('../services/monday-api.js').createMondayApi>} deps.api
 * @param {{ perIp: { allow(key: string): boolean }, perAccount: { allow(key: string): boolean } }} deps.rateLimiters
 * @param {string[]} deps.allowedSenders - AMP_ALLOWED_SENDERS; empty = deny all
 * @param {() => Date} [deps.now] - injectable clock for the slot check
 * @returns {import('express').Router}
 */
export function createAmpRouter({ storage, api, rateLimiters, allowedSenders, now = () => new Date() }) {
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
      const message = CORS_MESSAGES[verdict.reason] ?? MESSAGES.cors_no_amp_headers;
      res.status(403).set('Cache-Control', 'no-store').json({ error: verdict.reason, message });
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
      // 1. sender gate — pure header work, before any I/O.
      if (!corsGate(req, res)) return;

      const ip = req.ip ?? '';

      // 2. bucket A — per-IP, before storage reads and field validation.
      if (!rateLimiters.perIp.allow(ip)) {
        logAttempt({ ip, itemId: null, outcome: 'rate_limited' });
        sendJson(res, 429, { error: 'rate_limited', message: MESSAGES.rate_limited });
        return;
      }

      // 3. parse a, p, s, sig, m — strict shapes; manifest must be canonical.
      const { a, p, s, sig, m } = req.body ?? {};
      if (
        typeof a !== 'string' ||
        !ACCOUNT_ID_RE.test(a) ||
        typeof p !== 'string' ||
        !PERSON_ID_RE.test(p) ||
        typeof s !== 'string' ||
        !SLOT_RE.test(s) ||
        typeof sig !== 'string' ||
        sig.length === 0 ||
        typeof m !== 'string' ||
        m.length === 0
      ) {
        logAttempt({ ip, itemId: null, outcome: 'bad_fields' });
        sendJson(res, 400, { error: 'bad_fields', message: MESSAGES.bad_fields });
        return;
      }
      const manifest = parseManifest(m);
      if (!manifest.ok) {
        logError('amp', 'manifest rejected', { reason: manifest.reason });
        logAttempt({ ip, itemId: null, outcome: 'bad_manifest' });
        sendJson(res, 400, { error: 'bad_manifest', message: MESSAGES.bad_manifest });
        return;
      }

      // 4. account secret + config (config only feeds the slot's sendHour here).
      const scopedStorage = storage.forAccount(a);
      const linkSecret = await scopedStorage.getLinkSecret();
      if (!linkSecret) {
        logAttempt({ ip, itemId: null, outcome: 'no_config' });
        sendJson(res, 403, { error: 'no_config', message: MESSAGES.no_config });
        return;
      }
      const config = await scopedStorage.getConfig();
      const sendHour = config?.digest?.sendHour ?? DEFAULT_SEND_HOUR;

      // 5. slot — exactly the current one; the previous slot gets NO grace.
      if (s !== currentSlot({ sendHour, now: now() })) {
        logAttempt({ ip, itemId: null, outcome: 'bad_slot' });
        sendJson(res, 403, { error: 'bad_slot', message: MESSAGES.bad_slot });
        return;
      }

      // 6. signature — verified BEFORE any selection field is read.
      if (!verifyManifest({ secret: linkSecret, accountId: a, personId: p, slot: s, manifest: m, signature: sig })) {
        logAttempt({ ip, itemId: null, outcome: 'bad_sig' });
        sendJson(res, 403, { error: 'bad_sig', message: MESSAGES.bad_sig });
        return;
      }

      // 7. selections — every pair must appear in the VERIFIED manifest.
      const extracted = extractSelections(req.body);
      if (extracted.error) {
        logAttempt({ ip, itemId: null, outcome: extracted.error });
        sendJson(res, 400, { error: extracted.error, message: MESSAGES[extracted.error] });
        return;
      }
      const { selections } = extracted;
      // 8. all-or-nothing: one off-manifest selection rejects the whole batch.
      for (const { itemId, btnId } of selections) {
        if (!manifest.entries.get(itemId)?.has(btnId)) {
          logAttempt({ ip, itemId, outcome: 'manifest_violation' });
          sendJson(res, 403, { error: 'manifest_violation', message: MESSAGES.manifest_violation });
          return;
        }
      }

      // 9. bucket B — the account's monday-budget guard, post-verification.
      if (!rateLimiters.perAccount.allow(`${a}:${ip}`)) {
        logAttempt({ ip, itemId: null, outcome: 'rate_limited_account' });
        sendJson(res, 429, { error: 'rate_limited_account', message: MESSAGES.rate_limited_account });
        return;
      }

      // 10. execute — per-selection button, D11 assignee check via p.
      let updated = 0;
      let already = 0;
      let failed = 0;
      for (const { itemId, btnId } of selections) {
        const result = await performAction({ storage: scopedStorage, api, itemId, btnId, expectedPersonId: p });
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
      logInfo('amp', 'bulk confirm finished', { items: selections.length, updated, already, failed });
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
      sendJson(res, 502, { error: 'internal_error', message: MESSAGES.internal_error });
    }
  });

  return router;
}
