import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlannerSettings } from '../types/settings.types';
import { extractStatusLabels } from '../utils/statusLabelUtils';

/**
 * Live columns of the configured Day-off vacations board (DAY-OFF-INTEGRATION
 * W3.7). Supplied by the settings dialog from its column fetch so the
 * validator can check column existence and label-ID resolvability against the
 * REAL board, not just field non-emptiness.
 */
export interface DayOffLiveBoard {
  /**
   * The board these columns were fetched from. Live checks run only when this
   * matches `settings.dayOffBoardId` — guards against the board-switch race
   * where the columns of the previous board are still in state.
   */
  boardId: string;
  /**
   * The board's columns (`id`/`type`/`settings`). An EMPTY array means the
   * board could not be read (deleted or inaccessible) — a real board always
   * returns at least its Name column.
   */
  columns: Array<{ id: string; type: string; settings?: string }>;
}

interface ValidationContext {
  boardId?: string;
  /**
   * Live Day-off board data for the W3.7 existence/resolvability checks.
   * `undefined` ⇒ not loaded (yet) — live checks are skipped and only the
   * requiredness rules run, so a transient fetch failure never produces
   * false "deleted column" errors.
   */
  dayOffLive?: DayOffLiveBoard;
}

/**
 * The dayOff* column-mapping fields checked for deleted-column refs. Optional
 * mappings (type, mandatory, approval under D2-OFF) are included: a CONFIGURED
 * value pointing at a deleted column is misconfiguration and must fail loudly
 * (CONTRACT.md §5.6) even when the field itself is not required.
 */
const DAY_OFF_COLUMN_FIELDS = [
  'dayOffEmployeeColumnId',
  'dayOffStartDateColumnId',
  'dayOffEndDateColumnId',
  'dayOffKindColumnId',
  'dayOffTypeColumnId',
  'dayOffMandatoryColumnId',
  'dayOffApprovalColumnId',
] as const;

/**
 * Hook ל-validation של הגדרות
 */
