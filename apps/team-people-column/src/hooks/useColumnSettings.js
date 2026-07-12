import { useState, useEffect, useCallback } from 'react';

import mondayService from '../services/mondayService.js';
import logger from '../utils/logger.js';
import { migrateSettings } from '../domain/settingsSchema.js';

// monday.storage transiently answers success:true + value:null for a key that
// IS populated (the "false-empty" first-read race that shipped a blank
// onboarding screen to configured instances). A single null read must not be
// trusted as "unconfigured": read once, and if null, retry ONCE after this
// delay before deciding.
const RETRY_DELAY_MS = 350;

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

  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let raw = await mondayService.getColumnConfig(boardId, columnId);
      // A null first read may be the false-empty race — retry once before
      // treating it as genuinely unconfigured.
      if (raw === null) {
        await wait(RETRY_DELAY_MS);
        raw = await mondayService.getColumnConfig(boardId, columnId);
      }
      setSettings(migrateSettings(raw));
    } catch (err) {
      logger.error('useColumnSettings', 'Failed to load column settings from storage', err);
      setError(err);
      setSettings(null);
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
