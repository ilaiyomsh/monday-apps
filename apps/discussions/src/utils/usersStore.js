/*
 * usersStore — a single in-memory cache of monday account users
 * ({ id, name, photo_thumb }), persisted to monday.storage so avatars paint
 * INSTANTLY on the next session instead of fetching photos per-render.
 *
 * Modeled on the Planner app's silent-sync pattern:
 *   • hydrateFromStorage()  — fast path on boot: fill the in-memory map from the
 *                             last persisted roster (no API, survives reload).
 *   • ensureRoster()        — load the full account roster ONCE (deduped). Called
 *                             silently when an admin/board-owner connects (App.jsx)
 *                             and lazily by PersonPicker (which needs the full list
 *                             to pick from). Keeps the persisted cache fresh.
 *   • ensureUsers(ids)      — fallback for non-managers / cold cache: fetch only
 *                             the missing ids on demand, then persist.
 *
 * It is a module-level singleton (like board-config-store) and exposes a
 * subscribe()/getVersion() pair so React components re-render via
 * useSyncExternalStore when the cache changes.
 */
import { api, monday, ensureUserPhotoSelection, normalizePhoto } from './mondayApi/monday-client.js';
import logger from './logger.js';

const STORAGE_KEY = 'discussions_users_cache';

const byId = new Map(); // id -> { id, name, photo_thumb }
let rosterLoaded = false; // the full account roster has been synced this session
let rosterPromise = null; // in-flight ensureRoster() (dedup concurrent callers)
let version = 0;
const listeners = new Set();

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

// ---- React glue (useSyncExternalStore) ----
export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getVersion() {
  return version;
}

// ---- reads (synchronous, from memory) ----
export function getUser(id) {
  return byId.get(String(id)) || null;
}
export function getAllUsers() {
  return Array.from(byId.values());
}
export function hasRoster() {
  return rosterLoaded;
}

// Merge externally-sourced users (e.g. a board's subscribers, from
// useBoardSubscribers) into the shared cache so their names/avatars resolve
// everywhere the app shows a person. Persists opportunistically (survives
// reload). Returns whether anything changed. Shape: [{ id, name, photo_thumb }].
export function ingestUsers(list) {
  const changed = mergeUsers(list);
  if (changed) persist();
  return changed;
}

// Merge a list of {id, name, photo_thumb} into the map; emit only on a real change.
function mergeUsers(list) {
  let changed = false;
  (list || []).forEach((u) => {
    if (!u || u.id == null) return;
    const id = String(u.id);
    const prev = byId.get(id);
    const next = {
      id,
      name: u.name ?? prev?.name ?? '',
      photo_thumb: u.photo_thumb ?? prev?.photo_thumb ?? null,
    };
    if (!prev || prev.name !== next.name || prev.photo_thumb !== next.photo_thumb) changed = true;
    byId.set(id, next);
  });
  if (changed) emit();
  return changed;
}

async function persist() {
  try {
    await monday.storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ users: getAllUsers(), updatedAt: new Date().toISOString() })
    );
  } catch (err) {
    logger.warn('usersStore', 'שמירת מטמון המשתמשים נכשלה', err);
  }
}

// Fast path on boot — hydrate from the last persisted roster (no API call).
export async function hydrateFromStorage() {
  try {
    const res = await monday.storage.getItem(STORAGE_KEY);
    const raw = res?.data?.value;
    if (!raw) return;
    const parsed = JSON.parse(raw);
    mergeUsers(parsed.users || []);
    logger.info('usersStore', 'מטמון משתמשים נטען מהאחסון', { count: (parsed.users || []).length });
  } catch (err) {
    logger.warn('usersStore', 'טעינת מטמון המשתמשים מהאחסון נכשלה', err);
  }
}

// Silent full-roster sync. One query, merged + persisted. The CALLER decides
// when to run it (e.g. an admin/owner connecting); ensureRoster() dedupes it.
export async function syncAllUsers() {
  try {
    const photo = await ensureUserPhotoSelection();
    const data = await api(
      `query { users (limit: 500) { id name ${photo} } }`,
      {},
      'usersStore.syncAllUsers'
    );
    // Flatten photo_url { small } -> the flat `photo_thumb` cache field consumers read.
    mergeUsers((data?.users || []).map((u) => ({ id: u.id, name: u.name, photo_thumb: normalizePhoto(u) })));
    rosterLoaded = true;
    await persist();
    logger.info('usersStore', 'סנכרון משתמשי החשבון הושלם', { count: (data?.users || []).length });
  } catch (err) {
    logger.error('usersStore', 'סנכרון משתמשי החשבון נכשל', err);
  }
}

// Load the full roster once (deduped). Safe to call from multiple places.
export function ensureRoster() {
  if (rosterLoaded) return Promise.resolve();
  if (!rosterPromise) {
    rosterPromise = syncAllUsers().finally(() => { rosterPromise = null; });
  }
  return rosterPromise;
}

// Fallback path: fetch only the ids we don't have yet (non-managers / cold cache).
export async function ensureUsers(ids) {
  const missing = [...new Set((ids || []).map(String))].filter((id) => id && !byId.has(id));
  if (missing.length === 0) return;
  try {
    const photo = await ensureUserPhotoSelection();
    const data = await api(
      `query ($ids: [ID!]) { users(ids: $ids) { id name ${photo} } }`,
      { ids: missing },
      'usersStore.ensureUsers'
    );
    const changed = mergeUsers((data?.users || []).map((u) => ({ id: u.id, name: u.name, photo_thumb: normalizePhoto(u) })));
    if (changed) persist(); // opportunistic — survives reload even without an admin sync
  } catch (err) {
    logger.error('usersStore', 'טעינת משתמשים לפי מזהה נכשלה', err);
  }
}
