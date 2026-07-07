import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { monday } from '../utils/mondayApi/monday-client.js';
import { useMondayContext } from './MondayContext.jsx';
import { BOARD_KEYS, buildEmptyConfig, COLUMN_SCHEMA, migrateColumnAliases, DEFAULT_PERMISSIONS, DEFAULT_PERMISSION_SEED } from '../utils/mondayApi/boards.config.js';
import { setActiveConfig } from '../utils/mondayApi/board-config-store.js';
import logger from '../utils/logger.js';

// Diagnostic helper: log the storage-backed settings as BOTH an explorable
// object and a copy-paste-friendly JSON string (permanent — see enableDebugLogs()).
const dumpRaw = (label, data) => {
  logger.info('SettingsContext', `🔎 ${label} (object)`, data);
  let json;
  try { json = JSON.stringify(data, null, 2); } catch { json = '[unserializable]'; }
  logger.info('SettingsContext', `🔎 ${label} (JSON — copy this)`, json);
};

/* Overlay stored column mappings onto the CODE schema so `type`/`title` are
 * always authoritative from boards.config (only `id`/`verified` persist per
 * instance). Without this, a schema change like "סוג" dropdown→status never
 * reaches already-configured instances — the stale stored type would still
 * drive parse/format and the Settings column filter. */
function reconcileColumns(columns = {}) {
  const out = {};
  for (const boardKey of BOARD_KEYS) {
    const schema = COLUMN_SCHEMA[boardKey] || {};
    const saved = columns[boardKey] || {};
    out[boardKey] = { ...saved };
    for (const alias of Object.keys(schema)) {
      const s = saved[alias] || {};
      out[boardKey][alias] = { ...s, type: schema[alias].type, title: s.title || schema[alias].title };
    }
  }
  return out;
}

/*
 * The SETTINGS object is the single source of truth for which boards/columns
 * the app uses. There are NO hardcoded defaults: the mapping is loaded ONLY
 * from monday.storage (per instance) and published into the SDK store so
 * BoardSDK reads board/column ids from settings.
 *
 * Load order (matches tracker):
 *   MondayProvider loads context  ->  SettingsProvider waits for context,
 *   then loads from storage. If a mapping is found it is set + published and
 *   isConfigured=true; if nothing is stored, settings stays null and
 *   isConfigured=false so the app forces the Settings modal before content.
 */

const STORAGE_KEY_BASE = 'discussions_settings';
const TIMEOUT_MS = 5000;

// Exported so lightweight consumers/tests can inject a settings value directly
// without mounting the full SettingsProvider (mirrors MondayContext).
export const SettingsContext = createContext(null);
let missingProviderWarned = false;

// True only when every mapped board role has a real (non-empty) id.
function computeIsConfigured(s) {
  if (!s?.boards) return false;
  return BOARD_KEYS.every((key) => {
    const id = s.boards?.[key]?.id;
    return Boolean(id && String(id).trim());
  });
}

