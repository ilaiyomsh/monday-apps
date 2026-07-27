// V6 signed-manifest module (docs/v6-amp-only-decisions.md §3) — PURE:
// no storage, no network, no env. One signature per message, covering an
// explicit manifest of what the message authorizes.
//
//   slot     = date (YYYYMMDD) of the scheduled send, Asia/Jerusalem
//   manifest = "<itemId>:<btnId>[,<btnId>…][;<itemId>:…]"  canonical:
//              items ascending (numeric), buttons ascending (byte order),
//              no spaces, no duplicates
//   payload  = accountId | personId | slot | manifest   ("|" single-byte)
//   sig      = base64url( HMAC-SHA256(link_secret, payload) )
//
// The manifest is NOT secret — it lists ids the message already displays.
// Signing it binds authorization to a specific (task, button) set. The
// recipient's person id is inside the payload so the server knows
// cryptographically which person a code was issued to (D11 runtime assignee
// check); a tampered value simply fails verification.
//
// The slot rolls at the send hour, not at midnight. No grace window for the
// previous slot — that is a locked decision (§3 "Do not accept the previous
// slot").

import crypto from 'node:crypto';

/** A manifest may not authorize more tasks than this (mirrors MAX_ITEMS). */
export const MAX_MANIFEST_ITEMS = 50;

export const MANIFEST_TIMEZONE = 'Asia/Jerusalem';

const ITEM_ID_RE = /^\d{1,20}$/;
const BTN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Numeric-ascending compare for digit strings up to 20 chars (length, then bytes). */
function compareItemIds(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Byte-order compare (ASCII ids — UTF-16 code-unit order equals byte order). */
function compareBtnIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Build the canonical manifest string from (itemId, btnId) pairs.
 * Items ascend numerically; each item's buttons ascend lexicographically;
 * duplicate pairs collapse. Throws on invalid ids or an empty/oversized set.
 * @param {Array<{ itemId: string, btnId: string }>} pairs
 * @returns {string}
 */
export function buildManifest(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error('manifest requires at least one (itemId, btnId) pair');
  }
  /** @type {Map<string, Set<string>>} */
  const byItem = new Map();
  for (const pair of pairs) {
    const itemId = pair?.itemId;
    const btnId = pair?.btnId;
    if (typeof itemId !== 'string' || !ITEM_ID_RE.test(itemId)) {
      throw new Error(`invalid manifest itemId: ${String(itemId)}`);
    }
    if (typeof btnId !== 'string' || !BTN_ID_RE.test(btnId)) {
      throw new Error(`invalid manifest btnId: ${String(btnId)}`);
    }
    let btns = byItem.get(itemId);
    if (!btns) {
      btns = new Set();
      byItem.set(itemId, btns);
    }
    btns.add(btnId);
  }
  if (byItem.size > MAX_MANIFEST_ITEMS) {
    throw new Error(`manifest exceeds ${MAX_MANIFEST_ITEMS} items (${byItem.size})`);
  }
  return [...byItem.keys()]
    .sort(compareItemIds)
    .map((itemId) => `${itemId}:${[...byItem.get(itemId)].sort(compareBtnIds).join(',')}`)
    .join(';');
}

/**
 * Strict canonical-manifest parser. Anything non-canonical (order, spaces,
 * duplicates, bad ids, empty, > MAX_MANIFEST_ITEMS items) is rejected —
 * a parsed-then-rebuilt manifest must equal its input byte-for-byte.
 * @param {unknown} manifest
 * @returns {{ ok: true, entries: Map<string, Set<string>> } | { ok: false, reason: string }}
 */
