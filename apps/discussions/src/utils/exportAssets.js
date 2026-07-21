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
    // storage unavailable / parse error — treat as no assets, but keep it visible.
    logger.warn('exportAssets', 'load export assets failed', err);
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
    await withTimeout(monday.storage.setItem(instanceKey(context), JSON.stringify(clean)));
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
