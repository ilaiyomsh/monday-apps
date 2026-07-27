// swrCache — stale-while-revalidate cache on top of localStorage for dialog
// iframes that reload on every open. Modeled on team-people-column.

import logger from './logger.js';

const PREFIX = 'twystCache:';

const isTestEnv = () =>
  typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';

function storageAvailable() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch (err) {
    logger.warn('swrCache', 'localStorage unavailable in this context', err);
    return false;
  }
}

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
    logger.warn('swrCache', `Failed to read cache key "${key}"`, err);
    return null;
  }
}

export function cacheSet(key, value, { signature, force = false } = {}) {
  if ((isTestEnv() && !force) || !storageAvailable()) return;
  try {
    window.localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ ts: Date.now(), sig: signature, value }),
    );
  } catch (err) {
    logger.warn('swrCache', `Failed to write cache key "${key}"`, err);
  }
}

export function cacheRemove(key, { force = false } = {}) {
  if ((isTestEnv() && !force) || !storageAvailable()) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch (err) {
    logger.warn('swrCache', `Failed to remove cache key "${key}"`, err);
  }
}
