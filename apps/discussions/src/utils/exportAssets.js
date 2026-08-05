/*
 * EXPORT ASSETS — heavy binary assets for the export template, persisted per app
 * instance in monday.storage under a SEPARATE key from the main settings blob.
 *
 * Why separate: `settings` (key `discussions_settings_${instanceId}`) is loaded on
 * every boot and gates render. Logo images and an uploaded header/footer .docx
 * template can be hundreds of KB each — embedding them in `settings.exportTemplate`
 * would bloat that hot path. So the small config/flags live in
 * `settings.exportTemplate` (see boards.config.js) and the bytes live here, keyed
 * `discussions_export_assets_${instanceId}` — mirroring the Templates/topicOrder
 * pattern (JSON value, 5s timeout, instanceId→boardId→'default' fallback).
 *
 * Shape:
 *   ExportAssets = {
 *     headerLogo:  dataUri | null,   // CONFIG mode — header band logo (image data URI)
 *     footerLogo:  dataUri | null,   // CONFIG mode — footer band logo
 *     templateDocx: base64 | null,   // UPLOAD mode — the uploaded .docx (base64, no data: prefix)
 *   }
 *
 * monday.storage caps an object at ~6MB; callers should validate the total via
 * estimateAssetsBytes() before saving and surface a friendly error.
 */
import { monday } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY_BASE = 'discussions_export_assets';
const TIMEOUT_MS = 5000;
// Conservative ceiling under monday's ~6MB per-object storage limit.
export const EXPORT_ASSETS_MAX_BYTES = 6 * 1024 * 1024;

const EMPTY = { headerLogo: null, footerLogo: null, templateDocx: null };

function instanceKey(context) {
  const instanceId = context?.instanceId || context?.boardId || 'default';
  return `${STORAGE_KEY_BASE}_${instanceId}`;
}

/*
 * round360 — the type key must be SHORT, PURE-ASCII and BOUNDED for any type name.
 *
 * The round254 key embedded the type's free Hebrew name percent-encoded
 * (`..._type_<inst>_%D7%93%D7%99...`), and monday's storage backend REJECTS that
 * write with `{ success:false, error:{…} }` — an undocumented constraint (the docs
 * state only a 256-char cap; observed in production 2026-08-05: the very same
 * .docx saved fine under the short ASCII instance key and was rejected under the
 * type key, with the type value the SMALLER of the two). Before round358 nothing
 * read the setItem response, so every per-type asset save with a Hebrew name had
 * been failing silently since round254.
 *
 * So the name goes through a deterministic digest instead: FNV-1a over the UTF-8
 * bytes, twice with different seeds (16 hex chars total), plus the byte length —
 * collision odds are negligible for a per-instance handful of type names, and the
 * key stays valid no matter how long or non-Latin the name is. Reads fall back to
 * the legacy key (accounts whose ASCII-named types DID land there) and migrate
 * forward — see loadTypeExportAssets.
 */