export function SettingsProvider({ children }) {
  const { context } = useMondayContext();
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadedRef = useRef(false);

  // publish whatever settings are active into the SDK store
  const publish = useCallback((s) => {
    setActiveConfig({ boards: s.boards, columns: s.columns });
  }, []);

  const load = useCallback(async () => {
    const instanceId = context?.instanceId || context?.boardId || 'default';
    const key = `${STORAGE_KEY_BASE}_${instanceId}`;
    logger.info('SettingsContext', '🔎 storage key resolved', {
      key, instanceId, ctxInstanceId: context?.instanceId, ctxBoardId: context?.boardId,
    });

    const withTimeout = (p) =>
      Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
      ]);

    try {
      const res = await withTimeout(monday.storage.getItem(key));
      if (res?.data?.value) {
        const saved = JSON.parse(res.data.value);
        // One-time alias rename migration: stored mappings are keyed by the OLD
        // column aliases (column1, tasksLink, …). Re-key them to the current
        // aliases so the renamed schema resolves without losing any mapping.
        const { columns: migratedColumns, changed } = migrateColumnAliases(saved.columns || {});
        const migrated = changed ? { ...saved, columns: migratedColumns } : saved;
        // Debug: expose on window so the console can read it regardless of log
        // level — `copy(window.__appSettings)`.
        if (typeof window !== 'undefined') window.__appSettings = migrated;
        dumpRaw('STORAGE SETTINGS (loaded)', migrated);
        setSettings(migrated);
        publish(migrated);
        // Persist the cleaned config so old keys don't linger in storage. Best
        // effort — if the write fails the in-memory migration still applies on
        // every load (it's idempotent).
        if (changed) {
          try {
            await monday.storage.setItem(key, JSON.stringify(migrated));
          } catch {
            /* storage write unavailable — migration stays in-memory */
          }
        }
      } else {
        // new instance (or empty) — no mapping yet; leave settings null.
        if (typeof window !== 'undefined') window.__appSettings = null;
        logger.info('SettingsContext', '🔎 STORAGE SETTINGS (empty — no mapping stored)', { key });
        setSettings(null);
      }
    } catch {
      // storage unavailable / parse error — treat as unconfigured.
      setSettings(null);
    } finally {
      setIsLoading(false);
    }
  }, [context, publish]);

  // gate on context: wait until the parent frame identifies the instance
  useEffect(() => {
    if (!context || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [context, load]);

  const updateSettings = useCallback(
    async (partial) => {
      // seed from current settings, or from an empty scaffold on first config
      const base = settings || buildEmptyConfig();
      const next = {
        ...base,
        ...partial,
        boards: { ...base.boards, ...(partial.boards || {}) },
        columns: { ...base.columns, ...(partial.columns || {}) },
      };

      // Deep-merge nested settings objects so a PARTIAL write never replaces the
      // whole object and silently wipes its siblings (the bare `...partial`
      // spread above would do exactly that). We only re-shape a nested key when
      // `base` or `partial` actually carries it — a fresh instance from
      // buildEmptyConfig() has neither `preferences` nor `permissions`, and we
      // must NOT pollute its stored settings with empty blobs.
      if ('preferences' in base || 'preferences' in partial) {
        next.preferences = { ...base.preferences, ...partial.preferences };
      }
      // `permissions` adds a nested `roles` deep-merge so a partial roles write
      // (one role at a time) preserves the other roles.
      if ('permissions' in base || 'permissions' in partial) {
        next.permissions = {
          ...base.permissions,
          ...partial.permissions,
          roles: { ...base.permissions?.roles, ...partial.permissions?.roles },
        };
      }
      // `exportTemplate` is written whole by the Export Template tab, so a
      // shallow merge at the top level is enough (its nested `sections` array is
      // replaced intentionally, not merged). Guarded like the others so a fresh
      // instance never gets an empty blob polluting its stored settings.
      if ('exportTemplate' in base || 'exportTemplate' in partial) {
        next.exportTemplate = { ...base.exportTemplate, ...partial.exportTemplate };
      }

      setSettings(next);
      publish(next);
      try {
        const instanceId = context?.instanceId || context?.boardId || 'default';
        await monday.storage.setItem(`${STORAGE_KEY_BASE}_${instanceId}`, JSON.stringify(next));
      } catch {
        /* local dev: persistence unavailable, in-memory only */
      }
      return next;
    },
    [settings, context, publish]
  );

  const isConfigured = computeIsConfigured(settings);

  // Convenience accessor the resolver (usePermission) reads. Board permissions
  // are ALWAYS ON (no enable toggle): coerce `enabled: true` for every instance —
  // including older ones stored with enabled:false and fresh ones with nothing
  // stored — and pre-fill roles from the LOCKED seed when none are stored yet, so
  // enforcement is consistent without requiring the owner to re-save. The raw
  // `settings.permissions` remains available for the owner UI.
  const permissions = useMemo(() => {
    const base = settings?.permissions || DEFAULT_PERMISSIONS;
    const roles = base.roles && Object.keys(base.roles).length
      ? base.roles
      : JSON.parse(JSON.stringify(DEFAULT_PERMISSION_SEED));
    return { ...base, enabled: true, roles };
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, permissions, isConfigured, isLoading, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    if (!missingProviderWarned) {
      console.error('useSettings called without SettingsProvider; treating as unconfigured.');
      missingProviderWarned = true;
    }
    return {
      settings: null,
      permissions: DEFAULT_PERMISSIONS,
      isConfigured: false,
      isLoading: false,
      updateSettings: async () => null,
    };
  }
  return ctx;
}
