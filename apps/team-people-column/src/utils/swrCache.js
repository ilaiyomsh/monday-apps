// swrCache — a tiny stale-while-revalidate cache on top of localStorage.
//
// Why: the on-click dialog iframe is created from scratch on EVERY cell click,
// so nothing in memory survives between opens. localStorage (scoped to the app
// CDN origin, partitioned per monday tab) does survive, which lets a re-open
// paint the picker instantly from the last resolved result while the fresh
// chain revalidates in the background.
//
// Disabled under vitest (MODE === 'test'): the behavioral tests assert exact
// fetch/retry sequences and must not be short-circuited by a warm cache.
// The cache itself is covered by its own unit tests via the `force` option.
//
// All storage access is try/catch-guarded: quota errors / privacy modes make
// localStorage throw, and a cache must never take the feature down with it.

import logger from './logger.js';

const PREFIX = 'tpcCache:';

const isTestEnv = () =>
  typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';

function storageAvailable() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch (err) {
    // Accessing window.localStorage itself throws in sandboxed iframes — an
    // expected environment condition, recorded once per check for visibility.
    logger.warn('swrCache', 'localStorage unavailable in this context', err);
    return false;
  }
}

/**
 * Read a cached entry. Returns the stored value, or null when absent, expired,
 * signature-mismatched, or unreadable.
 *
 * @param {string} key - logical key (prefixed internally).
 * @param {{ maxAgeMs?: number, signature?: string, force?: boolean }} [opts]
 *   `signature` must equal the one stored with the entry (settings changed ->
 *   cached result is for a different configuration -> miss).
 *   `force` bypasses the test-env kill switch (used by the cache's own tests).
 */
export function cacheGet(key, { maxAgeMs = 10 * 60 * 1000, signature, force = false } = {}) {
  if ((isTestEnv() && !force) || !storageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.ts !== 'number') return null;
    if (Date.now() - entry.ts > maxAgeMs) return null;
    if (signature !== undefined && entry.sig !== signature) return null;
    return entry.value;
  } catch (err) {
    // Corrupted entry / storage read failure — a cache miss, never a crash.
    logger.warn('swrCache', `Failed to read cache key "${key}"`, err);
    return null;
  }
}

/**
 * Store a value with a timestamp and optional signature.
 * @param {string} key
 * @param {*} value - must be JSON-serializable.
 * @param {{ signature?: string, force?: boolean }} [opts]
 */
export function cacheSet(key, value, { signature, force = false } = {}) {
  if ((isTestEnv() && !force) || !storageAvailable()) return;
  try {
    window.localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ ts: Date.now(), sig: signature, value }),
    );
  } catch (err) {
    // Quota exceeded / privacy mode — the feature works without the cache.
    logger.warn('swrCache', `Failed to write cache key "${key}"`, err);
  }
}

/**
 * Remove a cached entry (e.g. configuration was cleared).
 * @param {string} key
 * @param {{ force?: boolean }} [opts]
 */
export function cacheRemove(key, { force = false } = {}) {
  if ((isTestEnv() && !force) || !storageAvailable()) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch (err) {
    logger.warn('swrCache', `Failed to remove cache key "${key}"`, err);
  }
}
