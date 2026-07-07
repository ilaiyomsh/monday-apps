import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { assertStorageOk, resolveInstanceId, withTimeout, ATTEMPT_TIMEOUT_MS } from '../storage';
import { useMondayContext } from '../monday/MondayContext';
import type { Logger } from '../logger';
import type { MondaySdk, SettingsErrorKind } from '../types';

const RETRY_DELAYS_MS = [250, 750, 1500]; // 4 attempts total (Planner pattern)
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SettingsModuleConfig<T extends object> {
  /** Storage key prefix; final key = `${prefix}${instanceId}` in GLOBAL monday.storage. */
  storageKeyPrefix: string;
  defaults: T;
  /** Optional one-shot migration of a loaded blob (legacy renames, cleanups). */
  migrate?: (loaded: Record<string, unknown>) => Partial<T>;
  /** Optional validation, surfaced to the UI. */
  validate?: (settings: T) => { isValid: boolean; errors: Record<string, string> };
}

export interface SettingsContextValue<T> {
  settings: T;
  updateSettings: (patch: Partial<T>) => Promise<boolean>;
  resetSettings: () => Promise<boolean>;
  reloadSettings: () => void;
  isLoading: boolean;
  loadError: { kind: SettingsErrorKind } | null;
  validation: { isValid: boolean; errors: Record<string, string> };
}

export interface SettingsProviderProps {
  monday: MondaySdk;
  logger: Logger;
  children: ReactNode;
}

export function createSettings<T extends object>(config: SettingsModuleConfig<T>) {
  const Ctx = createContext<SettingsContextValue<T> | null>(null);
  const reloadGuardKey = `${config.storageKeyPrefix}reload_done`;

  function SettingsProvider({ monday, logger, children }: SettingsProviderProps) {
    const { context } = useMondayContext();
    const [settings, setSettings] = useState<T>(config.defaults);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<{ kind: SettingsErrorKind } | null>(null);
    const loadedFor = useRef<string | null>(null);
    const inFlight = useRef(false);

    const instanceId = resolveInstanceId(context);
    const key = `${config.storageKeyPrefix}${instanceId}`;

    const load = useCallback(async () => {
      if (inFlight.current || loadedFor.current === instanceId) return;
      inFlight.current = true;
      setIsLoading(true);
      setLoadError(null);
      let successFalseCount = 0;
      const attempts = RETRY_DELAYS_MS.length + 1;
      try {
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            const res = await withTimeout(monday.storage.getItem(key), ATTEMPT_TIMEOUT_MS, 'storage.getItem');
            if (res?.data?.success === false) { successFalseCount++; }
            else if (res?.data?.value) {
              const raw = JSON.parse(res.data.value) as Record<string, unknown>;
              const migrated = config.migrate ? config.migrate(raw) : (raw as Partial<T>);
              setSettings({ ...config.defaults, ...raw, ...migrated } as T);
              loadedFor.current = instanceId;
              logger.info('Settings', 'loaded', { key });
              return;
            } else {
              // success + empty → new instance
              setSettings(config.defaults);
              loadedFor.current = instanceId;
              logger.info('Settings', 'empty (new instance)', { key });
              return;
            }
          } catch (e) {
            logger.warn('Settings', `load attempt ${attempt} failed`, e);
          }
          if (attempt < attempts) await delay(RETRY_DELAYS_MS[attempt - 1]);
        }
        // all attempts exhausted — try one silent reload, then surface error
        let alreadyReloaded = false;
        try { alreadyReloaded = sessionStorage.getItem(reloadGuardKey) === '1'; } catch { /* ignore */ }
        if (!alreadyReloaded) {
          try { sessionStorage.setItem(reloadGuardKey, '1'); } catch { /* ignore */ }
          logger.warn('Settings', 'silent reload after load failure', { key });
          window.location.reload();
          return;
        }
        setLoadError({ kind: successFalseCount === attempts ? 'unknown' : 'network' });
      } finally {
        inFlight.current = false;
        setIsLoading(false);
        try { sessionStorage.removeItem(reloadGuardKey); } catch { /* ignore */ }
      }
    }, [monday, logger, key, instanceId]);

    useEffect(() => { if (context) void load(); }, [context, load]);

    const persist = useCallback(async (next: T): Promise<boolean> => {
      const previous = settings;
      setSettings(next); // optimistic
      try {
        const res = await withTimeout(monday.storage.setItem(key, JSON.stringify(next)), ATTEMPT_TIMEOUT_MS, 'storage.setItem');
        assertStorageOk(res, 'setItem', key);
        logger.info('Settings', 'saved', { key });
        return true;
      } catch (e) {
        setSettings(previous); // rollback
        logger.error('Settings', 'save failed', e);
        return false;
      }
    }, [monday, logger, key, settings]);

    const updateSettings = useCallback(
      (patch: Partial<T>) => persist({ ...settings, ...patch, lastModifiedAt: new Date().toISOString() } as T),
      [persist, settings],
    );
    const resetSettings = useCallback(() => persist({ ...config.defaults, lastModifiedAt: new Date().toISOString() } as T), [persist]);
    const reloadSettings = useCallback(() => {
      try { sessionStorage.removeItem(reloadGuardKey); } catch { /* ignore */ }
      loadedFor.current = null;
      void load();
    }, [load]);

    const validation = config.validate ? config.validate(settings) : { isValid: true, errors: {} };

    return (
      <Ctx.Provider value={{ settings, updateSettings, resetSettings, reloadSettings, isLoading, loadError, validation }}>
        {children}
      </Ctx.Provider>
    );
  }

  function useSettings(): SettingsContextValue<T> {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useSettings must be used within its SettingsProvider');
    return ctx;
  }

  return { SettingsProvider, useSettings };
}
