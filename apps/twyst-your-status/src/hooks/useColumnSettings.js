import { useState, useEffect, useCallback, useRef } from 'react';

import mondayService from '../services/mondayService.js';
import logger from '../utils/logger.js';
import { migrateSettings } from '../domain/settingsSchema.js';
import { cacheGet, cacheSet, cacheRemove } from '../utils/swrCache.js';

// monday.storage transiently answers success:true + value:null for a key that
// IS populated (the "false-empty" first-read race that shipped a blank
// onboarding screen to configured instances). A single null read must not be
// trusted as "unconfigured": read once, and if null, retry ONCE after this
// delay before deciding.
//
// This is the ONLY retry on the path. mondayService.getColumnConfig used to hold
// a second one, so an unconfigured column — which is every column nobody has
// configured, and which is never cached — paid 4 reads and 1050ms of sleeping to
// reach the same answer.
const RETRY_DELAY_MS = 350;

// Settings change rarely; a long TTL keeps re-opens instant. The background
// revalidation still corrects a stale entry within one open.
const SETTINGS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const settingsCacheKey = (boardId, columnId) => `settings:${boardId}:${columnId}`;

// migrateSettings builds a FRESH object on every read, so a revalidation that
// confirms nothing changed still handed consumers a new identity — and
// OnClickDialog keys its board fetch on this object. That cost a warm open a
// second round trip, and because the boot overlay is already down by then, the
// dialog went blank for the length of it before repainting the same pills.
//
// A string compare is sound HERE SPECIFICALLY because migrateSettings emits a
// fixed key order (settingsSchema.migrateSettings), so equal content always
// serializes identically. A miss would only restore today's behaviour; a false
// "same" cannot happen. Deliberately not hoisted into settingsSchema.js — this
// is a property of this hook's use of it, not of the schema.
const sameSettings = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load persisted column settings from global storage (boardId + columnId).
 */
export default function useColumnSettings(context) {
  const boardId = context?.boardId;
  const columnId = context?.columnId;

  const cached = boardId && columnId
    ? cacheGet(settingsCacheKey(boardId, columnId), { maxAgeMs: SETTINGS_CACHE_MAX_AGE_MS })
    : null;

  const [settings, setSettings] = useState(cached);
  const [loading, setLoading] = useState(cached == null);
  const hadCacheRef = useRef(cached != null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!boardId || !columnId) {
      setSettings(null);
      setLoading(false);
      return;
    }
    if (!hadCacheRef.current) setLoading(true);
    setError(null);
    try {
      let raw = await mondayService.getColumnConfig(boardId, columnId);
      if (raw === null) {
        await wait(RETRY_DELAY_MS);
        raw = await mondayService.getColumnConfig(boardId, columnId);
      }
      const migrated = migrateSettings(raw);
      // The functional form is load-bearing: `prev` is the value React currently
      // holds, which on a warm open is the cache seed. Comparing against a ref
      // captured at mount instead would pass the reload case and miss this one.
      setSettings((prev) => (sameSettings(prev, migrated) ? prev : migrated));
      // The cache write is unconditional either way — it refreshes `ts`, which is
      // what keeps the next open warm.
      if (migrated) {
        cacheSet(settingsCacheKey(boardId, columnId), migrated);
      } else {
        cacheRemove(settingsCacheKey(boardId, columnId));
      }
    } catch (err) {
      logger.error('useColumnSettings', 'Failed to load column settings from storage', err);
      if (!hadCacheRef.current) {
        setError(err);
        setSettings(null);
      }
    } finally {
      setLoading(false);
    }
  }, [boardId, columnId]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => {
    load();
  }, [load]);

  return { settings, loading, error, reload };
}
