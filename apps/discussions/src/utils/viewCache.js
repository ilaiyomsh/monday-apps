/*
 * viewCache — a tiny, versioned, TTL'd stale-while-revalidate cache for the
 * personal views ("המשימות שלי" / "ההחלטות שלי"), backed by localStorage.
 *
 * The personal-view hooks (useMyTasks / useMyDecisions) SEED their initial state
 * from here on mount for an instant first paint, then ALWAYS revalidate in the
 * background and overwrite the entry with fresh data. The app also PRE-WARMS
 * these entries in the background (App.jsx prefetch) so first entry is fast.
 *
 * What is cached: the RAW fetched item list the hook holds BEFORE the view's
 * client-side filter/sort/group, plus the pagination cursor — so a seed restores
 * the full working set and every toolbar keeps working instantly. Only the
 * DEFAULT query (no search / no server sort / no creator filter) is cached, so
 * a filtered result never pollutes the default seed.
 *
 * Safety: every read/write is wrapped in try/catch (private mode / quota / SSR),
 * the payload carries a schema `version` (mismatch → treated as a miss) and a
 * per-entry timestamp (older than the hard max age → dropped). A stale entry
 * (older than the TTL) is STILL returned for seeding — the caller always
 * revalidates — it is merely flagged `stale`.
 *
 * Every failure path is RECORDED at warn level (never a toast): the cache is
 * advisory, so a private-mode / quota / corrupt-entry failure must degrade to a
 * plain cache MISS — but silently swallowing it would hide a storage problem
 * that makes every personal view slow to paint.
 */
import logger from './logger.js';

// Bump when the cached row shape changes (e.g. the fetched columns change), so
// old entries from a previous deploy are ignored instead of mis-seeding.
//   2 — round305: the My Tasks rows gained partnersID (+ taskViewersID /
//       taskEditorsID for the permission scan). A v1 entry would seed rows with
//       NO partners, so the שותפים cell would open empty and an edit made from
//       that state would replace the real partner list.
//   3 — round340: taskViewersID was retired, so it left RENDERED_COLUMNS. A v2 entry
//       carries a field the code no longer knows about; harmless to read, but the
//       convention here is that any change to the fetched column set bumps this, and
//       honouring it keeps "does the cache match the code" a single comparison.
export const VIEW_CACHE_VERSION = 3;

// Key namespace. Full key: `disc.viewcache.<view>[.<subTab>].<userId>.<boardId>`.
const PREFIX = 'disc.viewcache';

// Soft freshness window: past this a seed is still shown but definitely
// revalidated (the hooks always revalidate anyway, so this only flags `stale`).
export const VIEW_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Hard cap: entries older than this are never seeded (and are dropped on read).
const VIEW_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

function getStore() {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage || null;
  } catch (err) {
    // access to localStorage can itself throw (sandboxed iframes)
    logger.warn('viewCache', 'localStorage לא נגיש — הזנת הקאש מושבתת', err);
    return null;
  }
}

// Build the storage key for a view entry, or null when the identity is missing
// (no user / no board → no stable key → no cache).
export function makeViewCacheKey(view, { userId, boardId, subTab = null } = {}) {
  if (!view || userId == null || userId === '' || boardId == null || boardId === '') return null;
  const seg = subTab ? `${view}.${subTab}` : view;
  return `${PREFIX}.${seg}.${userId}.${boardId}`;
}

// --- Date-preserving (de)serialization -------------------------------------
// A plain JSON round-trip stringifies a Date to an ISO STRING, losing both its
// Date-ness AND the `hasTime` flag parseValue('date') attaches. The personal-view
// hooks cache ALREADY-NORMALIZED rows (mapItem/parseValue output), whose date
// columns (deadlineID / decisionDateID) are Date objects — so a naive seed made
// those fields strings, and every consumer that calls a Date method on them
// (`toLocaleDateString` in the row cells + DatePickerPopover, `.getTime()` in
// sort/group/filter) threw "... is not a function".
//
// We tag Date values on write and revive them on read, so a SEEDED row is the
// exact same shape as a FRESHLY-FETCHED one (Dates reconstructed, hasTime
// restored). This is type-driven, not field-name-driven: any Date survives, and
// non-Date values are untouched — notably `created_at`, which is a STRING in a
// fresh row, STAYS a string (it must not become a Date).
const DATE_TAG = '@@date';

// Deep-copy `value`, replacing every Date with a typed marker so a plain
// JSON.stringify preserves it (stringify alone drops Date-ness AND the hasTime
// flag). Done as an explicit pre-pass — not a stringify replacer — so it never
// depends on the toJSON-vs-replacer ordering and carries no `this`. Only Dates
// change shape; strings/numbers/arrays/objects (incl. `created_at`) are copied
// through unchanged.
function tagDates(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null // an invalid Date can't seed anything useful
      : { [DATE_TAG]: value.toISOString(), hasTime: value.hasTime === true };
  }
  if (Array.isArray(value)) return value.map(tagDates);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tagDates(v)]));
  }
  return value;
}

