import { useState, useEffect, useCallback, useRef } from 'react';
import mondaySdk from 'monday-sdk-js';
import type { PlannerSettings } from '../types/settings.types';
import { withTimeout } from '../utils/sdkUtils';
import { logger } from '../utils/Logger';
import { mondayService } from '../services/mondayService';

const monday = mondaySdk();

const SETTINGS_KEY = 'planner_app_settings';
const SILENT_RELOAD_FLAG = 'planner_silent_reload_done';

// sessionStorage can throw in restrictive environments (3p cookies blocked, sandboxed iframes).
// All access wrapped — if storage is unavailable we skip silent reload entirely (cannot guard
// against an infinite loop without it).
const safeGetSession = (key: string): string | null => {
  try { return sessionStorage.getItem(key); } catch { return null; }
};
const safeSetSession = (key: string, value: string): boolean => {
  try { sessionStorage.setItem(key, value); return true; } catch { return false; }
};
const safeRemoveSession = (key: string): void => {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
};

const DEFAULT_SETTINGS: PlannerSettings = {
  allocationsBoardId: '',
  startDateColumnId: '',
  endDateColumnId: '',
  hoursPerDayColumnId: '',
  totalHoursColumnId: '',
  projectColumnId: '',
  employeeColumnId: '',
  roleColumnId: '',
  employeesBoardId: '',
  employeeNameColumnId: '',
  employeeRoleColumnId: '',
  employeeAllocationPercentColumnId: '',
  employeeCostColumnId: '',
  employeeUserIdColumnId: '',
  projectsBoardId: '',
  projectNameColumnId: '',
  filterActiveProjects: false,
  projectStatusColumnId: '',
  activeProjectStatusValues: [],
  filterInactiveEmployees: false,
  employeeStatusColumnId: '',
  activeEmployeeStatusValues: [],
  enableProjectClassification: false,
  projectClassificationColumnId: '',
  internalProjectStatusValues: [],
  externalProjectStatusValues: [],
  // Day-off vacations board (DAY-OFF-INTEGRATION W3.1) — the sole absence /
  // company-holiday source. Defaults leave it OFF (empty dayOffBoardId ⇒ no
  // absences/holidays until mapped).
  dayOffBoardId: '',
  dayOffEmployeeColumnId: '',
  dayOffStartDateColumnId: '',
  dayOffEndDateColumnId: '',
  dayOffKindColumnId: '',
  dayOffKindGeneralLabelId: '',
  dayOffKindPersonalLabelId: '',
  dayOffTypeColumnId: '',
  dayOffMandatoryColumnId: '',
  dayOffApprovalRequired: false,
  dayOffApprovalColumnId: '',
  dayOffApprovedLabelIds: [],
  dayOffRejectedLabelIds: [],
  workDayStart: '09:00',
  workDayEnd: '18:00',
  effortDisplayMode: 'hours_day',
  maxHoursPerDay: 8.5,
  maxHoursPerWeek: 42.5,
  maxHoursPerMonth: 182,
  workDays: [0, 1, 2, 3, 4],
};

export type SettingsErrorKind = 'network' | 'unknown';

