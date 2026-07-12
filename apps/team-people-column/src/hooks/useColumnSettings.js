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
const RETRY_DELAY_MS = 350;

// Settings change rarely; a long TTL keeps re-opens instant. The background
// revalidation still corrects a stale entry within one open.
const SETTINGS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const settingsCacheKey = (boardId, columnId) => `settings:${boardId}:${columnId}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load the persisted column settings from global storage, keyed by the
 * context's boardId + columnId (column-view dialogs have no instanceId, so
 * instance storage is unusable — see mondayService.getColumnConfig).
 *
 * @param {object} context - the monday SDK context; boardId and columnId are
 *   the storage-key inputs.
 * @returns {{ settings: object|null, loading: boolean, error: Error|null, reload: () => void }}
 *   `settings` is the migrated v1 settings object, or null when unconfigured.
 */
export default function useColumnSettings(context) {
  const boardId = context?.boardId;
  const columnId = context?.columnId;

  // Stale-while-revalidate: paint instantly from the local cache (the dialog
  // iframe reloads on every open, so monday.storage's round-trip + the 350ms
  // false-empty retry otherwise gate EVERY open), then let the real storage
  // read below confirm or correct it.
  const cached = boardId && columnId
    ? cacheGet(settingsCacheKey(boardId, columnId), { maxAgeMs: SETTINGS_CACHE_MAX_AGE_MS })
    : null;

  const [settings, setSettings] = useState(cached);
  const [loading, setLoading] = useState(cached == null);
  const hadCacheRef = useRef(cached != null);

  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    // With a warm cache the picker is already interactive — revalidate quietly
    // instead of flashing the loading state.
    if (!hadCacheRef.current) setLoading(true);
    setError(null);
    try {
      let raw = await mondayService.getColumnConfig(boardId, columnId);
      // A null first read may be the false-empty race — retry once before
      // treating it as genuinely unconfigured.
      if (raw === null) {
        await wait(RETRY_DELAY_MS);
        raw = await mondayService.getColumnConfig(boardId, columnId);
      }
      const migrated = migrateSettings(raw);
      setSettings(migrated);
      if (migrated) {
        cacheSet(settingsCacheKey(boardId, columnId), migrated);
      } else {
        cacheRemove(settingsCacheKey(boardId, columnId));
      }
    } catch (err) {
      logger.error('useColumnSettings', 'Failed to load column settings from storage', err);
      // A failed revalidation must not blank an already-painted cached UI.
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