// JSON.parse reviver. Reconstruct a real Date (and the hasTime flag, exactly as
// parseValue sets it: an own boolean) from the marker; a corrupt marker → null.
function reviveDates(key, value) {
  if (value && typeof value === 'object' && typeof value[DATE_TAG] === 'string') {
    const d = new Date(value[DATE_TAG]);
    if (Number.isNaN(d.getTime())) return null;
    d.hasTime = value.hasTime === true;
    return d;
  }
  return value;
}

// Read + validate an entry. Returns { items, cursor, ts, stale } or null on a
// miss / version mismatch / hard-expiry / any storage or parse error.
export function readViewCache(key, { ttlMs = VIEW_CACHE_TTL_MS, now = Date.now() } = {}) {
  const store = getStore();
  if (!store || !key) return null;
  let raw;
  try {
    raw = store.getItem(key);
  } catch (err) {
    logger.warn('viewCache', 'קריאת הקאש נכשלה — ממשיכים ללא הזנה', err);
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw, reviveDates); // revive tagged Date fields back into real Dates
  } catch (err) {
    logger.warn('viewCache', 'הרשומה בקאש פגומה — מטופלת כהחמצה', err);
    return null; // corrupt entry — treat as a miss
  }
  if (!parsed || parsed.version !== VIEW_CACHE_VERSION || !Array.isArray(parsed.items)) return null;
  const ts = Number(parsed.ts) || 0;
  const age = now - ts;
  if (!(age >= 0) || age > VIEW_CACHE_MAX_AGE_MS) {
    // Missing/negative/too-old timestamp — drop it and miss.
    try {
      store.removeItem(key);
    } catch (err) {
      logger.warn('viewCache', 'מחיקת רשומת קאש שפג תוקפה נכשלה', err);
    }
    return null;
  }
  return {
    items: parsed.items,
    cursor: parsed.cursor ?? null,
    ts,
    stale: age > ttlMs,
  };
}

// Overwrite an entry with a fresh list + cursor. Best-effort: any failure
// (quota / serialization / storage) is swallowed and reported via the return.
export function writeViewCache(key, items, cursor = null, { now = Date.now() } = {}) {
  const store = getStore();
  if (!store || !key || !Array.isArray(items)) return false;
  let raw;
  try {
    // Tag Date fields (tagDates) so they survive as real Dates on read.
    raw = JSON.stringify(tagDates({ version: VIEW_CACHE_VERSION, ts: now, items, cursor: cursor ?? null }));
  } catch (err) {
    logger.warn('viewCache', 'סריאליזציית שורות לקאש נכשלה — הקאש לא עודכן', err);
    return false; // non-serializable row (shouldn't happen for plain data)
  }
  try {
    store.setItem(key, raw);
    return true;
  } catch (err) {
    logger.warn('viewCache', 'כתיבת הקאש נכשלה (מכסה/מצב פרטי) — התצוגה תיטען מהשרת', err);
    return false; // quota / private mode — cache is purely advisory
  }
}

// Remove an entry (exposed for tests / future cache invalidation).
export function clearViewCache(key) {
  const store = getStore();
  if (!store || !key) return;
  try {
    store.removeItem(key);
  } catch (err) {
    logger.warn('viewCache', 'מחיקת רשומת קאש נכשלה', err);
  }
}

// Reconcile a background cache-seeded revalidate. The fresh server page is
// AUTHORITATIVE for membership + values (so a remote edit shows, and a row
// deleted elsewhere disappears), EXCEPT for ids the local user has touched this
// session (`dirty`): those keep their current optimistic row, and a locally
// (deferred-)deleted row is NOT re-added. Optimistic creates (temp ids) not yet
// in the fresh page are preserved too. Pure — shared by the personal-view hooks.
export function reconcileSeeded(current, fresh, dirty = new Set()) {
  const curById = new Map((current || []).map((r) => [String(r.id), r]));
  const seen = new Set();
  const out = [];
  for (const r of fresh || []) {
    const id = String(r.id);
    if (dirty.has(id) && !curById.has(id)) continue; // locally deleted → honor the delete
    out.push(dirty.has(id) && curById.has(id) ? curById.get(id) : r); // protect local edit; else take fresh
    seen.add(id);
  }
  for (const r of current || []) {
    const id = String(r.id);
    // Keep optimistic creates (temp ids) + any dirty row missing from the page;
    // drop untouched rows the server no longer returns (honors remote deletes).
    if (!seen.has(id) && (dirty.has(id) || id.startsWith('temp-'))) out.push(r);
  }
  return out;
}
