/**
 * The uploaded .docx template in monday.storage — under its OWN key.
 *
 * @module utils/assetsStore
 *
 * The split from the settings blob is mandatory, not tidiness: settings are read
 * on every boot and gate render, and a template runs to hundreds of KB. Carrying
 * the bytes in that hot path would delay first paint for every user on every load.
 *
 * Same pattern as utils/settingsStore.js (JSON value, 5s timeout, key fallback
 * instanceId → boardId → 'default', loads never throw), same two live quirks
 * handled — the false-empty first read and a setItem that resolves without
 * persisting — plus a budget check: monday caps a stored object at ~6MB, so an
 * over-budget template is rejected BEFORE the write with a Hebrew message the owner
 * can act on (`err.code === 'quota'`), instead of a storage error they cannot read.
 *
 * Stored shape: `{ templateDocx: base64 | null }` — an object rather than a bare
 * string so a second asset (a logo, a second template) can be added later without
 * changing the key or migrating every instance.
 */
import monday from '../services/monday-sdk.js';
import logger from './logger.js';

export const ASSETS_KEY_BASE = 'docs_export_assets';

/**
 * Conservative ceiling under monday's ~6MB per-object storage cap. Measured on the
 * base64 string, which IS what gets stored (the decoded .docx is ~75% of it).
 */
export const TEMPLATE_MAX_BYTES = 6 * 1024 * 1024;

const TIMEOUT_MS = 5000;
const FALSE_EMPTY_RETRY_MS = 150;

/** In-memory fallback for local dev with no storage bridge (see settingsStore). */
const memory = new Map();

/** @visibleForTesting */
export function __clearMemoryCache() {
  memory.clear();
}

/**
 * The keys to try, most specific first.
 * @param {Object} [context]
 * @returns {string[]}
 */
export function assetsKeyCandidates(context) {
  const ids = [context?.instanceId, context?.boardId]
    .filter((id) => id !== undefined && id !== null && String(id).trim() !== '')
    .map((id) => String(id));
  return [...new Set([...ids, 'default'])].map((id) => `${ASSETS_KEY_BASE}_${id}`);
}

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('storage timeout')), TIMEOUT_MS)),
  ]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read one key; null means "nothing there". Never throws. */
async function readRaw(key) {
  try {
    const res = await withTimeout(monday.storage.getItem(key));
    if (res?.data?.success === false) {
      logger.warn('assetsStore', 'קריאת תבנית הדוח מ-monday.storage נכשלה', {
        key,
        response: res?.data,
      });
      return null;
    }
    return res?.data?.value ?? null;
  } catch (err) {
    logger.warn('assetsStore', 'קריאת תבנית הדוח נכשלה — ממשיכים בלי תבנית', err);
    return null;
  }
}

async function readPass(keys) {
  for (const key of keys) {
    const raw = await readRaw(key);
    if (raw) return { key, raw };
  }
  return null;
}

/** Empty string, whitespace and null all mean "no template". */
function normalizeTemplate(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Load the uploaded template as base64, or null when none was uploaded.
 * Never throws — a missing template must cost the report its header/footer, not
 * the whole export.
 *
 * @param {Object} [context]
 * @returns {Promise<string|null>}
 */
export async function loadTemplate(context) {
  const keys = assetsKeyCandidates(context);

  let hit = await readPass(keys);
  if (!hit) {
    // The same false-empty race as the settings blob: re-read once before
    // concluding that no template was uploaded.
    await sleep(FALSE_EMPTY_RETRY_MS);
    hit = await readPass(keys);
  }

  if (!hit) {
    for (const key of keys) {
      if (memory.has(key)) return memory.get(key);
    }
    return null;
  }

  try {
    const parsed = JSON.parse(hit.raw);
    return normalizeTemplate(parsed?.templateDocx);
  } catch (err) {
    logger.error('assetsStore', 'תבנית הדוח השמורה פגומה ואינה ניתנת לפענוח', err, {
      key: hit.key,
    });
    return null;
  }
}

/**
 * Persist (or clear, with null) the uploaded template.
 *
 * @param {Object} [context]
 * @param {string|null} base64 - the .docx as base64, no `data:` prefix
 * @returns {Promise<string|null>} the stored value
 * @throws {Error} `err.code === 'quota'` when over TEMPLATE_MAX_BYTES (nothing is
 *   written); a plain Error when a real instance's write could not be confirmed
 */
export async function saveTemplate(context, base64) {
  const templateDocx = normalizeTemplate(base64);
  const bytes = templateDocx ? templateDocx.length : 0;

  if (bytes > TEMPLATE_MAX_BYTES) {
    const err = new Error(
      `קובץ התבנית חורג ממגבלת האחסון (${(bytes / 1024 / 1024).toFixed(1)}MB מתוך 6MB). ` +
        'הקטינו את הקובץ — למשל על ידי הקטנת הלוגו שבכותרת.'
    );
    err.code = 'quota';
    // Thrown BEFORE any write: a rejected upload must leave the previous template
    // in place.
    throw err;
  }

  const [primaryKey] = assetsKeyCandidates(context);
  const serialized = JSON.stringify({ templateDocx });
  const hasInstance = Boolean(context?.instanceId || context?.boardId);

  try {
    const res = await withTimeout(monday.storage.setItem(primaryKey, serialized));
    if (res?.data?.success === false) {
      throw new Error(
        `template write rejected by monday.storage: ${res?.errorMessage || res?.data?.error || 'no reason given'}`
      );
    }
    let stored = await readRaw(primaryKey);
    if (stored !== serialized) {
      await sleep(FALSE_EMPTY_RETRY_MS);
      stored = await readRaw(primaryKey);
    }
    if (stored !== serialized) {
      throw new Error('template write did not persist (read-back mismatch)');
    }
  } catch (err) {
    if (hasInstance) {
      logger.error('assetsStore', 'שמירת תבנית הדוח נכשלה — ייתכן שהקובץ לא נשמר', err, {
        key: primaryKey,
        bytes,
      });
      throw err;
    }
    logger.warn(
      'assetsStore',
      'אחסון תבנית הדוח אינו זמין (פיתוח מקומי) — נשמר בזיכרון בלבד לסשן הזה',
      err
    );
  }

  memory.set(primaryKey, templateDocx);
  return templateDocx;
}
