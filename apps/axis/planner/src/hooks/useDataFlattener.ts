import { useMemo } from 'react';
import { isThisWeek, isThisMonth, parseISO, differenceInDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { Group, Task, FlatRow, GroupHeaderRow, TrackRow, LoadRow, RoleCapacity, RoleAvailability, ViewMode, ProjectClassification, SectionHeaderRow, EmployeeLoadRowData, Employee, LoadGate } from '../types/gantt.types';
import { CLASSIFICATION_LABEL_KEYS, CLASSIFICATION_ORDER, isClassificationEnabled } from '../utils/projectClassification';
import type { TimeframeFilter, UtilizationFilter, PMFilter, ProjectTypeFilter } from '../components/Gantt/GanttContext';
import type { PlannerSettings } from '../types/settings.types';
import type { AvailabilityData } from './useAvailability';
import { CONFIG, SUMMARY_TRACKS_GAP, FOCUS_BLOCK_GAP, GAP_COLOR_SUMMARY, GAP_COLOR_FOCUS } from '../utils/constants';

interface CompanyLoadData {
  capacities: RoleCapacity[];
  loadByRole: Map<string, Map<string, number>>;
}

/**
 * Track Packing Algorithm - Greedy First-Fit
 * ...
 */
const packTasksIntoTracks = (tasks: Task[]): Task[][] => {
  if (tasks.length === 0) return [];
  
  const sorted = [...tasks].sort((a, b) => 
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  
  const tracks: Task[][] = [];
  
  for (const task of sorted) {
    let placed = false;
    for (const track of tracks) {
      const lastItemInTrack = track[track.length - 1];
      const lastEndDate = new Date(lastItemInTrack.endDate);
      const taskStartDate = new Date(task.startDate);
      if (lastEndDate < taskStartDate) {
        track.push(task);
        placed = true;
        break;
      }
    }
    if (!placed) {
      tracks.push([task]);
    }
  }
  
  return tracks;
};

/**
 * Helper: Check if task matches timeframe filter
 */
export const matchesTimeframe = (task: Task, timeframeFilter: TimeframeFilter): boolean => {
  if (timeframeFilter.length === 0) return true;

  const endDate = parseISO(task.endDate);
  if (timeframeFilter.includes('ending_this_week') && isThisWeek(endDate, { weekStartsOn: 0 })) return true;
  if (timeframeFilter.includes('ending_this_month') && isThisMonth(endDate)) return true;
  return false;
};

/**
 * Helper: Calculate time progress for a task
 */
const calculateTimeProgress = (task: Task): number => {
  const start = parseISO(task.startDate);
  const end = parseISO(task.endDate);
  const today = new Date();

  const totalDays = differenceInDays(end, start) + 1;
  if (totalDays <= 0) return 100;

  // If task hasn't started yet
  if (today < start) return 0;

  // If task is complete
  if (today > end) return 100;

  const daysPassed = differenceInDays(today, start) + 1;
  return (daysPassed / totalDays) * 100;
};

/**
 * Helper: Check if task matches utilization filter
 * - Red: Over budget (utilization > 100%)
 * - Yellow/Orange: Burning faster than time (utilization > timeProgress)
 * - Blue: Behind schedule (reporting < 50% of expected rate)
 * - Green: On track (utilization <= timeProgress)
 */
export const matchesUtilization = (task: Task, utilizationFilter: UtilizationFilter): boolean => {
  if (utilizationFilter.length === 0) return true;

  const reported = task.reportedHours || 0;
  const total = task.totalHours || 0;
  if (total <= 0) return utilizationFilter.includes('green'); // No hours = green

  const utilization = (reported / total) * 100;
  const timeProgress = calculateTimeProgress(task);

  // Match TaskBar.tsx coloring precedence: red → yellow → blue → green (else).
  let bucket: 'red' | 'yellow' | 'blue' | 'green';
  if (utilization > 100) bucket = 'red';
  else if (utilization > timeProgress * 1.2) bucket = 'yellow';
  else if (timeProgress > 0 && utilization < timeProgress * 0.5) bucket = 'blue';
  else bucket = 'green';

  return utilizationFilter.includes(bucket);
};

/**
 * Hook that flattens hierarchical group/task data into a flat list with track packing
 */
export const useDataFlattener = (
  groups: Group[],
  expandedGroups: Set<string | number>,
  viewMode: ViewMode,
  companyLoadData?: CompanyLoadData,
  searchQuery?: string,
  timeframeFilter: TimeframeFilter = [],
  utilizationFilter: UtilizationFilter = [],
  forceShownProjects?: Map<string, string>,
  pmFilter: PMFilter = [],
  projectTypeFilter: ProjectTypeFilter = [],
  projectDataMap?: Map<string, any>,
  settings?: PlannerSettings | null,
  hidePastAllocations: boolean = false,
  hideProjectsWithoutActiveAllocations: boolean = true,
  collapsedSections: Set<ProjectClassification> = new Set(),
  availability?: AvailabilityData,
  allEmployees: Employee[] = [],
  employeeLoad?: { loadByEmployee: Map<string, Map<string, number>> },
  companyAvailability?: RoleAvailability,
  companyLoadTotals?: { capacity: RoleCapacity; dailyLoads: Map<string, number> },
  selectedEmployeeId: string | number | null = null,
  showOnlyActiveProjectsWithoutAllocations: boolean = false,
  activeProjectIds: Set<string> = new Set(),
  // Rule 6/7: per-period skeleton/error gate for the load circles (see LoadGate).
  // Each circle decides from its own periodStart — a global flag would grey the
  // whole row incl. visible periods while only off-screen past periods pend.
  loadGate?: LoadGate,
  // Projects view: focus a single project. Mirror of selectedEmployeeId.
  selectedProjectId: string | number | null = null,
) => {
  const { t } = useTranslation();
  const flattenedData = useMemo(() => {
    const rows: FlatRow[] = [];

    // Projects focus mode: a single project is selected. Non-focused rows are
    // dimmed; the focused project is hoisted to the top of its section and other
    // sections collapse. Mirror of the employees focus (selectedEmployeeId).
    const projectsFocus = viewMode === 'projects' && selectedProjectId !== null;


    // 1. Add Company Load row (always at the top) - Only in Projects View
    //
    // A single company-wide averaged LOAD row: total allocated hours ÷ total
    // availability across everyone (the weighted company average). No per-role
    // breakdown — the row is not expandable.
    if (
      companyLoadData &&
      viewMode === 'projects' &&
      availability &&
      companyAvailability &&
      companyLoadTotals
    ) {
      const summaryRow: LoadRow = {
        id: 'company-load-summary',
        type: 'LOAD',
        height: CONFIG.rowHeight,
        role: '',
        capacity: companyLoadTotals.capacity,
        dailyLoads: companyLoadTotals.dailyLoads,
        variant: 'summary',
        totalAvailability: companyAvailability,
        summary: {
          title: t('companyLoad.groupTitle'),
          groupId: 'company-load',
          isExpanded: false,
          totalEmployees: companyAvailability.totalEmployees,
        },
        loadGate,
        dimmed: projectsFocus,
      };
      rows.push(summaryRow);
    }

    // 2. Filter groups by search query
    let filteredGroups = searchQuery
      ? groups.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : groups;

    // 2.5. Filter groups by PM and project type (only in projects view)
    if (viewMode === 'projects' && (pmFilter.length > 0 || projectTypeFilter.length > 0)) {
      filteredGroups = filteredGroups.filter(group => {
        // Force-shown projects bypass filter
        if (forceShownProjects?.has(group.id.toString())) return true;

        const projectData = projectDataMap?.get(group.id.toString());
        if (!projectData) return false;

        // Check PM filter
        if (pmFilter.length > 0 && settings?.projectManagerColumnId) {
          const projectPmId = projectData[settings.projectManagerColumnId + '_id'];
          if (!projectPmId || !pmFilter.includes(projectPmId)) return false;
        }

        // Check project type filter
        if (projectTypeFilter.length > 0 && settings?.projectTypeColumnId) {
          const projectType = projectData[settings.projectTypeColumnId];
          if (!projectType || !projectTypeFilter.includes(projectType)) return false;
        }

        return true;
      });
    }

    // 2.6. Inverse filter: show ONLY active projects (per settings) that have no active allocation.
    // Runs against the projects board (activeProjectIds) — so projects that exist in Monday but
    // have no Allocation rows at all are still surfaced (groups list is keyed on allocations,
    // so we need to inject empty groups for them too).
    if (showOnlyActiveProjectsWithoutAllocations && viewMode === 'projects') {
      const now = new Date();
      const groupsWithActiveAlloc = new Set(
        filteredGroups
          .filter(g => g.tasks.some(t => parseISO(t.startDate) <= now && parseISO(t.endDate) >= now))
          .map(g => g.id.toString())
      );
      // Keep only groups that are active per settings AND have no active allocation.
      filteredGroups = filteredGroups.filter(g =>
        activeProjectIds.has(g.id.toString()) && !groupsWithActiveAlloc.has(g.id.toString())
      );
      // Inject empty groups for active projects that have NO allocations at all (not in `groups`).
      const existingIds = new Set(filteredGroups.map(g => g.id.toString()));
      activeProjectIds.forEach(pid => {
        if (existingIds.has(pid)) return;
        const data = projectDataMap?.get(pid);
        if (!data) return;
        filteredGroups.push({
          id: pid,
          name: data.name || pid,
          tasks: [],
          classification: data[settings?.projectClassificationColumnId || ''] as any,
        } as Group);
      });
    }

    // 3. Apply task-level filters (timeframe, utilization, and past allocations)
    // Optimized: Only create new objects when tasks are actually filtered out
    const now = new Date();
    // The "inverse" filter takes precedence over hideProjectsWithoutActiveAllocations
    // (semantically opposite: it intentionally surfaces projects with zero active allocations).
    // Tied to hidePastAllocations: turning OFF "hide past" is the master switch for
    // showing history — it must also reveal projects that have ONLY past allocations
    // (no allocation crossing today), otherwise their loaded past allocations stay
    // hidden behind this project-level gate. See the past-allocations on-demand load.
    const effectiveHideEmpty =
      hideProjectsWithoutActiveAllocations &&
      !showOnlyActiveProjectsWithoutAllocations &&
      hidePastAllocations;
    const hasTaskFilters = timeframeFilter.length > 0 || utilizationFilter.length > 0 || hidePastAllocations || effectiveHideEmpty;

    if (hasTaskFilters) {
      filteredGroups = filteredGroups.reduce<Group[]>((acc, group) => {
        const isForceShown = forceShownProjects?.has(group.id.toString());

        // Project-level filter: only show projects with at least one active allocation
        // (startDate <= today <= endDate), unless force-shown via "+" button
        if (effectiveHideEmpty && viewMode === 'projects' && !isForceShown) {
          const hasActiveAllocation = group.tasks.some(task => {
            const start = parseISO(task.startDate);
            const end = parseISO(task.endDate);
            return start <= now && end >= now;
          });
          if (!hasActiveAllocation) return acc;
        }

        const filteredTasks = group.tasks.filter(task => {
          // Filter out past allocations (end date before today)
          if (hidePastAllocations && parseISO(task.endDate) < now) return false;
          return matchesTimeframe(task, timeframeFilter) && matchesUtilization(task, utilizationFilter);
        });

        // Keep group if it has matching tasks, is force-shown, or we're in the
        // "active projects without allocations" mode (which intentionally keeps empty groups).
        if (filteredTasks.length > 0 || isForceShown || showOnlyActiveProjectsWithoutAllocations) {
          // Only create new object if tasks were actually filtered out
          acc.push(filteredTasks.length === group.tasks.length ? group : { ...group, tasks: filteredTasks });
        }
        return acc;
      }, []);
    }

    // 4. Add Project/Employee Groups
    const isClassified = viewMode === 'projects' && isClassificationEnabled(settings);

    // Focus (projects OR employees) no longer HOISTS the focused row to the top
    // of the table — the row stays in its natural position. Focus only
    // force-expands the focused row, dims the rest, and highlights the focused
    // block's edges (below). In projects view it still collapses the OTHER
    // classification sections so the focused project's neighbourhood stays tidy
    // (no reorder of the rows themselves).
    let effectiveCollapsedSections = collapsedSections;
    if (projectsFocus && isClassified) {
      const sel = filteredGroups.find(g => String(g.id) === String(selectedProjectId));
      if (sel) {
        const selCls: ProjectClassification = sel.classification ?? 'other';
        effectiveCollapsedSections = new Set(
          CLASSIFICATION_ORDER.filter(cls => cls !== selCls)
        );
      }
    }

    // Pre-compute counts per section to render `(N)` next to the section header
    const sectionCounts = new Map<ProjectClassification, number>();
    if (isClassified) {
      for (const cls of CLASSIFICATION_ORDER) sectionCounts.set(cls, 0);
      filteredGroups.forEach(g => {
        const cls = g.classification ?? 'other';
        sectionCounts.set(cls, (sectionCounts.get(cls) ?? 0) + 1);
      });
    }

    // Resolve the representative status-label color for each section by scanning
    // the first project in each bucket whose record carries `[columnId + '_color']`.
    const sectionColors = new Map<ProjectClassification, string>();
    if (isClassified && settings?.projectClassificationColumnId) {
      const colorKey = settings.projectClassificationColumnId + '_color';
      filteredGroups.forEach(g => {
        const cls = g.classification ?? 'other';
        if (sectionColors.has(cls)) return;
        const data = projectDataMap?.get(g.id.toString());
        const color = data?.[colorKey];
        if (typeof color === 'string' && color) sectionColors.set(cls, color);
      });
    }

    let currentSection: ProjectClassification | null = null;
    let currentSectionCollapsed = false;

    filteredGroups.forEach((group) => {
      if (isClassified) {
        const cls: ProjectClassification = group.classification ?? 'other';
        if (cls !== currentSection) {
          // Emit a section header on transition (skip empty sections — won't reach here if count = 0)
          const isSectionExpanded = !effectiveCollapsedSections.has(cls);
          const sectionRow: SectionHeaderRow = {
            id: `section-${cls}`,
            type: 'SECTION',
            height: CONFIG.groupHeaderHeight,
            classification: cls,
            label: t(CLASSIFICATION_LABEL_KEYS[cls]),
            isExpanded: isSectionExpanded,
            count: sectionCounts.get(cls) ?? 0,
            accentColor: sectionColors.get(cls),
            dimmed: projectsFocus,
          };
          rows.push(sectionRow);
          currentSection = cls;
          currentSectionCollapsed = !isSectionExpanded;
        }
        if (currentSectionCollapsed) return; // skip groups inside a collapsed section
      }

      // Employees view: when a single employee is selected, override the
      // normal expand state — the selected employee is forced expanded and
      // every other employee is forced collapsed (header-only). Projects view
      // is unaffected.
      const isEmployeesFocusMode = viewMode === 'employees' && selectedEmployeeId !== null;
      const isSelectedEmployee = isEmployeesFocusMode && String(group.id) === String(selectedEmployeeId);
      // Projects focus: the focused project is forced expanded; every other
      // project collapses to header-only and is dimmed.
      const isSelectedProject = projectsFocus && String(group.id) === String(selectedProjectId);
      const rowDimmed = projectsFocus && !isSelectedProject;
      const isExpanded = isEmployeesFocusMode
        ? isSelectedEmployee
        : projectsFocus
          ? isSelectedProject
          : expandedGroups.has(group.id);

      // Projects-view summary card (PM/type + hours metrics) shows for an expanded
      // project that carries a projectSummary.
      const hasProjectSummary = viewMode === 'projects' && !!group.projectSummary;
      const summaryCardShown = hasProjectSummary && isExpanded;
      // Gaps (all folded into row height; rendered as blended spacers + shadow):
      // • header gapBottom — the summary↔tracks gap, filled color-A so header +
      //   gap + card are one band. Card + allocations start together BELOW it, so
      //   they stay row-aligned (the gap lives on the header, not the first track).
      // • focus gaps — page-bg space above the header / below the last track,
      //   detaching the focused block.
      const headerGapTop = isSelectedProject ? FOCUS_BLOCK_GAP : 0;
      const headerGapBottom = summaryCardShown ? SUMMARY_TRACKS_GAP : 0;
      const focusBottomGap = isSelectedProject ? FOCUS_BLOCK_GAP : 0;

      // Employees view: render the single per-employee header row — its circles
      // show the employee's PLANNED LOAD (allocated ÷ availability), and the
      // chevron toggles the project allocation tracks below.
      if (viewMode === 'employees' && availability) {
        const emp = allEmployees.find((e) => String(e.id) === String(group.id));
        if (emp) {
          const dailyLoads = employeeLoad?.loadByEmployee.get(String(group.id)) || new Map();
          const dailyCapacity = (emp.allocationPercentage / 100) * (settings?.maxHoursPerDay || 8.5);
          const empRow: EmployeeLoadRowData = {
            id: `employee-load-${group.id}`,
            type: 'EMPLOYEE_LOAD',
            height: CONFIG.rowHeight,
            employee: emp,
            role: emp.role || '',
            dailyCapacity,
            dailyLoads,
            expandable: true,
            isExpanded,
            groupId: group.id,
            loadGate,
          };
          rows.push(empRow);
        } else {
          // Fall back to plain group header if employee data isn't ready.
          const groupRow: GroupHeaderRow = {
            id: `group-${group.id}`,
            type: 'GROUP',
            height: CONFIG.groupHeaderHeight,
            data: group,
            isExpanded,
          };
          rows.push(groupRow);
        }
      } else {
        const groupRow: GroupHeaderRow = {
          id: `group-${group.id}`,
          type: 'GROUP',
          height: CONFIG.groupHeaderHeight + headerGapTop + headerGapBottom,
          data: group,
          isExpanded,
          dimmed: rowDimmed,
          // Top edge of the focused block (its last track gets the bottom edge).
          focusEdge: isSelectedProject ? 'top' : undefined,
          focusBlock: isSelectedProject || undefined,
          // Page-bg gap ABOVE the focused block; color-A gap BELOW the summary
          // (the summary↔tracks separation — see GroupHeaderRow for its shadow).
          gapTop: headerGapTop || undefined,
          gapTopColor: headerGapTop ? GAP_COLOR_FOCUS : undefined,
          gapBottom: headerGapBottom || undefined,
          gapBottomColor: headerGapBottom ? GAP_COLOR_SUMMARY : undefined,
        };
        rows.push(groupRow);
      }

      // Rule 4: a project is "inactive" when it is NOT in the active set — id
      // join, never name. Self-disables when no filter is configured (the set is
      // empty ⇒ nothing is inactive). Visual-only; never affects load calc.
      // ONLY meaningful in projects view, where group.id IS a projectId. In
      // employees view group.id is an employeeId (never in the project-id set),
      // so an unguarded check would mass-dim every bar — guard on viewMode.
      const isInactiveProject =
        viewMode === 'projects' &&
        activeProjectIds.size > 0 &&
        !activeProjectIds.has(group.id.toString());

      if (isExpanded) {
        const tracks = packTasksIntoTracks(group.tasks);

        // Track-row count for the block:
        // • Card (focused) projects: EXACTLY max(realTracks, card rows) — NO
        //   gratuitous trailing "add allocation" row. This is what keeps focused
        //   blocks UNIFORM between projects: a 1- and a 2-allocation project both
        //   fill the fixed 2-row (96px) card, and only 3+ allocations grow the
        //   block by real content. (Previously an empty final track was always
        //   appended, so a 2-allocation project was one dead white row taller than
        //   a 1-allocation one.)
        // • Non-card expansions (employees view / projects without a summary):
        //   keep the extra trailing empty row for dropping a new allocation.
        const minRows = hasProjectSummary ? CONFIG.minExpandedTrackRows : tracks.length + 1;
        const totalRows = Math.max(tracks.length, minRows, 1);
        const lastIndex = totalRows - 1;

        for (let i = 0; i < totalRows; i++) {
          const isRealTrack = i < tracks.length;
          const isLast = i === lastIndex;
          // The bottom focus edge + page-bg gap live on the LAST row of the block
          // (whichever it is). Symmetric with the TOP focus gap (same fill + drop
          // shadow) so the block floats identically above and below — see
          // VirtualRowList, where the content box is z-lifted so this bottom
          // shadow isn't hidden by the spacer.
          const rowFocusBottomGap = isLast ? focusBottomGap : 0;
          const trackRow: TrackRow = {
            id: isRealTrack ? `track-${group.id}-${i}` : `track-${group.id}-empty-${i}`,
            type: 'TRACK',
            height: CONFIG.rowHeight + rowFocusBottomGap,
            groupId: group.id,
            items: isRealTrack ? tracks[i] : [],
            trackIndex: i,
            isInactiveProject: isRealTrack ? isInactiveProject : undefined,
            dimmed: rowDimmed,
            focusBlock: isSelectedProject || undefined,
            focusEdge: isLast && isSelectedProject ? 'bottom' : undefined,
            gapBottom: rowFocusBottomGap || undefined,
            gapBottomColor: rowFocusBottomGap ? GAP_COLOR_FOCUS : undefined,
          };
          rows.push(trackRow);
        }
      }
    });

    return rows;
    // `t` is in deps so a language flip re-flattens the rows (the company-load
    // group title is translated via t()). Acceptable cost: the entire row tree
    // is virtualization input, so a one-time recompute on language flip is
    // cheaper than threading a separate language-keyed memo through.
  }, [groups, expandedGroups, companyLoadData, viewMode, searchQuery, timeframeFilter, utilizationFilter, forceShownProjects, pmFilter, projectTypeFilter, projectDataMap, settings, hidePastAllocations, hideProjectsWithoutActiveAllocations, collapsedSections, t, availability, allEmployees, employeeLoad, companyAvailability, companyLoadTotals, selectedEmployeeId, showOnlyActiveProjectsWithoutAllocations, activeProjectIds, loadGate, selectedProjectId]);

  const totalHeight = useMemo(() => calculateTotalHeight(flattenedData), [flattenedData]);

  return { flattenedData, totalHeight };
};

/**
 * Calculates the total height of all rows
 */
export const calculateTotalHeight = (rows: FlatRow[]): number => {
  return rows.reduce((acc, row) => acc + row.height, 0);
};

/**
 * Calculates visible rows based on scroll position (vertical virtualization)
 */
export const getVisibleRange = (
  rows: FlatRow[],
  scrollTop: number,
  viewportHeight: number,
  buffer: number = CONFIG.verticalBuffer
): { startIndex: number; endIndex: number; startOffset: number } => {
  let currentY = 0;
  let startIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    if (currentY + rows[i].height > scrollTop) {
      startIndex = Math.max(0, i - buffer);
      break;
    }
    currentY += rows[i].height;
  }
  let endIndex = rows.length;
  let tempY = 0;
  for (let i = 0; i < rows.length; i++) {
    if (tempY > scrollTop + viewportHeight) {
      endIndex = Math.min(rows.length, i + buffer);
      break;
    }
    tempY += rows[i].height;
  }
  const startOffset = rows.slice(0, startIndex).reduce((acc, r) => acc + r.height, 0);
  return { startIndex, endIndex, startOffset };
};