export const useMondaySettings = () => {
  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<SettingsErrorKind | null>(null);

  const isDevelopment = window.location.hostname === 'localhost';

  const isConfigured = Boolean(
    (settings?.allocationsBoardId && settings?.employeesBoardId) || isDevelopment
  );

  const loadSettings = useCallback(async () => {
    const t0 = performance.now();
    // Retry policy: only success:true is conclusive. success:false / throw / timeout
    // are treated as transient SDK-not-ready failures and retried with backoff.
    const RETRY_DELAYS_MS = [250, 750, 1500];
    const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

    const attemptGetItem = async (attempt: number): Promise<{ ok: true; response: any } | { ok: false; reason: string }> => {
      const tStart = performance.now();
      try {
        const response: any = await withTimeout(
          (monday.storage.instance as any).getItem(SETTINGS_KEY),
          5_000,
          'storage.getItem'
        );
        const elapsed = Math.round(performance.now() - tStart);
        // Compact attempt summary (was: full JSON.stringify(response) dump — verbose, and
        // leaked every board/column ID into the console). success / hasValue / version are
        // the fields we actually diagnose from; error detail is kept only on success:false.
        const d = response?.data;
        const errPart = d?.success === false ? ` error=${JSON.stringify(d?.error ?? {})}` : '';
        logger.info(
          `[LOAD_FLOW] [3/5] Attempt ${attempt}/${MAX_ATTEMPTS} responded in ${elapsed}ms ` +
          `(success=${d?.success} hasValue=${!!d?.value} version=${JSON.stringify(d?.version)} ` +
          `valueLen=${typeof d?.value === 'string' ? d.value.length : 0}${errPart})`
        );

        if (response?.data?.success === false) {
          return { ok: false, reason: `success:false (${JSON.stringify(response.data.error ?? {})})` };
        }
        if (!response?.data) {
          return { ok: false, reason: 'no data field in response' };
        }
        return { ok: true, response };
      } catch (err) {
        const elapsed = Math.round(performance.now() - tStart);
        return { ok: false, reason: `threw after ${elapsed}ms: ${err instanceof Error ? err.message : String(err)}` };
      }
    };

    try {
      setLoading(true);
      setError(null);
      setErrorKind(null);

      logger.info('[LOAD_FLOW] [3/5] Loading settings from storage (5s timeout, up to 4 attempts)...');

      let lastReason = '';
      let response: any = null;
      let successFalseCount = 0;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const result = await attemptGetItem(attempt);
        if (result.ok) {
          response = result.response;
          break;
        }
        lastReason = result.reason;
        if (result.reason.startsWith('success:false')) successFalseCount++;
        logger.warn(`[LOAD_FLOW] [3/5] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${result.reason}`);

        if (attempt < MAX_ATTEMPTS) {
          const backoff = RETRY_DELAYS_MS[attempt - 1];
          logger.info(`[LOAD_FLOW] [3/5] Backing off ${backoff}ms before retry`);
          await new Promise(r => setTimeout(r, backoff));
        }
      }

      if (!response) {
        if (isDevelopment) {
          logger.info('[LOAD_FLOW] [3/5] Dev mode — using empty response after all retries');
          response = { data: { value: null } };
        } else {
          // Silent reload: only if every attempt returned success:false (likely a stale/dead
          // postMessage channel that a fresh iframe can rebuild). Throws/timeouts get the
          // regular error screen. Guarded by sessionStorage to prevent reload loops.
          const allSuccessFalse = successFalseCount === MAX_ATTEMPTS;
          if (allSuccessFalse) {
            const alreadyReloaded = safeGetSession(SILENT_RELOAD_FLAG);
            if (alreadyReloaded) {
              logger.error('[LOAD_FLOW] [3/5] silent_reload_already_done=true — not reloading again, surfacing error');
            } else if (safeSetSession(SILENT_RELOAD_FLAG, '1')) {
              logger.warn('[LOAD_FLOW] [3/5] silent_reload_triggered=true reason=all_attempts_success_false');
              window.location.reload();
              return;
            } else {
              logger.warn('[LOAD_FLOW] [3/5] sessionStorage unavailable — skipping silent reload (cannot guard loop)');
            }
          }
          // Throws/timeouts → 'network'. success:false (channel responded but rejected)
          // → 'unknown' since the network round-trip itself worked.
          const kind: SettingsErrorKind = successFalseCount === MAX_ATTEMPTS ? 'unknown' : 'network';
          setErrorKind(kind);
          throw new Error(`Storage unreachable after ${MAX_ATTEMPTS} attempts. Last reason: ${lastReason}`);
        }
      }

      // [VERSION_PROBE] TEMPORARY diagnostic — remove once data is gathered (false-empty settings read).
      // Question: does monday populate `version` when `value` comes back empty? If a CONFIGURED instance can
      // return value=null with a NON-null version, that version distinguishes a genuinely new instance
      // (expected version=null) from a transient false-empty read — the case that can't be reproduced on demand.
      // Level is dynamic on purpose: empty-value reads (new instance OR false-empty) log at ERROR so they
      // surface in production, where the default log level is ERROR (see Logger.getDefaultLevel) and info/debug
      // would be invisible. Value-present reads stay at INFO (common case, no prod noise; visible with DEBUG on).
      {
        const probeVersion = response?.data?.version;
        const probeHasValue = !!response?.data?.value;
        const probeMsg = `[VERSION_PROBE] diag hasValue=${probeHasValue} version=${JSON.stringify(probeVersion)} versionPresent=${probeVersion != null}`;
        if (probeHasValue) logger.info(probeMsg); else logger.error(probeMsg);
      }

      // success:true with a value → settings exist
      if (response?.data?.value) {
        logger.info('[LOAD_FLOW] [3/5] Settings found, version:', response.data.version);
        try {
          const parsedSettings = JSON.parse(response.data.value);
          const fieldCount = Object.keys(parsedSettings).length;
          setSettings({ ...DEFAULT_SETTINGS, ...parsedSettings });
          logger.info(`[LOAD_FLOW] [3/5] Settings parsed OK — ${fieldCount} fields, configured: allocBoard=${!!parsedSettings.allocationsBoardId}, empBoard=${!!parsedSettings.employeesBoardId}`);
        } catch (parseErr) {
          logger.error('[LOAD_FLOW] [3/5] JSON.parse FAILED — using defaults:', parseErr);
          logger.warn('[STORAGE_DEBUG] JSON.parse failed, using defaults:', parseErr);
          setSettings(DEFAULT_SETTINGS);
        }
        setVersion(response.data.version);
        safeRemoveSession(SILENT_RELOAD_FLAG);
        logger.info(`[LOAD_FLOW] [3/5] Settings phase DONE in ${Math.round(performance.now() - t0)}ms`);
        return;
      }

      // success:true with no value → genuinely new/unconfigured instance.
      // Channel works even if storage is empty — safe to clear the reload guard.
      safeRemoveSession(SILENT_RELOAD_FLAG);
      logger.info(`[LOAD_FLOW] [3/5] Empty value (success) — new/unconfigured instance (${Math.round(performance.now() - t0)}ms)`);
      if (isDevelopment) {
        setSettings({
          ...DEFAULT_SETTINGS,
          allocationsBoardId: 'mock-allocations-board',
          employeesBoardId: 'mock-employees-board',
          startDateColumnId: 'date',
          endDateColumnId: 'date_1',
          hoursPerDayColumnId: 'numbers',
          projectColumnId: 'board_relation',
          employeeColumnId: 'board_relation_1',
          roleColumnId: 'status',
          employeeNameColumnId: 'name',
          employeeRoleColumnId: 'status',
          employeeAllocationPercentColumnId: 'numbers',
          employeeUserIdColumnId: 'people',
        });
      } else {
        setSettings(DEFAULT_SETTINGS);
      }
      setVersion(null);
    } catch (err) {
      logger.error(`[LOAD_FLOW] [3/5] Settings phase FAILED after ${Math.round(performance.now() - t0)}ms:`, err);
      logger.error('[STORAGE_DEBUG] loadSettings failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
      // Intentionally leave settings as-is (null on first load). Setting DEFAULT here
      // would let `isConfigured` flip false silently and risk showing the welcome
      // screen if a future render order skipped the `error` check.
    } finally {
      setLoading(false);
    }
  }, [isDevelopment]);

  const saveSettings = useCallback(async (newSettings: PlannerSettings) => {
    try {
      setSaving(true);
      setError(null);

      if (isDevelopment) {
        setSettings(newSettings);
        return true;
      }

      const options = version ? { previous_version: version } : {};
      const response = await (monday.storage.instance as any).setItem(
        SETTINGS_KEY,
        JSON.stringify(newSettings),
        options
      );
      logger.info('[STORAGE_DEBUG] settings setItem response:', JSON.stringify(response, null, 2));

      if (response.data?.success) {
        setSettings(newSettings);
        setVersion(response.data.version);
        return true;
      } else {
        throw new Error(response.data?.error || 'Failed to save settings');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
      return false;
    } finally {
      setSaving(false);
    }
  }, [version, isDevelopment]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // #90 one-time migration: auto-detect & persist the logs→allocations connect
  // column from the reportedHours mirror's logs board, so existing installs get
  // the aggregate reported-hours path without manual mapping. Default-first when
  // multiple candidates; warn (and keep mirror fallback) when none.
  const migrationDoneRef = useRef(false);
  useEffect(() => {
    if (migrationDoneRef.current) return;
    if (!settings || saving) return;
    if (!settings.reportedHoursColumnId) return;       // nothing to derive from
    if (settings.timeLogsAllocationColumnId) return;   // already mapped
    if (!settings.allocationsBoardId || settings.allocationsBoardId.startsWith('mock-')) return;
    migrationDoneRef.current = true;
    (async () => {
      try {
        const candidates = await mondayService.findLogsAllocationColumns(settings);
        if (candidates.length > 0) {
          await saveSettings({ ...settings, timeLogsAllocationColumnId: candidates[0].id });
          logger.info(`[useMondaySettings] #90 migration: mapped timeLogsAllocationColumnId=${candidates[0].id} (${candidates.length} candidate(s))`);
        } else {
          logger.warn('[useMondaySettings] #90 migration: no logs→allocations connect column found; reported-hours aggregate disabled (mirror fallback).');
        }
      } catch (err) {
        logger.warn('[useMondaySettings] #90 migration failed:', err);
      }
    })();
  }, [settings, saving, saveSettings]);

  return {
    settings,
    loading,
    saving,
    error,
    errorKind,
    saveSettings,
    isConfigured,
    refresh: loadSettings
  };
};
