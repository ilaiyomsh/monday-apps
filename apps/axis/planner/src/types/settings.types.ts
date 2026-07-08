export type EffortDisplayMode = 'hours_day' | 'hours_week' | 'days_month' | 'fte' | 'total_hours';

export type PlannerSettings = {
  // לוח הקצאות (הלוח הנוכחי)
  allocationsBoardId: string;
  startDateColumnId: string;
  endDateColumnId: string;
  hoursPerDayColumnId: string;
  totalHoursColumnId: string;
  ftePercentageColumnId?: string; // Optional: FTE percentage column (Numbers)
  projectColumnId: string;
  employeeColumnId: string;
  roleColumnId: string;
  reportedHoursColumnId?: string; // Mirror column for actual reported hours
  // #90 perf/unified-load: the board_relation column INSIDE the time-logs board
  // that points back to allocations. Used as the aggregate group-by key for
  // reported hours. Auto-detected at settings time from the reportedHours mirror's
  // logs board (default-first when ambiguous, switchable), with one-time migration.
  // Not derivable from the allocations-side column settings — must be persisted.
  timeLogsAllocationColumnId?: string;
  allocationCostColumnId?: string; // Cost per allocation item
  allocationManagerColumnId?: string; // People column for project manager on each allocation
  allocationClientColumnId?: string; // Board relation column for client on each allocation

  // לוח עובדים (חיצוני)
  employeesBoardId: string;
  employeeNameColumnId: string;
  employeeRoleColumnId: string;
  employeeAllocationPercentColumnId: string;
  employeeCostColumnId: string;
  employeeUserIdColumnId: string;
  capabilitiesColumnId?: string; // Dropdown column with employee capabilities

  // Active employees filter (optional)
  filterInactiveEmployees?: boolean;
  employeeStatusColumnId?: string;
  activeEmployeeStatusValues?: string[]; // label IDs (not text) — see [[feedback_status_id_match]]

  // Allocation capability column (dropdown) - stores which capability is used per allocation
  allocationCapabilityColumnId?: string;

  // לוח פרויקטים (חיצוני) - אופציונלי
  projectsBoardId?: string;
  projectNameColumnId?: string;
  filterActiveProjects?: boolean;
  projectStatusColumnId?: string;
  activeProjectStatusValues?: string[];

  // Day-off vacations board (external) — optional absence source per the frozen
  // consumer contract `Day-off/CONTRACT.md` (DAY-OFF-INTEGRATION plan §4, W3.1).
  // The new path is entirely OFF while `dayOffBoardId` is empty (legacy behavior).
  // All label fields hold stable monday LABEL IDs read via the column `settings`
  // field — never label text, never `settings_str`.
  dayOffBoardId?: string;                  // the vacations board
  dayOffEmployeeColumnId?: string;         // people column — monday user ID (identity join)
  dayOffStartDateColumnId?: string;        // date column — inclusive range start
  dayOffEndDateColumnId?: string;          // date column — inclusive range end
  dayOffKindColumnId?: string;             // status — personal/general discriminator
  dayOffKindGeneralLabelId?: string;       // label ID meaning "general" (company day)
  dayOffKindPersonalLabelId?: string;      // label ID meaning "personal" (absence request)
  dayOffTypeColumnId?: string;             // status — personal absence type (open label set, D1)
  // Checkbox on GENERAL entries (contract §4): true ⇒ office closed ⇒ blocking
  // holiday (zeroes everyone, excluded from role denominators); false/empty ⇒
  // display-only. An UNMAPPED mandatory column reads as false for every item
  // (contract-mandated Day-off behavior), i.e. all general days display-only.
  dayOffMandatoryColumnId?: string;        // checkbox — mandatory (W3.4)
  // Approval policy (decision D2, AMENDED 2026-06-10 / DEV-2): when true, only
  // items whose approval label ID is in `dayOffApprovedLabelIds` reduce
  // capacity; when false, all personal items count EXCEPT rejected ones —
  // rejected items are excluded REGARDLESS of the toggle (they stay visible
  // only inside Day-off). Approval column + approved set are required only
  // when the toggle is ON (W3.7); the rejected mapping is optional but without
  // it rejected items cannot be excluded (documented degradation,
  // CONTRACT.md §5.2).
  dayOffApprovalRequired?: boolean;
  dayOffApprovalColumnId?: string;         // status — approval lifecycle column
  dayOffApprovedLabelIds?: string[];       // label IDs counted as approved
  dayOffRejectedLabelIds?: string[];       // label IDs excluded ALWAYS (DEV-2)

  // סיווג פנימי/חיצוני (אופציונלי) — בוקטינג תצוגתי לפי עמודת סטטוס בלוח הפרויקטים
  enableProjectClassification?: boolean;
  projectClassificationColumnId?: string;
  internalProjectStatusValues?: string[]; // label texts mapped to "internal"
  externalProjectStatusValues?: string[]; // label texts mapped to "external"
  
  // נתוני פרויקט נוספים (אופציונלי)
  projectManagerColumnId?: string;
  projectTypeColumnId?: string; // Status column for project type
  clientColumnId?: string; // Board relation column linking to clients board
  // Planned hours per project — a Numbers column on the projects board, read as
  // project metadata (joined by id). Powers the "planned hours" metric on the
  // project card. Distinct from allocated/reported hours, which are summed
  // server-side via aggregates (see useProjectMetrics).
  projectPlannedHoursColumnId?: string;
  // The board_relation column INSIDE the time-logs board that points to the
  // projects board — the group-by key for the reported-hours-per-project
  // aggregate. Optional override: when empty it is auto-detected from the logs
  // board columns (mondayService.resolveLogsProjectColumnId), mirroring how
  // timeLogsAllocationColumnId is auto-detected for the per-allocation aggregate.
  timeLogsProjectColumnId?: string;

  // הגדרות נוספות
  workDayStart: string;
  workDayEnd: string;

  // הגדרות תצוגה
  defaultZoomLevel?: 'day' | 'week' | 'month' | 'quarter';

  // שפת ממשק (override על currentLanguage שמגיע מ-Monday context).
  // null/undefined ⇒ Auto (לפי Monday context). 'he'/'en' ⇒ override מפורש.
  // hidden behind VITE_ENABLE_LANGUAGE_PICKER until Increment 9.
  languageOverride?: 'he' | 'en' | null;

  // הגדרות תצוגת מאמץ
  effortDisplayMode: EffortDisplayMode;
  maxHoursPerDay: number;
  maxHoursPerWeek: number;
  maxHoursPerMonth: number;
  workDays: number[];
}

export const SETTINGS_MODULE = true;
