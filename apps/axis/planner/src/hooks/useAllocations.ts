import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import type { Group, Task, ViewMode, Employee, Role, RoleColorMap } from '../types/gantt.types';
import { Allocation } from '../types/entities/allocation.types';
import { allocationsApi } from '../services/allocationsApi';
import { addDaysToDayKey } from '../utils/dateUtils';
import { useSettings } from '../contexts/SettingsContext';
import { useActiveProjects } from '../contexts/ActiveProjectsContext';
import { groupAllocations, mergeAllocationsById } from '../utils/allocationUtils';
import { mondayService } from '../services/mondayService';
import { USE_UNIFIED_LOAD } from '../utils/constants';
import { useMondayContext } from '../contexts/MondayContext';
import { useUserPhotos } from './useUserPhotos';
import { logger } from '../utils/Logger';
import { batchMutations } from '../utils/batchMutations';
import { DEFAULT_ROLE_COLOR } from '../types/entities/role.types';

export type AllocationsErrorKind = 'network' | 'unknown';

export const useAllocations = (viewMode: ViewMode = 'projects') => {
  const { settings, isConfigured } = useSettings();
  const { activeProjects, activeProjectIds, refresh: refreshActiveProjects } = useActiveProjects();
  const { context } = useMondayContext();
  const [rawAllocations, setRawAllocations] = useState<Allocation[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleColorMap, setRoleColorMap] = useState<RoleColorMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<AllocationsErrorKind | null>(null);
  const [allocationsVersion, setAllocationsVersion] = useState(0);
  // Rule 1/6/7: past allocations are loaded ALWAYS in the background (first 1yr
  // window after the critical fetch settles) then windowed +1yr per fetch-more
  // on scroll-back. The hook owns the window cursor + loading/error state; the
  // data layer (fetchPastAllocationsWindow) is stateless-by-bounds.
  //   pastLoadState: 'idle'   — nothing loaded yet (re-armed on board change)
  //                  'loading'— a window is in flight (drives the circle skeleton)
  //                  'ready'  — at least the first window has landed
  //                  'error'  — last window failed (circles show error+retry)
  const [pastLoadState, setPastLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // yyyy-MM-dd of the oldest window-start loaded so far; the cursor fetch-more
  // advances backward from. Undefined until the first background window runs.
  const earliestLoadedRef = useRef<string | undefined>(undefined);
  // Set once a window returns zero items and its bound is older than the oldest
  // allocation seen — stops empty year-windows from firing forever.
  const pastExhaustedRef = useRef(false);
  // Bounded consumer-level auto-retry above apiQueue's transient backoff (Rule 7).
  const autoRetryCountRef = useRef(0);
  const lastFailedBoundRef = useRef<string | undefined>(undefined);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive empty backward windows — tolerate a single gap year before
  // declaring history exhausted (a lone empty year must NOT truncate older data).
  const consecutiveEmptyPastRef = useRef(0);
  // True once the critical fetch has actually completed (data committed). Gates
  // the first background-past window so it can't race the critical bundle for the
  // complexity/rate budget, and guarantees `employees` is set before the past
  // inactive-employee filter runs. Reset at the start of each fetchAllocations.
  const [criticalDone, setCriticalDone] = useState(false);
  const [localProjectDataMap, setLocalProjectDataMap] = useState<Map<string, any>>(new Map());
  // Ids with an optimistic local project-data edit (patchProjectData) — the
  // provider merge overlays the local value for these over the board-fresh data.
  const patchedProjectIdsRef = useRef<Set<string>>(new Set());
  // Guards against concurrent fetchAllocations calls — StrictMode double-mount
  // and observed multi-remount of SettingsProvider were firing 2-3 loads in
  // parallel against monday's API.
  const inFlightRef = useRef(false);
  // Tracks the board the current rawAllocations belong to. Switching boards is a
  // fresh context: we REPLACE so stale data from the previous board can't linger.
  // Same board ⇒ MERGE so the background future (and on-demand past) windows
  // aren't wiped by a current-window refetch.
  const lastBoardIdRef = useRef<string | undefined>(undefined);
  // #90: reported hours per allocation from the aggregate (covers all windows),
  // so the always-background past windows join the same map for bar color.
  const reportedHoursRef = useRef<Map<string, number>>(new Map());

  // #90 unified path requires the reported-hours mirror + the persisted
  // logs→allocations relation column (else we can't source reported hours from
  // the aggregate). The always-background-past windowing (Rule 1) is unified-only;
  // the legacy path keeps its current crosses-today + on-toggle behavior.
  const useUnified = USE_UNIFIED_LOAD
    && !!settings?.reportedHoursColumnId
    && !!settings?.timeLogsAllocationColumnId;

  // Rule 6: the load circles must show a skeleton — never a partial/wrong number —
  // whenever a past window is in flight ('loading') AND from first paint until the
  // first window lands ('idle', unified only). Legacy (useUnified=false) never
  // windows past, so it stays out of the skeleton (would otherwise pin forever).
  const loadSettling = pastLoadState === 'loading' || (useUnified && pastLoadState === 'idle');

  // Project-metadata inputs for the windowed past fetch (Rule 5). Project name /
  // PM / type / classification / client come from the projects board, joined by
  // id — never hardcoded. projectsBoardId may be undefined if it is derived from
  // the project relation column's settings; in that case past metadata is filled
  // by ActiveProjectsContext at the provider seam instead.
  const pastMetaColIds = useMemo(() => (
    [
      settings?.projectManagerColumnId, settings?.projectTypeColumnId,
      settings?.projectClassificationColumnId, settings?.clientColumnId,
      settings?.projectPlannedHoursColumnId,
    ].filter(Boolean) as string[]
  ), [settings?.projectManagerColumnId, settings?.projectTypeColumnId, settings?.projectClassificationColumnId, settings?.clientColumnId, settings?.projectPlannedHoursColumnId]);

  // User photos integration
  const isAdmin = context?.user?.isAdmin ?? false;
  const userIds = useMemo(() =>
    employees.map(e => e.userId).filter((id): id is string => !!id),
    [employees]
  );
  const { photoMap, getPhotoUrl } = useUserPhotos(isAdmin, userIds);

  // Merge photos into employees
  const employeesWithPhotos = useMemo(() =>
    employees.map(emp => ({
      ...emp,
      photoUrl: emp.userId ? getPhotoUrl(emp.userId) : undefined
    })),
    [employees, photoMap]
  );

  // Extract unique capabilities from all employees
  const capabilityOptions = useMemo(() => {
    const allCapabilities = new Set<string>();
    employees.forEach(emp => {
      emp.capabilities?.forEach(cap => allCapabilities.add(cap));
    });
    return Array.from(allCapabilities).map(cap => ({
      id: cap,
      name: cap,
    }));
  }, [employees]);

  // Grouping logic is now synchronous via useMemo
  const groups = useMemo(() => {
    const activeProjectsToPass = viewMode === 'projects' && settings?.filterActiveProjects ? activeProjects || undefined : undefined;

    logger.debug('[useAllocations] Grouping with:', {
      rawAllocationsCount: rawAllocations.length,
      viewMode,
      filterActiveProjects: settings?.filterActiveProjects,
      activeProjectsCount: activeProjects?.length,
      activeProjectsToPassCount: activeProjectsToPass?.length,
      projectDataMapSize: localProjectDataMap.size
    });

    return groupAllocations(rawAllocations, viewMode, roleColorMap, {
      activeProjects: activeProjectsToPass,
      allEmployees: viewMode === 'employees' ? employeesWithPhotos : undefined,
      allEmployeesForPhotos: employeesWithPhotos,
      maxHoursPerDay: settings?.maxHoursPerDay,
      projectDataMap: localProjectDataMap,
      settings: settings || undefined,
    });
  }, [rawAllocations, viewMode, roleColorMap, activeProjects, employeesWithPhotos, settings?.filterActiveProjects, settings?.maxHoursPerDay, settings?.enableProjectClassification, settings?.projectClassificationColumnId, settings?.internalProjectStatusValues, settings?.externalProjectStatusValues, localProjectDataMap]);

  const allProjects = useMemo(() => {
    return groupAllocations(rawAllocations, 'projects', roleColorMap, {
      activeProjects: settings?.filterActiveProjects ? activeProjects || undefined : undefined,
      allEmployeesForPhotos: employeesWithPhotos,
      maxHoursPerDay: settings?.maxHoursPerDay,
      projectDataMap: localProjectDataMap,
      settings: settings || undefined,
    });
  }, [rawAllocations, roleColorMap, activeProjects, employeesWithPhotos, settings, localProjectDataMap]);

  // Fetch employees independently — does not depend on `isConfigured` (which
  // requires allocations board too) so an employees-only failure doesn't block UX.
  const fetchEmployees = useCallback(async () => {
    if (!settings?.employeesBoardId) return;
    try {
      const employeesData = await allocationsApi.getEmployees(settings);
      setEmployees(employeesData);
    } catch (err) {
      logger.warn('[useAllocations] Failed to fetch employees independently:', err);
    }
  }, [settings]);

  const fetchAllocations = useCallback(async () => {
    if (!isConfigured || !settings) return;
    if (inFlightRef.current) {
      logger.debug('[useAllocations] fetchAllocations skipped — already in flight');
      return;
    }
    inFlightRef.current = true;

    setLoading(true);
    // Block the background-past window until this critical fetch commits (below).
    setCriticalDone(false);
    try {
      let allocations: Allocation[];
      let employeesData: Employee[];
      let columns: any[];
      let fetchedProjectDataMap: Map<string, any>;

      if (useUnified) {
        // Single unified critical-path load (2 round-trips instead of ~6).
        const bundle = await allocationsApi.getCriticalBundle(settings);
        allocations = bundle.allocations;
        employeesData = bundle.employees;
        columns = bundle.columns;
        fetchedProjectDataMap = bundle.projectDataMap;
        reportedHoursRef.current = bundle.reportedByAllocId;
      } else {
        // Legacy path — heavy per-allocation fetch + sibling employees/columns.
        const result = await allocationsApi.getAllWithProjectData(settings);
        allocations = result.allocations;
        fetchedProjectDataMap = result.projectDataMap;

        // Best-effort siblings — a failure here should NOT take down the load.
        const [employeesResult, columnsResult] = await Promise.allSettled([
          allocationsApi.getEmployees(settings),
          mondayService.fetchColumns(settings.allocationsBoardId)
        ]);
        employeesData = employeesResult.status === 'fulfilled' ? employeesResult.value : [];
        columns = columnsResult.status === 'fulfilled' ? columnsResult.value : [];
        if (employeesResult.status === 'rejected') {
          logger.warn('[useAllocations] employees fetch failed (non-critical):', employeesResult.reason);
        }
        if (columnsResult.status === 'rejected') {
          logger.warn('[useAllocations] columns fetch failed (non-critical):', columnsResult.reason);
        }
        reportedHoursRef.current = new Map();
      }

      // Extract roles and colors from roleColumnId settings
      let extractedRoles: Role[] = [];
      let colorMap: RoleColorMap = {};
      
      const roleColumn = columns.find((c: any) => c.id === settings.roleColumnId);
      if (roleColumn && roleColumn.settings) {
        const columnSettings = typeof roleColumn.settings === 'string' 
          ? JSON.parse(roleColumn.settings) 
          : roleColumn.settings;
        
        if (roleColumn.type === 'color' || roleColumn.type === 'status') {
          // Status column labels - can be array or object
          if (columnSettings.labels) {
            if (Array.isArray(columnSettings.labels)) {
              // מערך (פורמט חדש של monday.com API)
              extractedRoles = columnSettings.labels
                .filter((item: any) => item && item.label && !item.is_deactivated)
                .map((item: any) => {
                  const roleName = item.label;
                  const hexColor = item.hex || DEFAULT_ROLE_COLOR();
                  colorMap[roleName] = hexColor;
                  return {
                    id: item.id.toString(),
                    name: roleName,
                    hex: hexColor
                  };
                });
            } else {
              // אובייקט (פורמט ישן)
              extractedRoles = Object.entries(columnSettings.labels)
                .filter(([id, labelData]) => labelData && id !== 'empty')
                .map(([id, labelData]) => {
                  const data = labelData as any;
                  const roleName = typeof data === 'object' && data !== null
                    ? data.label || ''
                    : (data as string);
                  const hexColor = typeof data === 'object' && data !== null
                    ? data.hex || DEFAULT_ROLE_COLOR()
                    : DEFAULT_ROLE_COLOR();
                  colorMap[roleName] = hexColor;
                  return {
                    id,
                    name: roleName,
                    hex: hexColor
                  };
                });
            }
          }
        } else if (roleColumn.type === 'dropdown') {
          // Dropdown column options
          if (columnSettings.options) {
            extractedRoles = columnSettings.options.map((opt: any) => ({
              id: opt.id.toString(),
              name: opt.name
            }));
          }
        }
        
        if (extractedRoles.length > 0) {
          setRoles(extractedRoles);
          setRoleColorMap(colorMap);
        }
      }

      // Drop allocations belonging to inactive employees so they don't show
      // in the gantt or feed into workload/availability calculations.
      // Unassigned allocations (no employeeId) are preserved.
      let filteredAllocations = allocations;
      if (settings.filterInactiveEmployees && employeesData.length > 0) {
        const activeIds = new Set(employeesData.map(e => e.id?.toString()));
        const activeUserIds = new Set(
          employeesData.map(e => e.userId?.toString()).filter(Boolean) as string[]
        );
        filteredAllocations = allocations.filter(a => {
          const eid = a.employeeId?.toString();
          if (!eid || eid === 'Unassigned') return true;
          return activeIds.has(eid) || activeUserIds.has(eid);
        });
        logger.debug('[useAllocations] Filtered inactive-employee allocations:', allocations.length - filteredAllocations.length);
      }

      // Date filter at API level replaces activeProjectIds filtering.
      // This fetch owns the "current" window (allocations crossing today). On a
      // board change we replace wholesale so stale data from the previous board
      // can't linger; on the same board we MERGE by id so the background future
      // and on-demand past windows are preserved across any refetch (initial-load
      // race, refresh after create/edit/delete, settings change).
      // See BUGS.md "Future allocations vanish (multi-stage load clobber)".
      // Only a transition between two *different* boards forces a replace. The
      // initial load (undefined → board) must merge, so a background future that
      // raced ahead of this first current-window fetch is preserved.
      const boardChanged =
        lastBoardIdRef.current !== undefined &&
        lastBoardIdRef.current !== settings.allocationsBoardId;
      lastBoardIdRef.current = settings.allocationsBoardId;
      if (boardChanged) {
        // Re-arm the always-background-past windowing from year 1 on the new
        // board so stale backward-window state can't linger (Rule 1 / reset).
        earliestLoadedRef.current = undefined;
        pastExhaustedRef.current = false;
        consecutiveEmptyPastRef.current = 0;
        autoRetryCountRef.current = 0;
        lastFailedBoundRef.current = undefined;
        if (autoRetryTimerRef.current) { clearTimeout(autoRetryTimerRef.current); autoRetryTimerRef.current = null; }
        setPastLoadState('idle');
      }
      setRawAllocations(prev =>
        boardChanged ? filteredAllocations : mergeAllocationsById(prev, filteredAllocations)
      );
      setLocalProjectDataMap(fetchedProjectDataMap);
      setEmployees(employeesData);

      setError(null);
      setErrorKind(null);
      // Critical data committed (employees included) → release the first
      // background-past window. Fires AFTER this commit, not concurrently.
      setCriticalDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // TRANSIENT_SERVER_ERROR comes from apiQueue after exhausted retries on
      // 5xx / transport failures. Anything matching the network-ish keywords
      // (timeout, fetch, etc.) gets the same treatment for parity with the
      // settings-load classifier.
      const isTransient = message.startsWith('TRANSIENT_SERVER_ERROR:') ||
                          /network|fetch|timeout|load failed/i.test(message);
      setErrorKind(isTransient ? 'network' : 'unknown');
      setError(message || 'Failed to load data');
      logger.error('[useAllocations] Failed to fetch allocations:', err);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [settings, isConfigured, useUnified]); // activeProjects removed — date filter at API level replaces project-ID filtering

  useEffect(() => {
    fetchAllocations();
  }, [fetchAllocations]);

  // Clear any pending past-window auto-retry timer on unmount.
  useEffect(() => () => {
    if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
  }, []);

  // Fallback employees fetch — only runs when `isConfigured` is false (so
  // `fetchAllocations` short-circuits and won't fetch employees itself).
  // Avoids a duplicate parallel getEmployees call on the normal load path.
  useEffect(() => {
    if (!isConfigured && employees.length === 0) {
      fetchEmployees();
    }
  }, [isConfigured, fetchEmployees, employees.length]);

  // Sync allocation PMs with project PMs on startup
  const pmSyncDoneRef = useRef(false);
  useEffect(() => {
    if (pmSyncDoneRef.current) return;
    if (!settings?.allocationManagerColumnId || !settings?.projectManagerColumnId) return;
    if (loading || rawAllocations.length === 0 || localProjectDataMap.size === 0) return;

    pmSyncDoneRef.current = true;

    // Find allocations where PM doesn't match project PM
    const mismatchedByProject = new Map<string, { correctPmId: string; allocations: Allocation[] }>();

    rawAllocations.forEach(allocation => {
      const projectId = allocation.projectId?.toString();
      if (!projectId) return;

      const projectData = localProjectDataMap.get(projectId);
      if (!projectData) return;

      const projectPmId = projectData[settings.projectManagerColumnId! + '_id'];
      if (!projectPmId) return;

      if (allocation.managerId !== projectPmId) {
        if (!mismatchedByProject.has(projectId)) {
          mismatchedByProject.set(projectId, { correctPmId: projectPmId, allocations: [] });
        }
        mismatchedByProject.get(projectId)!.allocations.push(allocation);
      }
    });

    if (mismatchedByProject.size === 0) return;

    logger.debug('[useAllocations] PM sync: found mismatches in', mismatchedByProject.size, 'projects');

    // Build update map: allocationId -> correctPmId
    const pmUpdates = new Map<string, string>();
    mismatchedByProject.forEach(({ correctPmId, allocations }) => {
      allocations.forEach(a => pmUpdates.set(a.id.toString(), correctPmId));
    });

    // Optimistic update all mismatched allocations
    setRawAllocations(prev =>
      prev.map(a => {
        const newPm = pmUpdates.get(a.id.toString());
        return newPm ? { ...a, managerId: newPm } : a;
      })
    );

    // Fire API updates sequentially (fire-and-forget) to avoid complexity budget exhaustion.
    // Write ONLY the manager column — sending the whole row re-emits other columns
    // (e.g. Employee) whose stored values may be stale, causing monday to reject the update.
    const operations: Array<() => Promise<any>> = [];
    mismatchedByProject.forEach(({ correctPmId, allocations }) => {
      allocations.forEach(allocation => {
        const pmIdNum = parseInt(correctPmId);
        if (isNaN(pmIdNum)) return;
        const columnValues = {
          [settings.allocationManagerColumnId!]: {
            personsAndTeams: [{ id: pmIdNum, kind: 'person' }]
          }
        };
        operations.push(() =>
          mondayService.updateItem(settings.allocationsBoardId!, allocation.id.toString(), columnValues)
        );
      });
    });
    batchMutations(operations);
  }, [loading, rawAllocations, localProjectDataMap, settings, viewMode]);

  // Sync allocation clients with project clients on startup
  const clientSyncDoneRef = useRef(false);
  useEffect(() => {
    if (clientSyncDoneRef.current) return;
    if (!settings?.allocationClientColumnId || !settings?.clientColumnId) return;
    if (loading || rawAllocations.length === 0 || localProjectDataMap.size === 0) return;

    clientSyncDoneRef.current = true;

    // Find allocations where client doesn't match project client
    const mismatchedByProject = new Map<string, { correctClientId: string; allocations: Allocation[] }>();

    rawAllocations.forEach(allocation => {
      const projectId = allocation.projectId?.toString();
      if (!projectId) return;

      const projectData = localProjectDataMap.get(projectId);
      if (!projectData) return;

      const projectClientId = projectData[settings.clientColumnId! + '_id'];
      if (!projectClientId) return;

      if (allocation.clientItemId !== projectClientId) {
        if (!mismatchedByProject.has(projectId)) {
          mismatchedByProject.set(projectId, { correctClientId: projectClientId, allocations: [] });
        }
        mismatchedByProject.get(projectId)!.allocations.push(allocation);
      }
    });

    if (mismatchedByProject.size === 0) return;

    logger.debug('[useAllocations] Client sync: found mismatches in', mismatchedByProject.size, 'projects');

    // Build update map: allocationId -> correctClientId
    const clientUpdates = new Map<string, string>();
    mismatchedByProject.forEach(({ correctClientId, allocations }) => {
      allocations.forEach(a => clientUpdates.set(a.id.toString(), correctClientId));
    });

    // Optimistic update all mismatched allocations
    setRawAllocations(prev =>
      prev.map(a => {
        const newClient = clientUpdates.get(a.id.toString());
        return newClient ? { ...a, clientItemId: newClient } : a;
      })
    );

    // Fire API updates sequentially (fire-and-forget).
    // Write ONLY the client column — see PM-sync note above.
    const operations: Array<() => Promise<any>> = [];
    mismatchedByProject.forEach(({ correctClientId, allocations }) => {
      allocations.forEach(allocation => {
        const cId = parseInt(correctClientId);
        if (isNaN(cId)) return;
        const columnValues = {
          [settings.allocationClientColumnId!]: { item_ids: [cId] }
        };
        operations.push(() =>
          mondayService.updateItem(settings.allocationsBoardId!, allocation.id.toString(), columnValues)
        );
      });
    });
    batchMutations(operations);
  }, [loading, rawAllocations, localProjectDataMap, settings, viewMode]);

  // Run ONE backward [-1yr] window ending the day before `prevBoundDayKey`.
  // Used both for the first background window (prevBound = today) and for
  // fetch-more on scroll-back (prevBound = earliestLoadedRef). The metadata
  // round-trip resolves inside getPastAllocations BEFORE 'ready' is set so the
  // Rule 6 skeleton covers the whole resolve, not just allocation arrival.
  const runPastWindow = useCallback(async (prevBoundDayKey: string) => {
    if (!settings || !useUnified) return;
    setPastLoadState('loading');
    if (autoRetryTimerRef.current) { clearTimeout(autoRetryTimerRef.current); autoRetryTimerRef.current = null; }
    // endDate-keyed window: [prevBound-365 .. prevBound-1]. Past windows never
    // include `prevBound` itself (it was the previous window's start / today).
    const wEnd = addDaysToDayKey(prevBoundDayKey, -1);
    const wStart = addDaysToDayKey(prevBoundDayKey, -365);
    try {
      const { allocations: past, projectDataMapDelta } = await allocationsApi.getPastAllocations(
        settings,
        wStart,
        wEnd,
        reportedHoursRef.current,
        settings.projectsBoardId,
        pastMetaColIds
      );

      // Same inactive-employee filter as the main fetch — see fetchAllocations above.
      let filteredPast = past;
      if (settings.filterInactiveEmployees && employees.length > 0) {
        const activeIds = new Set(employees.map(e => e.id?.toString()));
        const activeUserIds = new Set(
          employees.map(e => e.userId?.toString()).filter(Boolean) as string[]
        );
        filteredPast = past.filter(a => {
          const eid = a.employeeId?.toString();
          if (!eid || eid === 'Unassigned') return true;
          return activeIds.has(eid) || activeUserIds.has(eid);
        });
      }

      // Merge project metadata for past-only (finished) projects. Existing
      // entries win — the critical load has fuller data for live projects.
      if (projectDataMapDelta.size > 0) {
        setLocalProjectDataMap(prev => {
          let added = false;
          const next = new Map(prev);
          projectDataMapDelta.forEach((data, id) => {
            if (!next.has(id)) { next.set(id, data); added = true; }
          });
          return added ? next : prev;
        });
      }

      // Advance the cursor. Declare history exhausted only after TWO consecutive
      // empty windows — a single gap year (no allocation ENDing in that 1yr span
      // while older allocations still exist) must NOT permanently stop fetch-more
      // and silently drop the older data from the load calc (Rule 2).
      earliestLoadedRef.current = wStart;
      if (past.length === 0) {
        consecutiveEmptyPastRef.current += 1;
        if (consecutiveEmptyPastRef.current >= 2) pastExhaustedRef.current = true;
      } else {
        consecutiveEmptyPastRef.current = 0;
      }

      // Merge by id (idempotent) — a long allocation only lands in one window by
      // its endDate, but the guard keeps re-arms / concurrent refetches safe.
      setRawAllocations(prev => mergeAllocationsById(prev, filteredPast));
      setAllocationsVersion(v => v + 1);
      autoRetryCountRef.current = 0;
      lastFailedBoundRef.current = undefined;
      setPastLoadState('ready');
    } catch (err) {
      // Rule 7: surface error+retry on the circles — NEVER swallow and fall back
      // to a current+future-only number. apiQueue already did transient backoff;
      // this is consumer-level orchestration above it (bounded auto-retry).
      logger.error('[useAllocations] Past-window fetch failed:', err);
      lastFailedBoundRef.current = prevBoundDayKey;
      setPastLoadState('error');
      if (autoRetryCountRef.current < 2) {
        autoRetryCountRef.current += 1;
        autoRetryTimerRef.current = setTimeout(() => {
          runPastWindow(prevBoundDayKey);
        }, 3000);
      }
    }
  }, [settings, useUnified, employees, pastMetaColIds]);

  // Rule 1: always-background first past year, kicked off once the critical
  // fetch has actually COMMITTED (criticalDone), not the racy `loading` flag —
  // otherwise on first mount this races the critical bundle for the budget and
  // runs before `employees` is set. Unified-only; legacy is a no-op.
  useEffect(() => {
    if (!criticalDone || loading || !settings || !useUnified || pastLoadState !== 'idle') return;
    runPastWindow(format(new Date(), 'yyyy-MM-dd'));
  }, [criticalDone, loading, settings, useUnified, pastLoadState, runPastWindow]);

  // Rule 1: fetch-more on scroll-back — advance the cursor one more year older.
  // No-ops while a window is in flight, once history is exhausted, or before the
  // first background window has established a cursor (bound-advance guard).
  const fetchMorePast = useCallback(() => {
    if (pastLoadState === 'loading' || pastExhaustedRef.current || !earliestLoadedRef.current) return;
    runPastWindow(earliestLoadedRef.current);
  }, [pastLoadState, runPastWindow]);

  // Rule 7: manual retry — reset the auto-retry counter and re-run the last
  // failed bound (falls back to today if no bound was recorded).
  const retryPast = useCallback(() => {
    if (autoRetryTimerRef.current) { clearTimeout(autoRetryTimerRef.current); autoRetryTimerRef.current = null; }
    autoRetryCountRef.current = 0;
    runPastWindow(lastFailedBoundRef.current ?? format(new Date(), 'yyyy-MM-dd'));
  }, [runPastWindow]);

  // Parsed earliest-loaded bound the timeline scroll detector reads to know how
  // far back data extends. Undefined until the first background window lands.
  const earliestLoadedDate = earliestLoadedRef.current;

  const addAllocation = useCallback(async (task: Omit<Task, 'id'>) => {
    if (!settings) return;

    // Look up project data (name + PM) — needed for projects added via "+" that
    // have no allocations yet and therefore no projectName in the task payload.
    const projectId = task.projectId || task.groupId;
    const projectData = projectId ? localProjectDataMap.get(projectId.toString()) : undefined;
    let managerId: string | undefined;
    if (projectData && settings.projectManagerColumnId) {
      managerId = projectData[settings.projectManagerColumnId + '_id'];
    }
    let clientItemId: string | undefined;
    if (projectData && settings.clientColumnId) {
      clientItemId = projectData[settings.clientColumnId + '_id'];
    }

    const resolvedProjectName = task.projectName || projectData?.name || '';

    // Generate temporary ID for optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticAllocation: Allocation = {
      ...task,
      id: tempId,
      projectId: projectId || 'Unassigned',
      employeeId: task.employeeId || 'Unassigned',
      name: task.name || '',
      role: task.role || '',
      capability: task.capability,
      startDate: task.startDate || '',
      endDate: task.endDate || '',
      hoursPerDay: task.hoursPerDay || 0,
      totalHours: task.totalHours || 0,
      projectName: resolvedProjectName,
      userName: task.userName || '',
      managerId,
      clientItemId,
    };

    // Optimistic add - add to local state immediately
    setRawAllocations(prev => [...prev, optimisticAllocation]);
    setAllocationsVersion(v => v + 1);

    // If the project isn't in our cached project map and isn't in the active list,
    // it's a brand-new project (created via "+" while other tabs were open). Trigger
    // an ActiveProjects refresh so the project becomes discoverable across the app.
    const projectIdStr = projectId?.toString();
    const isUnknownProject = projectIdStr
      && !localProjectDataMap.has(projectIdStr)
      && !activeProjectIds.has(projectIdStr);

    try {
      // Pass allocation with managerId and resolved projectName to API
      const allocationForApi = { ...task, managerId, clientItemId, projectName: resolvedProjectName };
      const result = await allocationsApi.create(allocationForApi, settings, viewMode, task.groupId);
      // Update with real ID from server
      setRawAllocations(prev =>
        prev.map(a => a.id === tempId ? { ...optimisticAllocation, id: result.id } : a)
      );
      setAllocationsVersion(v => v + 1);

      if (isUnknownProject) {
        refreshActiveProjects().catch(err =>
          logger.warn('[useAllocations] Post-mutation ActiveProjects refresh failed:', err)
        );
      }
    } catch (err) {
      logger.error('[useAllocations] Failed to add allocation:', err);
      // Revert on error
      setRawAllocations(prev => prev.filter(a => a.id !== tempId));
      setAllocationsVersion(v => v + 1);
      throw err; // Re-throw so caller can handle
    }
  }, [settings, viewMode, localProjectDataMap, activeProjectIds, refreshActiveProjects]);

  const updateAllocation = useCallback(async (task: Task) => {
    if (!settings) return;
    
    // Optimistic update - update local state immediately
    setRawAllocations(prev => 
      prev.map(a => a.id === task.id ? { ...a, ...task } : a)
    );
    
    // Trigger workload refresh immediately for smooth UI update
    setAllocationsVersion(v => v + 1);

    try {
      await allocationsApi.update(task.id.toString(), task, settings, viewMode);
    } catch (err) {
      logger.error('[useAllocations] Failed to update allocation:', err);
      // Revert on error
      await fetchAllocations();
      setAllocationsVersion(v => v + 1);
    }
  }, [fetchAllocations, settings, viewMode]);

  // Soft delete - remove from UI state, return the deleted allocation for undo
  const softDeleteAllocation = useCallback((id: string | number): Allocation | undefined => {
    const idStr = id.toString();
    const deletedAllocation = rawAllocations.find(a => a.id.toString() === idStr);
    setRawAllocations(prev => prev.filter(a => a.id.toString() !== idStr));
    setAllocationsVersion(v => v + 1);
    return deletedAllocation;
  }, [rawAllocations]);

  // Restore a soft-deleted allocation back to state
  const restoreAllocation = useCallback((allocation: Allocation) => {
    setRawAllocations(prev => [...prev, allocation]);
    setAllocationsVersion(v => v + 1);
  }, []);

  // Commit delete - actually call the API, restore on failure
  const commitDeleteAllocation = useCallback(async (
    id: string | number,
    allocation?: Allocation,
    onError?: () => void
  ) => {
    try {
      await allocationsApi.delete(id.toString());
    } catch (err) {
      logger.error('[useAllocations] Failed to delete allocation:', err);
      if (allocation) {
        restoreAllocation(allocation);
      }
      onError?.();
    }
  }, [restoreAllocation]);

  const duplicateAllocation = useCallback(async (
    task: Task,
    newStartDate: string,
    newEndDate: string
  ) => {
    if (!settings) return;

    const duplicatedTask: Omit<Task, 'id'> = {
      ...task,
      startDate: newStartDate,
      endDate: newEndDate,
    };
    // Remove the id so a new one is created
    delete (duplicatedTask as any).id;

    // Use addAllocation which now has optimistic update
    await addAllocation(duplicatedTask);
  }, [settings, addAllocation]);

  // Bulk update PM for all allocations of a project
  const bulkUpdateAllocationPM = useCallback(async (projectId: string, newManagerId: string) => {
    if (!settings || !settings.allocationManagerColumnId) return;

    // Find all allocations for this project
    const projectAllocations = rawAllocations.filter(
      a => a.projectId?.toString() === projectId
    );

    if (projectAllocations.length === 0) return;

    logger.debug('[useAllocations] Bulk updating PM for project:', {
      projectId,
      newManagerId,
      allocationCount: projectAllocations.length
    });

    // Update each allocation via API sequentially to avoid complexity budget exhaustion
    const operations = projectAllocations.map(allocation =>
      () => allocationsApi.update(
        allocation.id.toString(),
        { ...allocation, managerId: newManagerId },
        settings,
        viewMode
      )
    );

    const { failedCount } = await batchMutations(operations);
    if (failedCount > 0) {
      logger.warn(`[useAllocations] Bulk PM update: ${failedCount}/${projectAllocations.length} failed`);
    }
    logger.debug('[useAllocations] Bulk PM update completed for project:', projectId);
    return { failedCount, total: projectAllocations.length };
  }, [settings, rawAllocations, viewMode]);

  // Patch a single project's column data in-place — used after editing PM /
  // project type from the Gantt header so the change persists across Card
  // remounts (collapse/expand, virtualization) without a network refetch.
  const patchProjectData = useCallback((projectId: string, patch: Record<string, any>) => {
    // Remember which ids carry an optimistic local edit. The GanttProvider merge
    // seeds board-fresh project data first (it wins for active projects), which
    // would otherwise SHADOW this optimistic edit in the PM/type filter options
    // until ActiveProjects refetches. Exposing the patched-id set lets the merge
    // overlay the local value for exactly these ids. Joined by id.
    patchedProjectIdsRef.current.add(projectId.toString());
    setLocalProjectDataMap(prev => {
      const existing = prev.get(projectId);
      const next = new Map(prev);
      next.set(projectId, { ...(existing || { id: projectId }), ...patch });
      return next;
    });
  }, []);

  return {
    groups,
    rawAllocations,
    employees: employeesWithPhotos,
    allProjects,
    roles,
    projectDataMap: localProjectDataMap,
    patchedProjectIds: patchedProjectIdsRef.current,
    roleColorMap,
    capabilityOptions,
    loading,
    // Rule 1/6/7: always-background-past window state + fetch-more/retry.
    pastLoadState,
    loadSettling,
    fetchMorePast,
    retryPast,
    earliestLoadedDate,
    error,
    errorKind,
    addAllocation,
    updateAllocation,
    softDeleteAllocation,
    commitDeleteAllocation,
    restoreAllocation,
    duplicateAllocation,
    bulkUpdateAllocationPM,
    patchProjectData,
    refresh: fetchAllocations,
    allocationsVersion
  };
};
