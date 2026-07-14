import { Allocation } from './entities/allocation.types';
import { Employee as EntityEmployee } from './entities/employee.types';

export type TaskId = string | number;
export type GroupId = string | number;

// Task represents the UI view of an allocation
export interface Task extends Allocation {
  name: string; // usually the role or project name
  progress?: number;
  resourceId?: string;
  color?: string;
  userInitials?: string;
  userPhotoUrl?: string; // User profile photo URL
  groupId?: GroupId;
  allocation?: number; // Allocation percentage (0-100)
  _duplicateSource?: boolean; // Flag to trigger duplicate choice flow in modal
}

export type Employee = EntityEmployee;

export interface ProjectSummary {
  totalPlannedHours: number;
  totalReportedHours: number; // Actual hours from mirror column
  totalCost: number;         // Sum of allocation costs
  costPerHour: number;       // totalCost / totalPlannedHours
  managerName?: string;
  managerPhotoUrl?: string;  // for Avatar
  projectType?: string;      // Status label from project type column
  projectTypeColor?: string; // Color of the status label
  currency: string;          // e.g., '₪'
}

// Per-project hour metrics shown on the project card. `planned` comes from a
// projects-board number column (project metadata); `allocated` and `reported`
// are summed server-side across ALL allocations / time logs via aggregates
// (useProjectMetrics) — independent of the windowed in-memory allocation load.
// `planned` is null when the column is unmapped or empty.
export interface ProjectMetrics {
  planned: number | null;
  allocated: number;
  reported: number;
}

export type ProjectClassification = 'external' | 'internal' | 'other';

export interface Group {
  id: GroupId;
  name: string;
  tasks: Task[];
  isExpanded?: boolean;
  color?: string;
  projectSummary?: ProjectSummary;
  classification?: ProjectClassification;
  // True when the project is NOT in the active set (Rule 4). Stamped by the
  // flattener via an id-join against activeProjectIds; drives DIMMED bars when
  // "show past" is ON. Visual-only — never affects load calc.
  isInactiveProject?: boolean;
}

// Row Types for virtualization
export type RowType = 'GROUP' | 'TRACK' | 'SUMMARY' | 'LOAD' | 'EMPLOYEE_LOAD' | 'SECTION' | 'SEPARATOR';

// Base FlatRow interface
export interface BaseFlatRow {
  id: string;
  type: RowType;
  height: number;
  // Projects focus mode: when a project is focused, every row that is not the
  // focused project (incl. company-load, section headers, other projects) is
  // rendered at reduced opacity. Set by the flattener; applied by VirtualRowList.
  dimmed?: boolean;
  // Projects focus mode: marks the top edge (focused project's header) and the
  // bottom edge (its last track) so VirtualRowList can draw a soft shadow around
  // the focused block. Set by the flattener.
  focusEdge?: 'top' | 'bottom';
  // Projects focus mode: true for EVERY row of the focused project (header +
  // tracks + summary). VirtualRowList lifts the whole block uniformly (a small
  // translateY) so it floats like a hovered allocation bar. Set by the flattener.
  focusBlock?: boolean;
  // Neutral separator space (px) reserved at the top / bottom of the row and
  // rendered as page-background by VirtualRowList (via inner padding, so the
  // sticky sidebar stays opaque). Already INCLUDED in `height`. Used to open the
  // summary↔tracks gap and the gap around the focused block. Set by the flattener.
  gapTop?: number;
  gapBottom?: number;
}

// Group Header Row
export interface GroupHeaderRow extends BaseFlatRow {
  type: 'GROUP';
  data: Group;
  isExpanded: boolean;
}

// Track Row - contains multiple tasks that don't overlap
export interface TrackRow extends BaseFlatRow {
  type: 'TRACK';
  groupId: GroupId;
  items: Task[];
  trackIndex: number;
  // Forwarded from the owning group so TaskBar can DIM the bars of an
  // inactive project when "show past" is ON (Rule 4). Visual-only.
  isInactiveProject?: boolean;
}

// תקן תפקיד - סכום שעות יומיות של כל העובדים בתפקיד
export interface RoleCapacity {
  role: string;
  totalDailyHours: number; // סה"כ שעות יומיות (לפי אחוז משרה * 8)
  employeeCount: number;
}

// עומס יומי לתפקיד
export interface DailyLoad {
  date: string; // ISO date string או מפתח תקופה (yyyy-MM-dd / yyyy-ww / yyyy-MM)
  periodStart: string; // תאריך התחלה של התקופה
  periodEnd: string; // תאריך סיום של התקופה
  allocatedHours: number; // סכום שעות מוקצות בתקופה
  availableHours: number; // סה"כ שעות פנויות בתקופה (לא ממוצע!)
  utilizationPercent: number;
  daysInPeriod: number; // מספר ימים בתקופה (לחישוב ממוצע)
}

