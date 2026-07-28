import { useState, useEffect, useCallback, useRef } from 'react';

import mondayService from '../services/mondayService.js';
import logger from '../utils/logger.js';
import { migrateSettings } from '../domain/settingsSchema.js';
import { cacheGet, cacheSet, cacheRemove } from '../utils/swrCache.js';

const RETRY_DELAY_MS = 350;
const SETTINGS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const settingsCacheKey = (boardId, columnId) => `settings:${boardId}:${columnId}`;

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
      setSettings(migrated);
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