function fnv1a(bytes, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function typeNameDigest(typeName) {
  const bytes = new TextEncoder().encode(String(typeName || ''));
  const a = fnv1a(bytes, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a(bytes, 0x811c9dc5 ^ 0x5bd1e995).toString(16).padStart(8, '0');
  return `${a}${b}-${bytes.length.toString(36)}`;
}

export function typeExportAssetsKey(context, typeName) {
  const instanceId = context?.instanceId || context?.boardId || 'default';
  return `${STORAGE_KEY_BASE}_type_${instanceId}_${typeNameDigest(typeName)}`;
}

// The pre-round360 key. NEVER written any more; still read as a fallback so an
// account where the legacy write landed (short ASCII type names) keeps its assets.
export function legacyTypeExportAssetsKey(context, typeName) {
  const instanceId = context?.instanceId || context?.boardId || 'default';
  return `${STORAGE_KEY_BASE}_type_${instanceId}_${encodeURIComponent(typeName || '')}`;
}

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  return {
    headerLogo: typeof raw.headerLogo === 'string' && raw.headerLogo ? raw.headerLogo : null,
    footerLogo: typeof raw.footerLogo === 'string' && raw.footerLogo ? raw.footerLogo : null,
    templateDocx: typeof raw.templateDocx === 'string' && raw.templateDocx ? raw.templateDocx : null,
  };
}

/*
 * round358 (owner report: "שמרנו את קובץ התבנית והוא לא שם") — monday.storage.setItem
 * can REJECT a write by RESOLVING `{ data: { success: false } }` instead of throwing
 * (observed with multi-MB values), and nothing in the app inspected that response, so
 * a rejected save looked exactly like a successful one. Two layers close it:
 *   1. an explicit `success === false` is thrown as a failure, with monday's reason;
 *   2. the key is read back and the normalized field lengths compared — catching any
 *      silent-failure shape the flag misses. The verify is best-effort on purpose: an
 *      UNREADABLE read-back must not fail a write that did land, or a flaky read would
 *      re-create the false alarm in the opposite direction.
 * Only the export-assets keys carry multi-MB values, which is why the guard lives here
 * and not on every tiny settings write.
 */
function assertWriteAccepted(res, what) {
  if (res?.data?.success === false) {
    // round359 — monday puts an OBJECT in `error` (seen in production on the first
    // guarded save); naive interpolation printed "[object Object]" and hid the very
    // reason this guard exists to show. Stringify anything that is not a string.
    const raw = res?.data?.reason ?? res?.data?.error ?? 'הכתיבה נדחתה על ידי monday';
    let reason = raw;
    if (typeof raw !== 'string') {
      try {
        reason = JSON.stringify(raw);
      } catch {
        // un-stringifiable reject payload (circular) — throw the storage error
        // right here with the best text we can get.
        const err = new Error(`${what}: ${String(raw)}`);
        err.code = 'storage-rejected';
        throw err;
      }
    }
    const err = new Error(`${what}: ${reason}`);
    err.code = 'storage-rejected';
    throw err;
  }
}

async function verifyWriteLanded(key, clean, what) {
  let stored;
  try {
    const res = await withTimeout(monday.storage.getItem(key));
    stored = res?.data?.value ? normalize(JSON.parse(res.data.value)) : normalize(null);
  } catch (err) {
    logger.warn('exportAssets', `${what}: קריאת האימות אחרי הכתיבה נכשלה — מניחים שהכתיבה נקלטה`, err);
    return;
  }
  // Codex P2 on this round — content, not length: replacing a file with different
  // content of the SAME size (two versions of the same logo, a re-exported .docx)
  // must not pass verification against a stale read-back. Multi-MB string equality
  // is a cheap memcmp-style check; the save is rare and already does a full read.
  const mismatch = ['headerLogo', 'footerLogo', 'templateDocx'].find(
    (f) => (stored[f] || '') !== (clean[f] || '')
  );
  if (mismatch) {
    const err = new Error(`${what}: הכתיבה לא נקלטה באחסון (אימות ${mismatch} נכשל) — נסו קובץ קטן יותר`);
    err.code = 'storage-verify';
    throw err;
  }
}

/**
 * Approximate stored size in bytes (the JSON value monday persists). Strings are
 * ~1 byte/char for base64/ascii data URIs, so the character count is a close and
 * safe upper-bound estimate for the budget check.
 */
export function estimateAssetsBytes(assets) {
  const a = normalize(assets);
  return (a.headerLogo?.length || 0) + (a.footerLogo?.length || 0) + (a.templateDocx?.length || 0);
}

/**
 * Load the instance's export assets. Best-effort: returns EMPTY on any failure or
 * when storage is unavailable (local dev), never throws.
 * @returns {Promise<{headerLogo:string|null, footerLogo:string|null, templateDocx:string|null}>}
 */
export async function loadExportAssets(context) {
  try {
    const res = await withTimeout(monday.storage.getItem(instanceKey(context)));
    if (res?.data?.value) return normalize(JSON.parse(res.data.value));
  } catch (err) {
    // storage unavailable / parse error — treat as no assets (non-fatal).
    logger.warn('exportAssets', 'קריאת נכסי הייצוא נכשלה — ממשיכים ללא נכסים', err);
  }
  return { ...EMPTY };
}

/**
 * Persist the instance's export assets. Enforces the 6MB budget before writing.
 * @throws {Error} with `code:'quota'` when the assets exceed EXPORT_ASSETS_MAX_BYTES.
 * @returns {Promise<{headerLogo:string|null, footerLogo:string|null, templateDocx:string|null}>}
 */
export async function saveExportAssets(context, assets) {
  const clean = normalize(assets);
  const bytes = estimateAssetsBytes(clean);
  if (bytes > EXPORT_ASSETS_MAX_BYTES) {
    const err = new Error(
      `נכסי הייצוא חורגים ממגבלת האחסון (${(bytes / 1024 / 1024).toFixed(1)}MB מתוך 6MB). הקטינו את הלוגו או קובץ התבנית.`
    );
    err.code = 'quota';
    throw err;
  }
  try {
    const res = await withTimeout(monday.storage.setItem(instanceKey(context), JSON.stringify(clean)));
    if (context?.instanceId || context?.boardId) {
      assertWriteAccepted(res, 'שמירת נכסי הייצוא');
      await verifyWriteLanded(instanceKey(context), clean, 'שמירת נכסי הייצוא');
    }
  } catch (err) {
    if (context?.instanceId || context?.boardId) {
      logger.error('exportAssets', 'שמירת נכסי הייצוא נכשלה — ייתכן שהשינוי לא נשמר', err);
      throw err;
    }
    // local dev — storage unavailable; keep quiet (in-memory only), matching
    // TemplatesContext/SettingsContext tolerance.
    logger.warn('exportAssets', 'אחסון נכסי ייצוא לא זמין (פיתוח מקומי) — נשמר בזיכרון בלבד', err);
  }
  return clean;
}

/**
 * round254 — load a discussion-TYPE's own export assets (its brand binaries), or
 * EMPTY when none. Best-effort; never throws.
 */
export async function loadTypeExportAssets(context, typeName) {
  if (!typeName) return { ...EMPTY };
  const key = typeExportAssetsKey(context, typeName);
  try {
    const res = await withTimeout(monday.storage.getItem(key));
    if (res?.data?.value) return normalize(JSON.parse(res.data.value));
  } catch (err) {
    logger.warn('exportAssets', 'קריאת נכסי הייצוא של סוג הדיון נכשלה — משתמשים בברירת המחדל', err);
    return { ...EMPTY };
  }
  /*
   * round360 — the digest key is empty: fall back to the legacy (%-encoded) key,
   * and migrate a hit forward so the next read finds it under the digest key.
   * Migration is best-effort and loss-proof: the legacy key is deleted only after
   * the digest write was ACCEPTED (assertWriteAccepted), and any failure leaves
   * the legacy data in place and still returns it.
   */
  try {
    const legacyRes = await withTimeout(monday.storage.getItem(legacyTypeExportAssetsKey(context, typeName)));
    if (!legacyRes?.data?.value) return { ...EMPTY };
    const assets = normalize(JSON.parse(legacyRes.data.value));
    try {
      const res = await withTimeout(monday.storage.setItem(key, JSON.stringify(assets)));
      assertWriteAccepted(res, 'העברת נכסי הייצוא של סוג הדיון למפתח החדש');
      await withTimeout(monday.storage.deleteItem(legacyTypeExportAssetsKey(context, typeName)));
    } catch (err) {
      logger.warn('exportAssets', 'העברת נכסי הייצוא של הסוג למפתח החדש נכשלה — ממשיכים לקרוא מהמפתח הישן', err);
    }
    return assets;
  } catch (err) {
    logger.warn('exportAssets', 'קריאת נכסי הייצוא של סוג הדיון נכשלה — משתמשים בברירת המחדל', err);
  }
  return { ...EMPTY };
}

/**
 * round304 — MOVE a type's export assets when the type (= its template) is
 * renamed: the storage key embeds the type NAME, so without this the renamed type
 * would come up with no brand binaries. Best-effort by design — the rename itself
 * must not fail over a storage hiccup — and a no-op when the old key holds nothing.
 * @returns {Promise<boolean>} whether assets were actually moved.
 */
export async function moveTypeExportAssets(context, oldName, newName) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  if (!from || !to || from === to) return false;
  const existing = await loadTypeExportAssets(context, from);
  if (estimateAssetsBytes(existing) === 0) return false;
  try {
    await saveTypeExportAssets(context, to, existing);
    // round360 — the old name may hold data under either key generation.
    await withTimeout(monday.storage.deleteItem(typeExportAssetsKey(context, from)));
    await withTimeout(monday.storage.deleteItem(legacyTypeExportAssetsKey(context, from)));
    return true;
  } catch (err) {
    // The copy may have landed even if the delete didn't; either way the renamed
    // type is the one being read from now on, so report and continue.
    logger.warn('exportAssets', 'העברת נכסי הייצוא לשם הסוג החדש נכשלה', err);
    return false;
  }
}