export function parseManifest(manifest) {
  if (typeof manifest !== 'string' || manifest.length === 0) {
    return { ok: false, reason: 'manifest must be a non-empty string' };
  }
  const itemParts = manifest.split(';');
  if (itemParts.length > MAX_MANIFEST_ITEMS) {
    return { ok: false, reason: `manifest exceeds ${MAX_MANIFEST_ITEMS} items` };
  }
  /** @type {Map<string, Set<string>>} */
  const entries = new Map();
  let prevItemId = null;
  for (const part of itemParts) {
    const colonAt = part.indexOf(':');
    if (colonAt === -1) return { ok: false, reason: 'item entry missing ":"' };
    const itemId = part.slice(0, colonAt);
    if (!ITEM_ID_RE.test(itemId)) return { ok: false, reason: `invalid itemId "${itemId}"` };
    if (entries.has(itemId)) return { ok: false, reason: `duplicate itemId "${itemId}"` };
    if (prevItemId !== null && compareItemIds(prevItemId, itemId) >= 0) {
      return { ok: false, reason: 'item ids not in ascending numeric order' };
    }
    const btnIds = part.slice(colonAt + 1).split(',');
    const btns = new Set();
    let prevBtnId = null;
    for (const btnId of btnIds) {
      if (!BTN_ID_RE.test(btnId)) return { ok: false, reason: `invalid btnId "${btnId}"` };
      if (btns.has(btnId)) return { ok: false, reason: `duplicate btnId "${btnId}"` };
      if (prevBtnId !== null && compareBtnIds(prevBtnId, btnId) >= 0) {
        return { ok: false, reason: 'button ids not in ascending order' };
      }
      btns.add(btnId);
      prevBtnId = btnId;
    }
    entries.set(itemId, btns);
    prevItemId = itemId;
  }
  return { ok: true, entries };
}

function hmacPayload({ secret, accountId, personId, slot, manifest }) {
  const payload = `${accountId}|${personId}|${slot}|${manifest}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Sign a manifest for one message.
 * @param {{ secret: string, accountId: string, personId: string, slot: string, manifest: string }} p
 * @returns {string} base64url HMAC-SHA256 signature
 */
export function signManifest({ secret, accountId, personId, slot, manifest }) {
  for (const [name, value] of Object.entries({ secret, accountId, personId, slot, manifest })) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`signManifest: ${name} must be a non-empty string`);
    }
  }
  return hmacPayload({ secret, accountId, personId, slot, manifest });
}

/**
 * Constant-time signature verification (recompute + timingSafeEqual via
 * sha256 length-equalization). Returns false, never throws, on any
 * missing/empty/non-string input.
 * @param {{ secret: string, accountId: string, personId: string, slot: string, manifest: string, signature: string }} p
 * @returns {boolean}
 */
export function verifyManifest({ secret, accountId, personId, slot, manifest, signature }) {
  for (const value of [secret, accountId, personId, slot, manifest, signature]) {
    if (typeof value !== 'string' || value.length === 0) return false;
  }
  const expected = hmacPayload({ secret, accountId, personId, slot, manifest });
  // Hash both sides first: equalizes length so timingSafeEqual never throws
  // and the comparison stays constant-time (same pattern as secretEquals).
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  const providedHash = crypto.createHash('sha256').update(signature).digest();
  return crypto.timingSafeEqual(expectedHash, providedHash);
}

/**
 * The slot a submission must carry to be valid NOW.
 * currentSlot = now >= today's send hour (in timeZone) ? today : yesterday,
 * formatted YYYYMMDD.
 * @param {{ sendHour: number, now?: Date, timeZone?: string }} p
 * @returns {string}
 */
export function currentSlot({ sendHour, now = new Date(), timeZone = MANIFEST_TIMEZONE }) {
  if (!Number.isInteger(sendHour) || sendHour < 0 || sendHour > 23) {
    throw new Error(`currentSlot: sendHour must be an integer 0-23, got ${String(sendHour)}`);
  }
  const hourInZone = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now)
  );
  // Before the send hour → still inside the PREVIOUS slot. A 24h step back is
  // date-accurate here: we only read the resulting DATE in the zone, and DST
  // shifts move wall-clock hours, not calendar days, across a single day hop.
  const slotDate = hourInZone >= sendHour ? now : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // en-CA formats as YYYY-MM-DD; strip the dashes for the YYYYMMDD slot.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(slotDate).replaceAll('-', '');
}
