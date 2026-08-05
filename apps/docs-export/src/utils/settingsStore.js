/**
 * The settings blob in monday.storage.
 *
 * @module utils/settingsStore
 *
 * Ported from `apps/discussions/src/utils/exportAssets.js` (JSON value, 5s timeout
 * on every read, key fallback instanceId → boardId → 'default', never blocks
 * render) and hardened with the two quirks this app has hit live:
 *
 *  1. **The false-empty read.** A CONFIGURED instance can transiently answer
 *     `success:true, value:null`. Trusting that first null once shipped the
 *     onboarding wizard to instances that were already configured (Axis Planner).
 *     So a fully-empty pass is re-read ONCE before concluding "unconfigured" —
 *     which is also why loadSettings distinguishes null (nothing stored) from a
 *     read that merely failed.
 *  2. **The lying write.** `monday.storage.setItem` can RESOLVE even when nothing
 *     persisted (see apps/team-people-column/src/services/mondayService.js), and
 *     the failure can also arrive in-band as `{ data: { success: false } }`. So a
 *     save is confirmed by READING IT BACK, and a configured instance THROWS on
 *     mismatch — reporting a successful save that did not happen is worse than an
 *     error toast.
 *
 * Scope decision: this module is deliberately schema-agnostic. It stores and
 * merges whatever JSON it is given; version migration and defaults live in
 * `domain/settingsSchema.js` (`normalizeSettings`). Storage must not have to be
 * redeployed to learn about a new settings version.
 *
 * Key note: the value is written to GLOBAL storage under an instance-scoped KEY
 * (not `storage.instance`), matching discussions — the key is reconstructible from
 * either instanceId or boardId, which is what makes the fallback chain possible.
 * On a board_view the `instanceId` is the boardViewId.
 */
import monday from '../services/monday-sdk.js';
import logger from './logger.js';

export const SETTINGS_KEY_BASE = 'docs_export_settings';

const TIMEOUT_MS = 5000;

/** Delay before the single re-read that defeats the false-empty race. */
const FALSE_EMPTY_RETRY_MS = 150;

/**
 * Last-resort in-memory fallback for local dev with no storage bridge. Keyed by
 * storage key so a save→load round-trip works within the session. Never a cache
 * for real storage: it is consulted only AFTER storage came back with nothing.
 */
const memory = new Map();

/** @visibleForTesting */
export function __clearMemoryCache() {
  memory.clear();
}

/**
 * The keys to try, most specific first. Everything is stringified because a
 * context delivers numeric ids while stored keys are strings.
 * @param {Object} [context] - the monday context
 * @returns {string[]}
 */
export function settingsKeyCandidates(context) {
  const ids = [context?.instanceId, context?.boardId]
    .filter((id) => id !== undefined && id !== null && String(id).trim() !== '')
    .map((id) => String(id));
  return [...new Set([...ids, 'default'])].map((id) => `${SETTINGS_KEY_BASE}_${id}`);
}

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('storage timeout')), TIMEOUT_MS)),
  ]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read one key. Returns the raw string, or null for "nothing there".
 * Never throws — a load must never block render.
 * @returns {Promise<string|null>}
 */
async function readRaw(key) {
  try {
    const res = await withTimeout(monday.storage.getItem(key));
    if (res?.data?.success === false) {
      logger.warn('settingsStore', 'קריאת ההגדרות מ-monday.storage נכשלה', {
        key,
        response: res?.data,
      });
      return null;
    }
    return res?.data?.value ?? null;
  } catch (err) {
    // Storage unavailable (local dev outside the iframe) or a 5s timeout. Not
    // fatal: the caller degrades to "no settings yet".
    logger.warn('settingsStore', 'קריאת ההגדרות מ-monday.storage נכשלה — ממשיכים בלי הגדרות', err);
    return null;
  }
}