// שורת עומס לתפקיד
export interface LoadRow extends BaseFlatRow {
  type: 'LOAD';
  role: string;
  capacity: RoleCapacity;
  dailyLoads: Map<string, number>; // key = yyyy-MM-dd, value = allocated hours
  // 'summary' renders the company-wide average row at the top of the company
  // load group: chevron + group title in the sidebar, expanding into per-role
  // rows below. Default (undefined) renders a per-role row.
  variant?: 'summary';
  // When provided, aggregateLoad reads per-day capacity from this RoleAvailability
  // instead of looking it up by role in the GanttContext. Used for the
  // company-total LOAD row whose availability is a synthesized sum across roles.
  totalAvailability?: RoleAvailability;
  // Summary-row metadata: title shown in the sidebar, group id for chevron
  // toggling, and current expanded state.
  summary?: {
    title: string;
    groupId: string;
    isExpanded: boolean;
    totalEmployees: number;
  };
  // Rule 6/7: PER-PERIOD skeleton/error gate. A circle is gated only when ITS OWN
  // period's data isn't ready yet — visible current/future circles (period >=
  // today) render immediately; only periods older than the loaded-back bound wait
  // for the background past window. See LoadGate.
  loadGate?: LoadGate;
}

// Per-period skeleton/error gate for the load circles. Each circle decides its
// own state from its periodStart vs settledFromTs — NOT a global flag (a global
// flag greys the whole row, incl. visible periods, while only off-screen past
// periods are actually pending).
export interface LoadGate {
  // ms epoch. A period STARTING before this isn't fully covered by loaded
  // allocations yet (the critical fetch only covers endDate>=today; older
  // allocations arrive with the background past window).
  settledFromTs: number;
  // A past window is in flight/idle → periods before settledFromTs skeleton.
  pastPending: boolean;
  // The last past window failed → periods before settledFromTs show error+retry.
  pastError: boolean;
  // Retry the failed past window.
  onRetry: () => void;
}

// Section header — used to bucket project groups by classification
export interface SectionHeaderRow extends BaseFlatRow {
  type: 'SECTION';
  classification: ProjectClassification;
  label: string;
  isExpanded: boolean;
  count: number;
  accentColor?: string; // resolved from the status column's label color
}

// Per-day availability for a single employee
export interface AvailabilityDayInfo {
  hours: number;
  dayFactor: 0 | 0.5 | 1;
  reason: 'workday' | 'halfDay' | 'holiday' | 'weekend' | 'absence';
  holidayKey?: string;
  /**
   * Set when an informational (non-blocking) holiday falls on a workday so the
   * tooltip can still surface the name. Distinct from `holidayKey` which only
   * exists when the day is fully blocked.
   */
  informationalHolidayKey?: string;
  absenceClassification?: string;
}

export interface EmployeeAvailability {
  employeeId: string;
  byDate: Map<string, AvailabilityDayInfo>;
}

export interface RoleAvailabilityDay {
  hours: number;
  capacity: number;
  availableEmployees: number;
  totalEmployees: number;
  /**
   * Per-role-day reason mirrors the per-employee reason for non-employee-specific
   * states (weekend, holiday). For absences (which are personal), this stays as
   * 'workday' even when individual employees are out.
   */
  reason: 'workday' | 'halfDay' | 'holiday' | 'weekend';
  holidayKey?: string;
  informationalHolidayKey?: string;
}

export interface RoleAvailability {
  role: string;
  totalEmployees: number;
  byDate: Map<string, RoleAvailabilityDay>;
}

// The single per-employee row in the Employees tab: an always-visible header
// (name + FTE + chevron) whose circles show the employee's PLANNED LOAD
// (allocated hours ÷ availability). Expanding it reveals the allocation tracks.
export interface EmployeeLoadRowData extends BaseFlatRow {
  type: 'EMPLOYEE_LOAD';
  employee: Employee;
  role: string;
  // Daily capacity in hours (already adjusted for FTE %)
  dailyCapacity: number;
  // Map<dateKey 'yyyy-MM-dd', hoursAllocatedThatDay>
  dailyLoads: Map<string, number>;
  // Header identity: the chevron toggles the allocation tracks below.
  expandable?: boolean;
  isExpanded?: boolean;
  groupId?: string | number;
  // Rule 6/7 parity with the projects-view company row: PER-PERIOD skeleton +
  // error/retry on the per-employee load circles (see LoadGate).
  loadGate?: LoadGate;
}

export interface SeparatorRowData extends BaseFlatRow {
  type: 'SEPARATOR';
  // Optional id to keep the row stable across renders.
}

// Union type for all row types
export type FlatRow =
  | GroupHeaderRow
  | TrackRow
  | LoadRow
  | SectionHeaderRow
  | EmployeeLoadRowData
  | SeparatorRowData;

// Timeline State for infinite scroll
export interface TimelineState {
  timelineStart: Date;
  timelineEnd: Date;
}

// Zoom configuration
export type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

// View mode configuration
export type ViewMode = 'projects' | 'employees';

// Header level configuration
export interface HeaderLevel {
  key: string;
  label: string;
  width: number;
}

// Gantt State
export interface GanttState {
  startDate: Date;
  endDate: Date;
  zoomLevel: ZoomLevel;
  pixelsPerDay: number;
}

// Scroll position state
export interface ScrollState {
  scrollTop: number;
  scrollLeft: number;
}

// Virtualization range
export interface VirtualRange {
  startIndex: number;
  endIndex: number;
  startOffset: number;
}

export interface WorkloadEntry {
  key: string;        // 'yyyy-MM-dd' or 'yyyy-ww'
  hours: number;      // Total hours
  status: 'light' | 'normal' | 'overload';
}

export type WorkloadMap = Map<string, WorkloadEntry>;

// Re-exporting entities for convenience
export * from './entities/role.types';
export * from './entities/project.types';
export * from './entities/allocation.types';
export * from './entities/employee.types';
export * from './entities/holiday.types';
