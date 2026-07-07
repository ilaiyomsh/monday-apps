import React, { useState, useRef, type ReactNode, useMemo, useCallback, useEffect, useTransition, lazy, Suspense } from 'react';
import { parseISO, addDays, startOfDay } from 'date-fns';
import type { ZoomLevel, ViewMode, TaskId, Task, Group, Allocation, ProjectClassification, RoleAvailability, RoleAvailabilityDay, RoleCapacity, ProjectMetrics } from '../../types/gantt.types';
import type { TimeframeFilter, UtilizationFilter, PMFilter, ProjectTypeFilter, AvailablePM, AvailableProjectType } from './GanttContext';
import { DEFAULT_ZOOM, CONFIG } from '../../utils/constants';
import { GanttContext } from './GanttContext';
import { useDataFlattener, matchesTimeframe, matchesUtilization } from '../../hooks/useDataFlattener';
import { useInfiniteTimeline } from '../../hooks/useInfiniteTimeline';
import { useHorizontalVirtualization } from '../../hooks/useHorizontalVirtualization';
import { useAllocations } from '../../hooks/useAllocations';
import { useProjectMetrics } from '../../hooks/useProjectMetrics';
import { useCompanyLoad } from '../../hooks/useCompanyLoad';
import { useSettings } from '../../contexts/SettingsContext';
import { useHolidays } from '../../hooks/useHolidays';
import { useEmployeeAbsences } from '../../hooks/useEmployeeAbsences';
import { useAvailability } from '../../hooks/useAvailability';
import { useEmployeeLoad } from '../../hooks/useEmployeeLoad';

// Lazy-load AllocationModal - only loaded when user edits/creates allocations
const AllocationModal = lazy(() =>
  import('./AllocationModal').then(m => ({ default: m.AllocationModal }))
);

// Lazy-load BulkAllocationModal - only loaded when user opens bulk allocation
const BulkAllocationModal = lazy(() =>
  import('./BulkAllocationModal').then(m => ({ default: m.BulkAllocationModal }))
);
import { useActiveProjects } from '../../contexts/ActiveProjectsContext';
import { getProjectColor } from '../../utils/colorUtils';
import { classifyProject, isClassificationEnabled, CLASSIFICATION_ORDER } from '../../utils/projectClassification';
import { getDefaultEffortModeByZoom } from '../../utils/effortUtils';
import { useDisplayUnit } from '../../hooks/useDisplayUnit';
import mondaySdk from 'monday-sdk-js';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../hooks/useLocale';
import { logger } from '../../utils/Logger';

const monday = mondaySdk();
const SIDEBAR_WIDTH_KEY = 'planner_sidebar_width';
const MIN_SIDEBAR_WIDTH = 150;

interface GanttProviderProps {
  children: ReactNode;
}