/**
 * round254 — persist a discussion-TYPE's own export assets. Same 6MB budget as
 * the instance globals.
 * @throws {Error} with `code:'quota'` when over EXPORT_ASSETS_MAX_BYTES.
 */
export async function saveTypeExportAssets(context, typeName, assets) {
  const clean = normalize(assets);
  if (!typeName) return clean;
  const bytes = estimateAssetsBytes(clean);
  if (bytes > EXPORT_ASSETS_MAX_BYTES) {
    const err = new Error(
      `נכסי הייצוא של הסוג חורגים ממגבלת האחסון (${(bytes / 1024 / 1024).toFixed(1)}MB מתוך 6MB). הקטינו את הלוגו או קובץ התבנית.`
    );
    err.code = 'quota';
    throw err;
  }
  try {
    const res = await withTimeout(monday.storage.setItem(typeExportAssetsKey(context, typeName), JSON.stringify(clean)));
    if (context?.instanceId || context?.boardId) {
      assertWriteAccepted(res, 'שמירת נכסי הייצוא של סוג הדיון');
      await verifyWriteLanded(typeExportAssetsKey(context, typeName), clean, 'שמירת נכסי הייצוא של סוג הדיון');
    }
  } catch (err) {
    if (context?.instanceId || context?.boardId) {
      logger.error('exportAssets', 'שמירת נכסי הייצוא של סוג הדיון נכשלה — ייתכן שהשינוי לא נשמר', err);
      throw err;
    }
    logger.warn('exportAssets', 'אחסון נכסי ייצוא לסוג לא זמין (פיתוח מקומי) — נשמר בזיכרון בלבד', err);
  }
  return clean;
}