export const useSettingsValidation = (
  settings: PlannerSettings,
  context?: ValidationContext
) => {
  const { t } = useTranslation();
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};

    // בדיקת לוח הקצאות
    if (!settings.allocationsBoardId) {
      errs.allocationsBoardId = t('settings.validation.allocationsBoard');
    } else {
      if (!settings.startDateColumnId) {
        errs.startDateColumnId = t('settings.validation.startDate');
      }
      if (!settings.endDateColumnId) {
        errs.endDateColumnId = t('settings.validation.endDate');
      }
      if (!settings.hoursPerDayColumnId) {
        errs.hoursPerDayColumnId = t('settings.validation.hoursPerDay');
      }
      if (!settings.projectColumnId) {
        errs.projectColumnId = t('settings.validation.project');
      }
      if (!settings.employeeColumnId) {
        errs.employeeColumnId = t('settings.validation.employee');
      }
      if (!settings.roleColumnId) {
        errs.roleColumnId = t('settings.validation.role');
      }
    }

    // בדיקת לוח עובדים
    if (!settings.employeesBoardId) {
      errs.employeesBoardId = t('settings.validation.employeesBoard');
    } else {
      if (!settings.employeeNameColumnId) {
        errs.employeeNameColumnId = t('settings.validation.employeeName');
      }
      if (!settings.employeeRoleColumnId) {
        errs.employeeRoleColumnId = t('settings.validation.employeeRole');
      }
      if (!settings.employeeAllocationPercentColumnId) {
        errs.employeeAllocationPercentColumnId = t('settings.validation.employeeFte');
      }
      if (!settings.employeeUserIdColumnId) {
        errs.employeeUserIdColumnId = t('settings.validation.employeeUser');
      }
      if (settings.filterInactiveEmployees) {
        if (!settings.employeeStatusColumnId) {
          errs.employeeStatusColumnId = t('settings.validation.employeeStatusColumn');
        }
        if (!settings.activeEmployeeStatusValues || settings.activeEmployeeStatusValues.length === 0) {
          errs.activeEmployeeStatusValues = t('settings.validation.activeEmployeeStatusValue');
        }
      }
    }

    // בדיקת לוח פרויקטים (אופציונלי לסינון)
    if (settings.filterActiveProjects) {
      if (!settings.projectsBoardId) {
        errs.projectsBoardId = t('settings.validation.projectsBoardForFilter');
      }
      if (!settings.projectStatusColumnId) {
        errs.projectStatusColumnId = t('settings.validation.projectStatus');
      }
      if (!settings.activeProjectStatusValues || settings.activeProjectStatusValues.length === 0) {
        errs.activeProjectStatusValues = t('settings.validation.activeStatusValue');
      }
    }

    // בדיקת סיווג פנימי/חיצוני
    if (settings.enableProjectClassification) {
      if (!settings.projectsBoardId) {
        errs.projectsBoardId = t('settings.validation.projectsBoardForClassification');
      }
      if (!settings.projectClassificationColumnId) {
        errs.projectClassificationColumnId = t('settings.validation.classificationColumn');
      }
      const hasInternal = (settings.internalProjectStatusValues?.length ?? 0) > 0;
      const hasExternal = (settings.externalProjectStatusValues?.length ?? 0) > 0;
      if (!hasInternal && !hasExternal) {
        errs.projectClassificationValues = t('settings.validation.classificationLabels');
      }
    }

    // DAY-OFF-INTEGRATION W3.7 — fail-loud validation for the dayOff*
    // vacations-board mapping (../Day-off/CONTRACT.md §5.6: a half-configured
    // mapping must produce a visible error, never a silent empty read).
    // Everything here fires ONLY when a Day-off source is configured
    // (dayOffBoardId non-empty); the legacy absence* source keeps its
    // pre-existing behavior (no validation) and unconfigured settings stay
    // silent, so defaults preserve current behavior.
    if (settings.dayOffBoardId) {
      // Identity join (CONTRACT.md §5.3): without the Employees-board user
      // column, Employee.id falls back to the board item ID and every
      // people-keyed join — including Day-off absences — silently misses.
      if (!settings.employeeUserIdColumnId) {
        errs.dayOffIdentityJoin = t('settings.validation.dayoff.identityJoin');
      }

      // Requiredness — mirrors the runtime fail-loud gates
      // (useEmployeeAbsences/useHolidays `dayoff_misconfigured`: employee +
      // start + end, approval pair iff the D2 toggle is ON) plus the kind
      // mapping (CONTRACT.md §5.4: kind routing is mandatory; matching the
      // W3.6 completeness checkmark).
      if (!settings.dayOffEmployeeColumnId) {
        errs.dayOffEmployeeColumnId = t('settings.validation.dayoff.employeeColumn');
      }
      if (!settings.dayOffStartDateColumnId) {
        errs.dayOffStartDateColumnId = t('settings.validation.dayoff.startDateColumn');
      }
      if (!settings.dayOffEndDateColumnId) {
        errs.dayOffEndDateColumnId = t('settings.validation.dayoff.endDateColumn');
      }
      if (!settings.dayOffKindColumnId) {
        errs.dayOffKindColumnId = t('settings.validation.dayoff.kindColumn');
      } else {
        if (!settings.dayOffKindGeneralLabelId) {
          errs.dayOffKindGeneralLabelId = t('settings.validation.dayoff.generalLabel');
        }
        if (!settings.dayOffKindPersonalLabelId) {
          errs.dayOffKindPersonalLabelId = t('settings.validation.dayoff.personalLabel');
        }
      }
      // Approval mapping — required iff the D2 policy toggle is ON (decision
      // D2 / W3.5 note: never required while OFF).
      if (settings.dayOffApprovalRequired === true) {
        if (!settings.dayOffApprovalColumnId) {
          errs.dayOffApprovalColumnId = t('settings.validation.dayoff.approvalColumn');
        }
        if ((settings.dayOffApprovedLabelIds?.length ?? 0) === 0) {
          errs.dayOffApprovedLabelIds = t('settings.validation.dayoff.approvedLabels');
        }
      }

      // DEV-2: rejected labels are meaningful only against a mapped approval
      // column — a rejected set without the column cannot be evaluated.
      if ((settings.dayOffRejectedLabelIds?.length ?? 0) > 0 && !settings.dayOffApprovalColumnId) {
        errs.dayOffRejectedLabelIds = t('settings.validation.dayoff.rejectedNeedsColumn');
      }

      // Live checks — board existence, deleted-column refs, label-ID
      // resolvability against the live column `settings` labels (org
      // standard: stable label IDs via `settings`, never `settings_str`).
      const live = context?.dayOffLive;
      if (live && live.boardId === settings.dayOffBoardId) {
        if (live.columns.length === 0) {
          errs.dayOffBoardId = t('settings.validation.dayoff.boardNotFound');
        } else {
          const colById = new Map(live.columns.map((c) => [c.id, c]));
          for (const field of DAY_OFF_COLUMN_FIELDS) {
            const colId = settings[field];
            if (colId && !colById.has(colId)) {
              errs[field] = t('settings.validation.dayoff.columnMissing');
            }
          }

          // Label resolvability — skipped when the column itself is missing
          // (its own error already fired). A column that exists but is no
          // longer a status column yields no labels, so configured IDs fail
          // to resolve — import/type drift is caught the same way.
          const kindCol = settings.dayOffKindColumnId
            ? colById.get(settings.dayOffKindColumnId)
            : undefined;
          if (kindCol) {
            const kindLabelIds = new Set(extractStatusLabels(kindCol).map((l) => l.id));
            if (settings.dayOffKindGeneralLabelId && !kindLabelIds.has(settings.dayOffKindGeneralLabelId)) {
              errs.dayOffKindGeneralLabelId = t('settings.validation.dayoff.labelMissing');
            }
            if (settings.dayOffKindPersonalLabelId && !kindLabelIds.has(settings.dayOffKindPersonalLabelId)) {
              errs.dayOffKindPersonalLabelId = t('settings.validation.dayoff.labelMissing');
            }
          }
          const approvalCol = settings.dayOffApprovalColumnId
            ? colById.get(settings.dayOffApprovalColumnId)
            : undefined;
          const approvedIds = settings.dayOffApprovedLabelIds ?? [];
          if (approvalCol && approvedIds.length > 0) {
            const approvalLabelIds = new Set(extractStatusLabels(approvalCol).map((l) => l.id));
            if (approvedIds.some((id) => !approvalLabelIds.has(id))) {
              errs.dayOffApprovedLabelIds = t('settings.validation.dayoff.approvedLabelsMissing');
            }
          }
        }
      }
    }

    // בדיקת שעות עבודה
    if (settings.workDayStart && settings.workDayEnd) {
      const [startHours, startMinutes] = settings.workDayStart.split(':').map(Number);
      const [endHours, endMinutes] = settings.workDayEnd.split(':').map(Number);
      const startTime = startHours * 60 + startMinutes;
      const endTime = endHours * 60 + endMinutes;

      if (startTime >= endTime) {
        errs.workHours = t('settings.validation.workHours');
      }
    }

    return errs;
  }, [settings, context, t]);

  const isValid = Object.keys(errors).length === 0;

  const getFieldError = (fieldName: string): string | null => {
    return errors[fieldName] || null;
  };

  return {
    errors,
    isValid,
    getFieldError
  };
};
