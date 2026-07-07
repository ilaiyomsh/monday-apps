import { createContext } from 'react';
import type { Group, ZoomLevel, ViewMode, TaskId, Task, FlatRow, Employee, ProjectClassification, Holiday, ProjectMetrics } from '../../types/gantt.types';
import type { PlannerSettings, EffortDisplayMode } from '../../types/settings.types';
import type { Allocation } from '../../types/entities/allocation.types';
import type { AvailabilityData } from '../../hooks/useAvailability';
import type { DisplayUnit } from '../../hooks/useDisplayUnit';
import type { AllocationsErrorKind } from '../../hooks/useAllocations';

// Filter types
export type TimeframeOption = 'ending_this_week' | 'ending_this_month';
// Empty array = no filter (show all). Otherwise: task must match one of the selected timeframes.
export type TimeframeFilter = TimeframeOption[];
export type UtilizationColor = 'red' | 'yellow' | 'green' | 'blue';
// Empty array = no filter (show all). Otherwise: task must match one of the selected colors.
export type UtilizationFilter = UtilizationColor[];
export type PMFilter = string[]; // Array of manager user IDs
export type ProjectTypeFilter = string[]; // Array of project type labels

// Project filter available options
export interface AvailablePM {
  id: string;
  name: string;
  photoUrl?: string;
}

export interface AvailableProjectType {
  label: string;
  color: string;
}

export interface GanttContextType {
  // Data
  groups: Group[];
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  flattenedRows: FlatRow[];
  totalHeight: number;
  employees: Employee[];
  roles: {id: string, name: string}[];
  settings?: PlannerSettings | null;
  rawAllocations: Allocation[];
  loading: boolean;
  allocationsError: string | null;
  allocationsErrorKind: AllocationsErrorKind | null;
  refreshAllocations: () => Promise<void>;
  
  // View settings
  zoomLevel: ZoomLevel;
  setZoomLevel: (zoom: ZoomLevel) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  effectiveEffortMode: EffortDisplayMode;
  displayUnit: DisplayUnit;
  setDisplayUnit: (unit: DisplayUnit) => void;
  
  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Filters
  timeframeFilter: TimeframeFilter;
  setTimeframeFilter: (filter: TimeframeFilter) => void;
  utilizationFilter: UtilizationFilter;
  setUtilizationFilter: (filter: UtilizationFilter) => void;
  hidePastAllocations: boolean;
  // Rule 3: pure bar-visibility toggle — no fetch side-effect. Past data is
  // always background-loaded; past-fetch progress/error lives on the load circles.
  setHidePastAllocations: (hide: boolean) => void;
  hideProjectsWithoutActiveAllocations: boolean;
  setHideProjectsWithoutActiveAllocations: (hide: boolean) => void;
  // When true: show ONLY active projects (per settings) that have no active allocation.
  // Mutually exclusive with hideProjectsWithoutActiveAllocations (its inverse semantics).
  showOnlyActiveProjectsWithoutAllocations: boolean;
  setShowOnlyActiveProjectsWithoutAllocations: (show: boolean) => void;
  pmFilter: PMFilter;
  setPmFilter: (filter: PMFilter) => void;
  projectTypeFilter: ProjectTypeFilter;
  setProjectTypeFilter: (filter: ProjectTypeFilter) => void;
  availablePMs: AvailablePM[];
  availableProjectTypes: AvailableProjectType[];
  
  // Groups expansion
  expandedGroups: Set<string | number>;
  toggleGroup: (groupId: string | number) => void;

  // Employees view: focus a single employee. When set, the Gantt content for
  // other employees is hidden (sidebar headers remain visible).
  selectedEmployeeId: string | number | null;
  setSelectedEmployeeId: (id: string | number | null) => void;

  // Projects view: focus a single project. When set, the focused project is
  // hoisted to the top of its classification section, every OTHER section is
  // collapsed, other projects in the same section collapse to header-only, and
  // all non-focused rows are dimmed. Mirrors selectedEmployeeId for employees.
  selectedProjectId: string | number | null;
  setSelectedProjectId: (id: string | number | null) => void;

  // Classification section expansion (default: expanded; set membership = collapsed)
  collapsedSections: Set<ProjectClassification>;
  toggleSection: (classification: ProjectClassification) => void;
  
  // Timeline (infinite scroll)
  timelineStart: Date;
  timelineEnd: Date;
  displayDays: Date[];
  totalWidth: number;
  handleTimelineScroll: (scrollLeft: number, clientWidth: number, scrollWidth: number) => void;
  
  // Coordinate conversion
  getXByDate: (date: Date | string) => number;
  getDateByX: (x: number) => Date;
  getWidthByDates: (start: Date | string, end: Date | string) => number;
  pixelsPerDay: number;
  /**
   * Register a drill-down for the next zoom change. After calling this, change
   * the zoom level and the timeline will anchor around `anchor` at
   * `viewportX` (instead of recentering on today).
   */
  requestDrillDown: (req: { anchor: Date; viewportX: number }) => void;


  // Scroll state
  scrollLeft: number;
  setScrollLeft: (scrollLeft: number) => void;
  scrollTop: number;
  setScrollTop: (scrollTop: number) => void;
  containerWidth: number;
  visibleDayRange: { startIndex: number; endIndex: number; offsetLeft: number };
  
  // Sidebar state
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  saveSidebarWidth: (width: number) => void;
  
  // Task operations
  updateTask: (taskId: TaskId, updates: Partial<Task>) => void;
  addAllocation: (task: Omit<Task, 'id'>) => Promise<void>;
  deleteAllocation: (id: TaskId) => void;

  // Undo delete
  pendingDelete: { allocation: Allocation; name: string } | null;
  undoDelete: () => void;

  // Toast notifications
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;

  // Modal operations
  openModal: (data?: Partial<Task>) => void;
  openBulkModal: (projectId: string, projectName: string) => void;

  // PM bulk update
  bulkUpdateAllocationPM: (projectId: string, newManagerId: string) => Promise<void>;

  // Local project data patch (no network) — updates the cached column values
  // for a single project so the Gantt header re-derives correctly after edits.
  patchProjectData: (projectId: string, patch: Record<string, any>) => void;

  // Container ref for scroll adjustment
  containerRef: React.RefObject<HTMLDivElement | null>;

  // Force-shown projects (projects without allocations made visible)
  // Map of projectId → projectName so the name is preserved through optimistic flows
  forceShownProjects: Map<string, string>;
  addForceShownProject: (projectId: string, projectName: string) => void;

  // True while the absence/time-report board is still being fetched. Surfaced
  // as a tiny inline indicator because the data lands after the initial
  // Gantt render and visibly pops the availability circles.
  absencesLoading: boolean;

  // Availability tab data
  availability: AvailabilityData;
  holidaysByDate: Map<string, Holiday>;

  // Per-project hour metrics keyed by project id (planned / allocated /
  // reported). Allocated + reported are summed server-side via aggregates and
  // arrive after first paint; planned comes from project metadata. The project
  // card renders all three together only when `projectMetricsReady` is true.
  projectMetrics: Map<string, ProjectMetrics>;
  projectMetricsReady: boolean;
}

export const GanttContext = createContext<GanttContextType | undefined>(undefined);