export const GanttProvider: React.FC<GanttProviderProps> = ({
  children
}) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { settings } = useSettings();
  const [viewMode, setViewModeState] = useState<ViewMode>('projects');
  const [isPending, startTransition] = useTransition();
  const [sidebarWidth, setSidebarWidthState] = useState<number>(CONFIG.sidebarWidth);

  // Load sidebar width from storage
  useEffect(() => {
    async function loadSidebarWidth() {
      try {
        const response = await (monday.storage.instance as any).getItem(SIDEBAR_WIDTH_KEY);
        if (response.data?.value) {
          const savedWidth = parseInt(response.data.value, 10);
          if (!isNaN(savedWidth) && savedWidth >= MIN_SIDEBAR_WIDTH) {
            setSidebarWidthState(savedWidth);
          }
        }
      } catch (err) {
        logger.error('[GanttProvider] Failed to load sidebar width from storage:', err);
      }
    }
    loadSidebarWidth();
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    const newWidth = Math.max(width, MIN_SIDEBAR_WIDTH);
    setSidebarWidthState(newWidth);
  }, []);

  const saveSidebarWidth = useCallback((width: number) => {
    const newWidth = Math.max(width, MIN_SIDEBAR_WIDTH);
    (monday.storage.instance as any).setItem(SIDEBAR_WIDTH_KEY, newWidth.toString());
  }, []);
  
  const setViewMode = useCallback((mode: ViewMode) => {
    startTransition(() => {
      setViewModeState(mode);
    });
  }, []);
  
  // Core data state from our new hook
  const {
    groups: rawGroups,
    rawAllocations,
    employees,
    allProjects,
    roles,
    loading,
    pastLoadState,
    loadSettling,
    fetchMorePast,
    retryPast,
    earliestLoadedDate,
    error: allocationsError,
    errorKind: allocationsErrorKind,
    refresh: refreshAllocations,
    projectDataMap,          // now sourced from allocation nested data
    patchedProjectIds,       // ids with an optimistic edit — overlaid over board data
    addAllocation,
    updateAllocation,
    softDeleteAllocation,
    commitDeleteAllocation,
    restoreAllocation,
    duplicateAllocation,
    bulkUpdateAllocationPM,
    patchProjectData
  } = useAllocations(viewMode);

  // Get all projects from context — eager-loaded in the background (Rule 5)
  const { allProjects: allProjectsFromBoard, activeProjectIds } = useActiveProjects();

  // Rule 5: projectDataMap = ALL projects for card metadata + dimming. Seed from
  // the board-fresh active set (full columns incl. classification — WINS on
  // conflict), then add allocation-derived entries (inactive-with-allocations)
  // whose id is absent. Joined by id, never name.
  const mergedProjectDataMap = useMemo(() => {
    const m = new Map<string, any>();
    allProjectsFromBoard?.forEach(p => m.set(p.id.toString(), p));
    // Local entries fill gaps (inactive-with-allocations) AND overlay the board
    // for ids carrying an optimistic edit — otherwise a just-edited PM/type would
    // be shadowed by stale board data in the filter options until the next refetch.
    projectDataMap.forEach((v, k) => { if (!m.has(k) || patchedProjectIds.has(k)) m.set(k, v); });
    return m;
  }, [allProjectsFromBoard, projectDataMap, patchedProjectIds]);

  // Per-project hour metrics (planned / allocated / reported). Allocated +
  // reported are summed server-side across ALL allocations / time logs via two
  // aggregates, fetched OFF the critical path (useProjectMetrics) so they never
  // delay first paint. Planned comes from a projects-board number column
  // (project metadata, already in mergedProjectDataMap). The combined map is
  // surfaced to the project card, which renders all three numbers together only
  // when `projectMetricsReady` is true.
  const {
    allocatedByProject,
    reportedByProject,
    ready: projectMetricsReady,
  } = useProjectMetrics(settings);

  const projectMetrics = useMemo(() => {
    const m = new Map<string, ProjectMetrics>();
    const plannedCol = settings?.projectPlannedHoursColumnId;
    const ids = new Set<string>([
      ...allocatedByProject.keys(),
      ...reportedByProject.keys(),
      ...mergedProjectDataMap.keys(),
    ]);
    ids.forEach((id) => {
      let planned: number | null = null;
      if (plannedCol) {
        const raw = mergedProjectDataMap.get(id)?.[plannedCol];
        if (raw !== undefined && raw !== null && raw !== '') {
          const n = parseFloat(raw);
          if (Number.isFinite(n)) planned = n;
        }
      }
      m.set(id, {
        planned,
        allocated: allocatedByProject.get(id) ?? 0,
        reported: reportedByProject.get(id) ?? 0,
      });
    });
    return m;
  }, [allocatedByProject, reportedByProject, mergedProjectDataMap, settings?.projectPlannedHoursColumnId]);

  // Rule 2: the DATA window (load-calc extent) is the full loaded span —
  // earliest loaded past .. latest allocation end (at least timelineEnd) —
  // DISTINCT from the scroll-bounded RENDER window (timelineStart/timelineEnd).
  // All four load consumers below receive these IDENTICAL bounds so the
  // numerator (load) and denominator (availability/absences) can't disagree.
  // Defined just below where timelineEnd is available (see dataWindow memo).

  const [zoomLevelState, setZoomLevelState] = useState<ZoomLevel>(
    (settings?.defaultZoomLevel as ZoomLevel) || DEFAULT_ZOOM
  );
  const zoomInitializedRef = useRef(false);

  // Sync zoom level from settings on first load (when settings arrive async)
  useEffect(() => {
    if (settings?.defaultZoomLevel && !zoomInitializedRef.current) {
      zoomInitializedRef.current = true;
      setZoomLevelState(settings.defaultZoomLevel as ZoomLevel);
    }
  }, [settings?.defaultZoomLevel]);

  const [searchQuery, setSearchQuery] = useState('');
  const [timeframeFilter, setTimeframeFilterState] = useState<TimeframeFilter>([]);
  const [utilizationFilter, setUtilizationFilterState] = useState<UtilizationFilter>([]);
  const [hidePastAllocations, setHidePastAllocationsState] = useState(true);
  // Rule 3: the toggle is now PURE bar-visibility — past data is always loaded
  // in the background (Rule 1), so turning it off no longer triggers a fetch.
  // Data + load calc are unaffected; only PAST BARS are shown/hidden.
  const setHidePastAllocations = useCallback((hide: boolean) => {
    setHidePastAllocationsState(hide);
  }, []);
  const [hideProjectsWithoutActiveAllocations, setHideProjectsWithoutActiveAllocations] = useState(true);
  const [showOnlyActiveProjectsWithoutAllocations, setShowOnlyActiveProjectsWithoutAllocations] = useState(false);
  const [pmFilter, setPmFilter] = useState<PMFilter>([]);
  const [projectTypeFilter, setProjectTypeFilter] = useState<ProjectTypeFilter>([]);

  // Auto-check hidePastAllocations when any filter is activated
  const setTimeframeFilter = useCallback((filter: TimeframeFilter) => {
    setTimeframeFilterState(filter);
    if (filter.length > 0) setHidePastAllocationsState(true);
  }, []);

  const setUtilizationFilter = useCallback((filter: UtilizationFilter) => {
    setUtilizationFilterState(filter);
    if (filter.length > 0) setHidePastAllocationsState(true);
  }, []);
  const [forceShownProjects, setForceShownProjects] = useState<Map<string, string>>(new Map());
  const [collapsedSections, setCollapsedSections] = useState<Set<ProjectClassification>>(new Set());

  const toggleSection = useCallback((classification: ProjectClassification) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(classification)) next.delete(classification);
      else next.add(classification);
      return next;
    });
  }, []);

  // Extract unique PMs and project types from projectDataMap
  const { availablePMs, availableProjectTypes } = useMemo(() => {
    const pms = new Map<string, AvailablePM>();
    const types = new Map<string, AvailableProjectType>();

    if (!settings?.projectManagerColumnId && !settings?.projectTypeColumnId) {
      return { availablePMs: [], availableProjectTypes: [] };
    }

    mergedProjectDataMap.forEach((project) => {
      // Extract PM
      if (settings?.projectManagerColumnId) {
        const pmName = project[settings.projectManagerColumnId];
        const pmId = project[settings.projectManagerColumnId + '_id'];
        const pmPhotoUrl = project[settings.projectManagerColumnId + '_photo'];
        if (pmName && pmId && !pms.has(pmId)) {
          pms.set(pmId, { id: pmId, name: pmName, photoUrl: pmPhotoUrl });
        }
      }

      // Extract project type
      if (settings?.projectTypeColumnId) {
        const typeLabel = project[settings.projectTypeColumnId];
        const typeColor = project[settings.projectTypeColumnId + '_color'];
        if (typeLabel && !types.has(typeLabel)) {
          types.set(typeLabel, { label: typeLabel, color: typeColor || 'var(--project-color-fallback)' });
        }
      }
    });

    return {
      availablePMs: Array.from(pms.values()).sort((a, b) => a.name.localeCompare(b.name, locale.dateLocale)),
      availableProjectTypes: Array.from(types.values()).sort((a, b) => a.label.localeCompare(b.label, locale.dateLocale))
    };
  }, [mergedProjectDataMap, settings?.projectManagerColumnId, settings?.projectTypeColumnId, locale.dateLocale]);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Undo delete state
  const [pendingDelete, setPendingDelete] = useState<{ allocation: Allocation; name: string } | null>(null);
  const pendingDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deleteAllocation = useCallback((id: TaskId) => {
    // If there's a pending delete, commit it immediately before starting a new one
    if (pendingDeleteTimerRef.current) {
      clearTimeout(pendingDeleteTimerRef.current);
      pendingDeleteTimerRef.current = null;
    }
    if (pendingDelete) {
      commitDeleteAllocation(pendingDelete.allocation.id, pendingDelete.allocation, () => {
        showToast(t('ganttProvider.toast.deleteFailed'), 'error');
      });
      setPendingDelete(null);
    }

    const deleted = softDeleteAllocation(id);
    if (!deleted) return;

    const name = deleted.name || deleted.projectName || '';
    setPendingDelete({ allocation: deleted, name });

    pendingDeleteTimerRef.current = setTimeout(() => {
      commitDeleteAllocation(deleted.id, deleted, () => {
        showToast(t('ganttProvider.toast.deleteFailed'), 'error');
      });
      setPendingDelete(null);
      pendingDeleteTimerRef.current = null;
    }, 4000);
  }, [softDeleteAllocation, commitDeleteAllocation, pendingDelete, showToast, t]);

  const undoDelete = useCallback(() => {
    if (!pendingDelete) return;
    if (pendingDeleteTimerRef.current) {
      clearTimeout(pendingDeleteTimerRef.current);
      pendingDeleteTimerRef.current = null;
    }
    restoreAllocation(pendingDelete.allocation);
    setPendingDelete(null);
  }, [pendingDelete, restoreAllocation]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (pendingDeleteTimerRef.current) {
        clearTimeout(pendingDeleteTimerRef.current);
      }
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Merge force-shown projects into groups (for projects view)
  const groups = useMemo(() => {
    if (viewMode !== 'projects' || forceShownProjects.size === 0) {
      return rawGroups;
    }

    // Find which force-shown projects are not already in groups
    const existingGroupIds = new Set(rawGroups.map(g => g.id.toString()));
    const missingProjectIds = [...forceShownProjects.keys()].filter(id => !existingGroupIds.has(id));

    if (missingProjectIds.length === 0) {
      return rawGroups;
    }

    // Create empty groups for missing projects (with classification when enabled)
    const classificationOn = isClassificationEnabled(settings);
    const newGroups: Group[] = missingProjectIds.map(projectId => {
      const fromBoard = allProjectsFromBoard?.find(p => p.id.toString() === projectId);
      const dataForClassify = fromBoard ?? projectDataMap.get(projectId);
      return {
        id: projectId,
        name: forceShownProjects.get(projectId) || fromBoard?.name || projectDataMap.get(projectId)?.name || `Project ${projectId}`,
        tasks: [],
        color: getProjectColor(projectId),
        classification: classificationOn ? classifyProject(dataForClassify, settings) : undefined,
      };
    });

    const merged = [...rawGroups, ...newGroups];

    // Re-sort by classification when enabled so force-shown lands in the right section
    if (classificationOn) {
      const order = (cls: Group['classification']) => CLASSIFICATION_ORDER.indexOf(cls ?? 'other');
      return merged
        .map((g, i) => ({ g, i }))
        .sort((a, b) => order(a.g.classification) - order(b.g.classification) || a.i - b.i)
        .map(({ g }) => g);
    }

    return merged;
  }, [rawGroups, viewMode, forceShownProjects, allProjectsFromBoard, projectDataMap, settings]);

  const { unit: displayUnit, setUnit: setDisplayUnit } = useDisplayUnit();

  const effectiveEffortMode = useMemo(() => {
    if (displayUnit === 'percent') return 'fte';
    return getDefaultEffortModeByZoom(zoomLevelState);
  }, [zoomLevelState, displayUnit]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string | number>>(new Set());

  // Employees view: focus a single employee (click on the name in the sidebar).
  // Cleared when switching away from employees view so it doesn't leak.
  const [selectedEmployeeId, setSelectedEmployeeIdState] = useState<string | number | null>(null);
  const setSelectedEmployeeId = useCallback((id: string | number | null) => {
    setSelectedEmployeeIdState(id);
  }, []);
  useEffect(() => {
    if (viewMode !== 'employees' && selectedEmployeeId !== null) {
      setSelectedEmployeeIdState(null);
    }
  }, [viewMode, selectedEmployeeId]);

  // Projects view: focus a single project (mirror of selectedEmployeeId).
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | number | null>(null);
  const setSelectedProjectId = useCallback((id: string | number | null) => {
    setSelectedProjectIdState(id);
  }, []);
  useEffect(() => {
    if (viewMode !== 'projects' && selectedProjectId !== null) {
      setSelectedProjectIdState(null);
    }
  }, [viewMode, selectedProjectId]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState<Partial<Task> | undefined>(undefined);

  // Bulk allocation modal state
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkModalData, setBulkModalData] = useState<{projectId: string; projectName: string} | null>(null);

  // Initialize expanded groups when data loads or view mode changes
  // Note: company-load is collapsed by default (not added to initialExpanded)
  useEffect(() => {
    if (groups.length > 0 && expandedGroups.size === 0) {
      const initialExpanded = new Set<string | number>();
      // זמינות חברה מצומצמת בברירת מחדל - לא מוסיפים אותה ל-set
      setExpandedGroups(initialExpanded);
    }
  }, [groups, viewMode]);

  // Auto-expand groups that have matching tasks when filters are active
  useEffect(() => {
    if (timeframeFilter.length === 0 && utilizationFilter.length === 0) return;
    const matchingGroupIds = new Set<string | number>();
    groups.forEach(group => {
      const hasMatch = group.tasks.some(task =>
        matchesTimeframe(task, timeframeFilter) && matchesUtilization(task, utilizationFilter)
      );
      if (hasMatch) matchingGroupIds.add(group.id);
    });
    setExpandedGroups(matchingGroupIds);
  }, [timeframeFilter, utilizationFilter]);

  const openModal = useCallback((data?: Partial<Task>) => {
    // Enrich projectName from groups when missing — handles force-shown projects
    // that have no allocations yet (and therefore not in `allProjects` either).
    let enriched = data;
    if (data && viewMode === 'projects' && !data.projectName) {
      const projectId = data.projectId || data.groupId;
      if (projectId) {
        const group = groups.find(g => g.id.toString() === projectId.toString());
        if (group?.name) {
          enriched = { ...data, projectId: projectId.toString(), projectName: group.name };
        }
      }
    }
    setModalData(enriched);
    setIsModalOpen(true);
  }, [groups, viewMode]);

  const openBulkModal = useCallback((projectId: string, projectName: string) => {
    setBulkModalData({ projectId, projectName });
    setIsBulkModalOpen(true);
  }, []);

  // Switch from single to bulk modal (passes project context)
  const switchToBulk = useCallback((projectId: string, projectName: string) => {
    setIsModalOpen(false);
    setModalData(undefined);
    setBulkModalData({ projectId, projectName });
    setIsBulkModalOpen(true);
  }, []);

  // Switch from bulk to single modal (passes project context)
  const switchToSingle = useCallback((projectId: string, projectName: string) => {
    setIsBulkModalOpen(false);
    setBulkModalData(null);
    setModalData({ groupId: projectId, projectId, projectName });
    setIsModalOpen(true);
  }, []);

  // Scroll state
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Infinite timeline management
  const {
    timelineStart,
    timelineEnd,
    displayDays,
    totalWidth,
    handleScroll: handleTimelineScroll,
    getXByDate,
    getDateByX,
    getWidthByDates,
    pixelsPerDay,
    containerRef,
    requestDrillDown,
  } = useInfiniteTimeline({
    zoomLevel: zoomLevelState,
    // Rule 1: scroll-near-past-edge triggers a debounced +1yr fetch-more; the
    // in-flight flag (loadSettling) guards against spurious fires.
    onReachPastEdge: fetchMorePast,
    isPastFetchInFlight: loadSettling,
  });

  // Update container width on resize.
  // Uses a RAF retry loop because the container element may not exist yet
  // (a loading screen is shown while data is fetched).  Once the container
  // mounts, the ResizeObserver is attached and the loop stops.
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    let rafId: number | null = null;

    const tryObserve = () => {
      const el = containerRef.current;
      if (!el) {
        rafId = requestAnimationFrame(tryObserve);
        return;
      }
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      observer.observe(el);
      setContainerWidth(el.clientWidth);
    };

    tryObserve();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (observer) observer.disconnect();
    };
  }, [containerRef]);

  // Horizontal virtualization for days/grid
  const visibleDayRange = useHorizontalVirtualization({
    scrollLeft,
    containerWidth,
    itemWidth: pixelsPerDay,
    totalItems: displayDays.length,
    buffer: CONFIG.horizontalBuffer / pixelsPerDay, // Convert pixel buffer to day buffer
  });

  // The single source of truth for all load circles: the same allTasks (bars).
  const allTasks = useMemo(() => groups.flatMap(g => g.tasks), [groups]);

  // Rule 2: the DATA window over which load is computed — the FULL loaded span,
  // independent of the show-past toggle and of project active/inactive status.
  // start = earliest loaded past window (1yr default before the first lands),
  // end = latest allocation end across rawAllocations (at least timelineEnd).
  const dataWindow = useMemo(() => {
    const start = earliestLoadedDate
      ? parseISO(earliestLoadedDate)
      : startOfDay(addDays(new Date(), -365));
    let maxEnd = timelineEnd;
    for (const a of rawAllocations) {
      if (!a.endDate) continue;
      const e = parseISO(a.endDate);
      if (e > maxEnd) maxEnd = e;
    }
    return { start, end: maxEnd };
  }, [earliestLoadedDate, rawAllocations, timelineEnd]);

  // Holidays (manual custom entries + Day-off general company days) + absences
  // feed both availability AND load (allocation hours on a day-off/holiday are
  // excluded from load — the day behaves like a weekend).
  const needsAvailability = true;

  // Company holidays are fetched for a GENEROUS, stable window (today −2y..+3y),
  // decoupled from the scrolling timeline. This way an allocation whose dates
  // fall outside the currently-visible window still excludes company holidays
  // from its working-day count (and the load math). Custom holidays are already
  // global (loaded whole from instance storage). Anchored once per session so
  // scrolling/zooming never re-fetches. Window cost is small — company days are
  // sparse and the fetch paginates.
  const holidayWindow = useMemo(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()),
      end: new Date(now.getFullYear() + 3, now.getMonth(), now.getDate()),
    };
  }, []);
  const { holidaysByDate } = useHolidays({
    settings,
    startDate: holidayWindow.start,
    endDate: holidayWindow.end,
  });

  // Per-employee absences (vacation, sick, military) from the time-report board
  // Rule 2: absences/availability/load ALL scoped to the DATA window (not the
  // render window) so numerator + denominator share identical bounds.
  const { absencesByEmployee, isLoading: absencesLoading } = useEmployeeAbsences({
    enabled: needsAvailability,
    settings,
    startDate: dataWindow.start,
    endDate: dataWindow.end,
  });

  // Rule 6/7: PER-PERIOD load gate (not a global flag). A company-load circle for
  // period P is skeletoned ONLY when P's own allocations aren't loaded yet — i.e.
  // P STARTS before settledFromTs (the loaded-back bound) and the background past
  // window is still in flight (or failed → error+retry). Visible current/future
  // circles (period >= today, fully covered by the critical fetch) render
  // immediately. Absences are NOT gated: a not-yet-loaded vacation only nudges the
  // denominator slightly (load % a touch low) and self-corrects when absences land
  // — far better than holding every circle grey for the wide-window absence fetch
  // (the ~10s tail users hit). Missing PAST allocations, by contrast, make a circle
  // badly wrong, which is exactly what the per-period skeleton guards.
  const loadGate = useMemo(() => ({
    settledFromTs: (earliestLoadedDate ? parseISO(earliestLoadedDate) : startOfDay(new Date())).getTime(),
    pastPending: loadSettling,
    pastError: pastLoadState === 'error',
    onRetry: retryPast,
  }), [earliestLoadedDate, loadSettling, pastLoadState, retryPast]);

  // Company Load Calculation — derived purely from allTasks, with day-off /
  // holiday hours excluded so the circle matches the bars beneath it. Computed
  // over the full DATA window (Rule 2), incl. past + inactive-project hours.
  const companyLoadData = useCompanyLoad(
    allTasks,
    employees,
    dataWindow.start,
    dataWindow.end,
    settings,
    settings?.allocationsBoardId,
    holidaysByDate,
    absencesByEmployee
  );

  // Per-employee daily load aggregation (used by Employees tab for the load row).
  const employeeLoad = useEmployeeLoad(allTasks, employees, dataWindow.start, dataWindow.end, settings, holidaysByDate, absencesByEmployee);

  // Per-employee + per-role availability for the Available tab
  const availability = useAvailability({
    employees,
    timelineStart: dataWindow.start,
    timelineEnd: dataWindow.end,
    workDays: settings?.workDays || [0, 1, 2, 3, 4],
    maxHoursPerDay: settings?.maxHoursPerDay || 8.5,
    holidaysByDate,
    absencesByEmployee,
  });

  // Company-total aggregates for the Projects tab "Company Load" row.
  // - companyAvailability: synthetic RoleAvailability summed across all roles
  //   so CompanyLoadRow + LoadCell render the single company-wide average row
  //   using their existing per-day capacity logic.
  // - companyLoadTotals: summed daily allocated hours + summed RoleCapacity.
  const companyAvailability = useMemo<RoleAvailability>(() => {
    const byDate = new Map<string, RoleAvailabilityDay>();
    let totalEmployees = 0;
    availability.byRole.forEach((roleAvail) => {
      totalEmployees += roleAvail.totalEmployees;
      roleAvail.byDate.forEach((day, key) => {
        const acc = byDate.get(key);
        if (!acc) {
          byDate.set(key, {
            hours: day.hours,
            capacity: day.capacity,
            availableEmployees: day.availableEmployees,
            totalEmployees: 0, // set after the loop
            reason: day.reason,
            holidayKey: day.holidayKey,
            informationalHolidayKey: day.informationalHolidayKey,
          });
        } else {
          acc.hours += day.hours;
          acc.capacity += day.capacity;
          acc.availableEmployees += day.availableEmployees;
          // Weekend/holiday/halfDay apply company-wide — lift if any role flags it.
          if (acc.reason === 'workday' && day.reason !== 'workday') {
            acc.reason = day.reason;
            acc.holidayKey = day.holidayKey;
          }
          if (!acc.informationalHolidayKey && day.informationalHolidayKey) {
            acc.informationalHolidayKey = day.informationalHolidayKey;
          }
        }
      });
    });
    // Stamp the company-total employee count on every day after summing.
    byDate.forEach((day) => { day.totalEmployees = totalEmployees; });
    return { role: '', totalEmployees, byDate };
  }, [availability]);

  const companyLoadTotals = useMemo<{ capacity: RoleCapacity; dailyLoads: Map<string, number> }>(() => {
    const dailyLoads = new Map<string, number>();
    let totalDailyHours = 0;
    let employeeCount = 0;
    companyLoadData.capacities.forEach((cap) => {
      totalDailyHours += cap.totalDailyHours;
      employeeCount += cap.employeeCount;
      const roleLoad = companyLoadData.loadByRole.get(cap.role);
      roleLoad?.forEach((hours, key) => {
        dailyLoads.set(key, (dailyLoads.get(key) || 0) + hours);
      });
    });
    return { capacity: { role: '', totalDailyHours, employeeCount }, dailyLoads };
  }, [companyLoadData]);

  // Data flattening with track packing
  const { flattenedData: flattenedRows, totalHeight } = useDataFlattener(
    groups,
    expandedGroups,
    viewMode,
    companyLoadData,
    searchQuery,
    timeframeFilter,
    utilizationFilter,
    forceShownProjects,
    pmFilter,
    projectTypeFilter,
    mergedProjectDataMap,
    settings,
    hidePastAllocations,
    hideProjectsWithoutActiveAllocations,
    collapsedSections,
    availability,
    employees,
    employeeLoad,
    companyAvailability,
    companyLoadTotals,
    selectedEmployeeId,
    showOnlyActiveProjectsWithoutAllocations,
    activeProjectIds,
    // Rule 6/7: per-period skeleton/error gate (each circle decides from its
    // own periodStart — visible current/future circles don't wait for the past).
    loadGate,
    selectedProjectId
  );

  // Toggle group expansion
  const toggleGroup = useCallback((groupId: string | number) => {
    setExpandedGroups(prev => {
      // Independent toggle — multiple groups may stay expanded at once.
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Add project to force-shown list (for projects without allocations)
  // Also auto-expand the group so the user sees empty tracks for creating allocations
  // Stores the projectName so the optimistic flow has access to it before the API returns.
  const addForceShownProject = useCallback((projectId: string, projectName: string) => {
    setForceShownProjects(prev => {
      const next = new Map(prev);
      next.set(projectId, projectName);
      return next;
    });
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
  }, []);

  // Update a single task
  const updateTask = useCallback(async (taskId: TaskId, updates: Partial<Task>) => {
    const task = groups.flatMap(g => g.tasks).find(t => t.id === taskId);
    if (task) {
      await updateAllocation({ ...task, ...updates });
    }
  }, [groups, updateAllocation]);

  // Memoized context value
  const value = useMemo(() => ({
    // Data
    groups,
    setGroups: () => {}, // No longer used directly
    flattenedRows,
    totalHeight,
    employees,
    roles,
    settings,
    rawAllocations,
    loading: loading || isPending,
    allocationsError,
    allocationsErrorKind,
    refreshAllocations,
    
    // Zoom
    zoomLevel: zoomLevelState,
    setZoomLevel: setZoomLevelState,
    viewMode,
    setViewMode,
    effectiveEffortMode,
    displayUnit,
    setDisplayUnit,
    searchQuery,
    setSearchQuery,

    // Filters
    timeframeFilter,
    setTimeframeFilter,
    utilizationFilter,
    setUtilizationFilter,
    hidePastAllocations,
    setHidePastAllocations,
    hideProjectsWithoutActiveAllocations,
    setHideProjectsWithoutActiveAllocations,
    showOnlyActiveProjectsWithoutAllocations,
    setShowOnlyActiveProjectsWithoutAllocations,
    pmFilter,
    setPmFilter,
    projectTypeFilter,
    setProjectTypeFilter,
    availablePMs,
    availableProjectTypes,

    // Groups expansion
    expandedGroups,
    toggleGroup,

    // Employee focus (employees view)
    selectedEmployeeId,
    setSelectedEmployeeId,

    // Project focus (projects view)
    selectedProjectId,
    setSelectedProjectId,

    // Classification section expansion
    collapsedSections,
    toggleSection,

    // Timeline (infinite scroll)
    timelineStart,
    timelineEnd,
    displayDays,
    totalWidth,
    handleTimelineScroll,
    
    // Coordinate conversion
    getXByDate,
    getDateByX,
    getWidthByDates,
    pixelsPerDay,
    requestDrillDown,

    // Scroll state
    scrollLeft,
    setScrollLeft,
    scrollTop,
    setScrollTop,
    containerWidth,
    visibleDayRange,
    
    // Sidebar
    sidebarWidth,
    setSidebarWidth,
    saveSidebarWidth,
    
    // Task operations
    updateTask,
    addAllocation,
    deleteAllocation,

    // Undo delete
    pendingDelete,
    undoDelete,

    // Toast notifications
    showToast,

    // Modal
    openModal,
    openBulkModal,

    // PM bulk update
    bulkUpdateAllocationPM: async (projectId: string, newManagerId: string) => {
      const result = await bulkUpdateAllocationPM(projectId, newManagerId);
      if (result && result.failedCount > 0) {
        showToast(t('ganttProvider.toast.bulkPmUpdateFailed', { failed: result.failedCount, total: result.total }), 'error');
      }
    },

    // Local project data patch (no network)
    patchProjectData,

    // Container ref
    containerRef,

    // Force-shown projects
    forceShownProjects,
    addForceShownProject,

    // Availability
    availability,
    absencesLoading,
    holidaysByDate,

    // Per-project hour metrics (planned / allocated / reported)
    projectMetrics,
    projectMetricsReady,
  }), [
    groups,
    flattenedRows,
    totalHeight,
    employees,
    roles,
    settings,
    rawAllocations,
    zoomLevelState,
    setZoomLevelState,
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    timeframeFilter,
    setTimeframeFilter,
    utilizationFilter,
    setUtilizationFilter,
    hidePastAllocations,
    setHidePastAllocations,
    hideProjectsWithoutActiveAllocations,
    setHideProjectsWithoutActiveAllocations,
    showOnlyActiveProjectsWithoutAllocations,
    setShowOnlyActiveProjectsWithoutAllocations,
    pmFilter,
    setPmFilter,
    projectTypeFilter,
    setProjectTypeFilter,
    availablePMs,
    availableProjectTypes,
    expandedGroups,
    toggleGroup,
    selectedEmployeeId,
    setSelectedEmployeeId,
    selectedProjectId,
    setSelectedProjectId,
    collapsedSections,
    toggleSection,
    timelineStart,
    timelineEnd,
    displayDays,
    totalWidth,
    handleTimelineScroll,
    getXByDate,
    getDateByX,
    getWidthByDates,
    pixelsPerDay,
    requestDrillDown,
    scrollLeft,
    scrollTop,
    containerWidth,
    visibleDayRange,
    sidebarWidth,
    setSidebarWidth,
    saveSidebarWidth,
    updateTask,
    addAllocation,
    deleteAllocation,
    pendingDelete,
    undoDelete,
    showToast,
    openModal,
    openBulkModal,
    bulkUpdateAllocationPM,
    patchProjectData,
    containerRef,
    forceShownProjects,
    addForceShownProject,
    availability,
    absencesLoading,
    holidaysByDate,
    displayUnit,
    setDisplayUnit,
    effectiveEffortMode,
    allocationsError,
    allocationsErrorKind,
    refreshAllocations,
    projectMetrics,
    projectMetricsReady,
  ]);

  const groupNames = useMemo(() => groups.map(g => g.name), [groups]);

  return (
    <GanttContext.Provider value={value}>
      {children}
      {/* Persistent backdrop – stays mounted during modal switches */}
      {(isModalOpen || (isBulkModalOpen && bulkModalData)) && (
        <div className="fixed inset-0 z-[99] bg-black/20" />
      )}
      <Suspense fallback={null}>
        <AllocationModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={(data) => {
            if (data.id) {
              updateTask(data.id, data);
            } else {
              addAllocation(data);
            }
          }}
          onDelete={deleteAllocation}
          onDuplicate={duplicateAllocation}
          initialData={modalData}
          groupNames={groupNames}
          viewMode={viewMode}
          allProjects={allProjects}
          employees={employees}
          availableRoles={roles}
          allAllocations={rawAllocations}
          onSwitchToBulk={switchToBulk}
        />
        {isBulkModalOpen && bulkModalData && (
          <BulkAllocationModal
            isOpen={isBulkModalOpen}
            onClose={() => {
              setIsBulkModalOpen(false);
              setBulkModalData(null);
            }}
            onSave={addAllocation}
            projectId={bulkModalData.projectId}
            projectName={bulkModalData.projectName}
            employees={employees}
            allAllocations={rawAllocations}
            onSwitchToSingle={switchToSingle}
          />
        )}
      </Suspense>

      {/* Toast Notifications */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 px-5 py-2.5 rounded-lg shadow-xl animate-in slide-in-from-bottom-4 fade-in duration-300 text-sm font-medium ${
            toast.type === 'error' ? 'bg-danger text-white' :
            toast.type === 'success' ? 'bg-success text-white' :
            'bg-bg-inverted text-text-on-inverted'
          }`}
          dir="rtl"
        >
          {toast.message}
        </div>
      )}
    </GanttContext.Provider>
  );
};