/** Try every candidate key once, returning the first hit as { key, raw }. */
async function readPass(keys) {
  for (const key of keys) {
    const raw = await readRaw(key);
    if (raw) return { key, raw };
  }
  return null;
}

function parseOrNull(raw, key) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    // Corrupt blob: ERROR (not warn) — the owner needs to know their settings are
    // unreadable, otherwise the app silently looks unconfigured forever.
    logger.error('settingsStore', 'ההגדרות השמורות פגומות ואינן ניתנות לפענוח', err, { key });
    return null;
  }
}

/**
 * Load the instance's settings blob, or null when nothing is stored.
 *
 * Never throws and never blocks: on any storage failure it reports null so the
 * gate can fall back to defaults.
 *
 * @param {Object} [context] - the monday context (instanceId / boardId)
 * @returns {Promise<Object|null>} the RAW stored blob (normalize it in the domain layer)
 */
export async function loadSettings(context) {
  const keys = settingsKeyCandidates(context);

  let hit = await readPass(keys);
  if (!hit) {
    // Every candidate came back empty. That is either a genuinely unconfigured
    // instance or the false-empty race — and the two are indistinguishable from
    // one read, so re-read once before deciding.
    await sleep(FALSE_EMPTY_RETRY_MS);
    hit = await readPass(keys);
  }

  if (!hit) {
    for (const key of keys) {
      if (memory.has(key)) return memory.get(key);
    }
    return null;
  }

  return parseOrNull(hit.raw, hit.key);
}

/** Shallow-merge one level deep: role maps merge, arrays and scalars replace. */
function mergeSettings(current, partial) {
  const merged = { ...(current || {}) };
  for (const [key, value] of Object.entries(partial || {})) {
    const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? { ...merged[key], ...value }
      : value;
  }
  return merged;
}

/**
 * Persist a PARTIAL update over the stored blob and return the merged result.
 *
 * `columns` / `headers` merge key-by-key (so saving one role does not wipe the
 * others); `blocks` and scalars replace wholesale (an edited block list is
 * authoritative — merging it would resurrect deleted blocks).
 *
 * Writes to the PRIMARY key even when the blob was read from a fallback key, so an
 * instance migrates forward on its first save; the stale fallback copy is left
 * untouched rather than silently rewritten.
 *
 * @param {Object} [context]
 * @param {Object} partial - the fields to change
 * @returns {Promise<Object>} the merged blob
 * @throws {Error} when a real instance's write could not be confirmed
 */
export async function saveSettings(context, partial) {
  const [primaryKey] = settingsKeyCandidates(context);
  const current = await loadSettings(context);
  const merged = mergeSettings(current, partial);
  const serialized = JSON.stringify(merged);
  const hasInstance = Boolean(context?.instanceId || context?.boardId);

  try {
    const res = await withTimeout(monday.storage.setItem(primaryKey, serialized));
    if (res?.data?.success === false) {
      throw new Error(
        `settings write rejected by monday.storage: ${res?.errorMessage || res?.data?.error || 'no reason given'}`
      );
    }
    // setItem can resolve without persisting — the only proof is a read-back.
    let stored = await readRaw(primaryKey);
    if (stored !== serialized) {
      await sleep(FALSE_EMPTY_RETRY_MS);
      stored = await readRaw(primaryKey);
    }
    if (stored !== serialized) {
      throw new Error('settings write did not persist (read-back mismatch)');
    }
  } catch (err) {
    if (hasInstance) {
      logger.error('settingsStore', 'שמירת ההגדרות נכשלה — ייתכן שהשינוי לא נשמר', err, {
        key: primaryKey,
      });
      throw err;
    }
    // No instance and no board: local dev outside the iframe. Keep the value in
    // memory for this session so the UI stays usable, and say so.
    logger.warn(
      'settingsStore',
      'אחסון ההגדרות אינו זמין (פיתוח מקומי) — נשמר בזיכרון בלבד לסשן הזה',
      err
    );
  }

  memory.set(primaryKey, merged);
  return merged;
}
