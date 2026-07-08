import { useMemo } from 'react';
import { FIELD_MODES, TOGGLE_MODES, DEFAULT_FIELD_CONFIG } from '../../contexts/SettingsContext';
import { hasValidReportingBoard } from '../../utils/boardIdResolver';
import { smartValidateMapping } from '../../utils/eventTypeMapping';
import { validateApprovalMapping } from '../../utils/approvalMapping';

/**
 * חישוב אובייקט שגיאות (ניתן לשימוש מחוץ ל-React, למשל ב-App)
 */
export const computeSettingsErrors = (settings, context) => {
  const fieldConfig = settings.fieldConfig || DEFAULT_FIELD_CONFIG;

  const hasTasks = fieldConfig.task !== FIELD_MODES.HIDDEN;
  const hasStage = fieldConfig.stage !== FIELD_MODES.HIDDEN;
  const hasNonBillableType = fieldConfig.billableToggle === TOGGLE_MODES.VISIBLE &&
    fieldConfig.nonBillableType !== FIELD_MODES.HIDDEN;

  const hasReportingBoard = hasValidReportingBoard(settings, context);
  const isPortfolio = settings.projectsSourceMode === 'portfolio';

  const errors = {};

    // --- שדות חובה תמיד ---

    // לוח פרויקטים - חובה רק אם לא במצב הקצאות
    if (!settings.useAssignmentsMode) {
      if (!settings.connectedBoardId) {
        errors.connectedBoardId = isPortfolio ? 'יש לבחור לוח פורטפוליו' : 'יש לבחור לוח פרויקטים';
      }
      // במצב Portfolio: peopleColumnIds נופל אוטומטית ל-portfolio_project_owner —
      // לא מחייבים בחירה ידנית. במצב board נשמרת ההתנהגות הקיימת.
      if (!isPortfolio && settings.connectedBoardId &&
          (!settings.peopleColumnIds || settings.peopleColumnIds.length === 0)) {
        errors.peopleColumnIds = 'יש לבחור לפחות עמודת אנשים אחת';
      }
    }

    // לוח דיווחים - בדיקה לפי ההגדרות החדשות
    if (!hasReportingBoard) {
      // אם הטוגל פעיל אבל אין context.boardId
      if (settings.useCurrentBoardForReporting && !context?.boardId) {
        errors.currentBoard = 'האפליקציה רצה כ-Custom Object - יש לבחור לוח דיווחים או לפתוח מתוך לוח';
      }
      // אם הטוגל כבוי ואין לוח דיווחים נבחר
      else if (!settings.useCurrentBoardForReporting && !settings.timeReportingBoardId) {
        errors.timeReportingBoardId = 'יש לבחור לוח דיווחי שעות';
      }
      // אם אין לוח בכלל
      else {
        errors.currentBoard = 'לא נמצא לוח דיווחים - יש לבחור לוח או לפתוח את האפליקציה מתוך לוח';
      }
    } else {
      // עמודות לוח הדיווחים - חובה רק אם יש לוח
      if (!settings.projectColumnId) {
        errors.projectColumnId = 'יש לבחור עמודת קישור לפרויקט';
      }
      if (!settings.dateColumnId) {
        errors.dateColumnId = 'יש לבחור עמודת תאריך התחלה';
      }
      if (!settings.endTimeColumnId) {
        errors.endTimeColumnId = 'יש לבחור עמודת תאריך סיום';
      }
      if (!settings.durationColumnId) {
        errors.durationColumnId = 'יש לבחור עמודת משך זמן';
      }
      if (!settings.reporterColumnId) {
        errors.reporterColumnId = 'יש לבחור עמודת מדווח';
      }
      if (!settings.eventTypeStatusColumnId) {
        errors.eventTypeStatusColumnId = 'יש לבחור עמודת סוג דיווח';
      }
      if (hasNonBillableType && !settings.nonBillableStatusColumnId) {
        errors.nonBillableStatusColumnId = 'יש לבחור עמודת סוגי לא לחיוב';
      }
      // ולידציה של מיפוי סוגי דיווח
      if (settings.eventTypeStatusColumnId && !settings.eventTypeMapping) {
        errors.eventTypeMapping = 'יש להגדיר מיפוי סוגי דיווח';
      } else if (settings.eventTypeMapping) {
        const enableDistinction = !!settings.enableProjectTypeDistinction;
        const mappingValidation = smartValidateMapping(settings.eventTypeMapping, enableDistinction);
        if (!mappingValidation.isValid) {
          errors.eventTypeMapping = mappingValidation.errors[0];
        }
      }

      // ולידציה של מיפוי סוג פרויקט (כשהבחנה פנימי/חיצוני מופעלת)
      if (settings.enableProjectTypeDistinction) {
        if (!settings.projectTypeColumnId) {
          errors.projectTypeColumnId = 'יש לבחור עמודת סוג פרויקט';
        }
        if (settings.projectTypeColumnId && !settings.projectTypeMapping) {
          errors.projectTypeMapping = 'יש להגדיר מיפוי לייבלים לסוג פרויקט';
        }
      }
    }

    // --- שדות חובה רק במצבי TASKS ---
    // במצב Portfolio: tasksBoardId + tasksProjectColumnId נפתרים אוטומטית
    // (לוח-משימות לפר פרויקט דרך portfolio_project_link).
    if (hasTasks) {
      if (!isPortfolio) {
        if (!settings.useAssignmentsMode && !settings.tasksProjectColumnId) {
          errors.tasksProjectColumnId = 'יש לבחור עמודת משימות בלוח פרויקטים';
        }
        if (settings.tasksProjectColumnId && !settings.tasksBoardId) {
          errors.tasksBoardId = 'יש לבחור לוח משימות';
        }
      }
      // עמודת קישור למשימה בלוח הדיווחים נדרשת בשני המצבים
      if ((settings.tasksBoardId || isPortfolio) && hasReportingBoard && !settings.taskColumnId) {
        errors.taskColumnId = 'יש לבחור עמודת קישור למשימה בלוח הדיווחים';
      }
    }

    // --- שדות חובה רק במצבי STAGE ---
    if (hasStage && hasReportingBoard) {
      if (!settings.stageColumnId) {
        errors.stageColumnId = 'יש לבחור עמודת סיווג';
      }
    }

    // --- בדיקת פילטר סטטוס פרויקטים ---
    if (!settings.useAssignmentsMode && settings.projectStatusFilterEnabled) {
      if (!settings.projectStatusColumnId) {
        errors.projectStatusColumnId = 'יש לבחור עמודת סטטוס בלוח פרויקטים';
      }
      if (!settings.projectActiveStatusValues || settings.projectActiveStatusValues.length === 0) {
        errors.projectActiveStatusValues = 'יש לבחור לפחות ערך סטטוס אחד';
      }
    }

    // --- בדיקת פילטר סטטוס משימות ---
    // במצב Portfolio הפילטר עדיין לא נתמך (אין tasksBoardId יציב), נכבה השגיאה.
    if (hasTasks && !isPortfolio && settings.taskStatusFilterEnabled) {
      if (!settings.taskStatusColumnId) {
        errors.taskStatusColumnId = 'יש לבחור עמודת סטטוס בלוח משימות';
      }
      if (!settings.taskActiveStatusValues || settings.taskActiveStatusValues.length === 0) {
        errors.taskActiveStatusValues = 'יש לבחור לפחות ערך סטטוס אחד';
      }
    }

    // --- בדיקת הקצאות (Assignments) - אם טוגל הקצאות פעיל, כל העמודות חובה ---
    if (settings.useAssignmentsMode) {
      if (!settings.assignmentsBoardId) {
        errors.assignmentsBoardId = 'יש לבחור לוח הקצאות';
      }
      if (settings.assignmentsBoardId) {
        if (!settings.assignmentPersonColumnId) {
          errors.assignmentPersonColumnId = 'יש לבחור עמודת אנשים בלוח הקצאות';
        }
        if (!settings.assignmentStartDateColumnId) {
          errors.assignmentStartDateColumnId = 'יש לבחור עמודת תאריך התחלה בלוח הקצאות';
        }
        if (!settings.assignmentEndDateColumnId) {
          errors.assignmentEndDateColumnId = 'יש לבחור עמודת תאריך סיום בלוח הקצאות';
        }
        if (!settings.assignmentProjectLinkColumnId) {
          errors.assignmentProjectLinkColumnId = 'יש לבחור עמודת קישור לפרויקט בלוח הקצאות';
        }
        // עמודת קישור להקצאה בלוח הדיווחים
        if (hasReportingBoard && !settings.assignmentColumnId) {
          errors.assignmentColumnId = 'יש לבחור עמודת קישור להקצאה בלוח הדיווחים';
        }
      }
    }

    // --- בדיקת אישור מנהל ---
    if (settings.enableApproval) {
      if (!settings.approvalStatusColumnId) {
        errors.approvalStatusColumnId = 'יש לבחור עמודת סטטוס אישור';
      }
      if (settings.approvalStatusColumnId && !settings.approvalStatusMapping) {
        errors.approvalStatusMapping = 'יש להגדיר מיפוי סטטוס אישור';
      } else if (settings.approvalStatusMapping) {
        const approvalMappingValidation = validateApprovalMapping(settings.approvalStatusMapping);
        if (!approvalMappingValidation.isValid) {
          errors.approvalStatusMapping = approvalMappingValidation.errors[0];
        }
      }
    }

  // --- מקור היעדרויות Day-off (W4.5) ---
  // מיפוי לוח החופשות חובה רק כשהמקור הוא 'dayoff' (D9 — מיפוי ידני; כשהמקור 'tracker'
  // מותר למפות מראש באופן חלקי לקראת המעבר, בלי לחסום שמירה).
  if (settings.absenceSource === 'dayoff') {
    if (!settings.dayOffBoardId) {
      errors.dayOffBoardId = 'יש לבחור את לוח החופשות (Day-off)';
    }
    if (settings.dayOffBoardId) {
      if (!settings.dayOffPersonColumnId) {
        errors.dayOffPersonColumnId = 'יש לבחור עמודת עובד בלוח החופשות';
      }
      if (!settings.dayOffStartDateColumnId) {
        errors.dayOffStartDateColumnId = 'יש לבחור עמודת תאריך התחלה בלוח החופשות';
      }
      if (!settings.dayOffEndDateColumnId) {
        errors.dayOffEndDateColumnId = 'יש לבחור עמודת תאריך סיום בלוח החופשות';
      }
      if (!settings.dayOffKindColumnId) {
        errors.dayOffKindColumnId = 'יש לבחור עמודת סוג רשומה (אישי/כללי) בלוח החופשות';
      }
      if (settings.dayOffKindColumnId &&
          (!settings.dayOffKindGeneralLabelId || !settings.dayOffKindPersonalLabelId)) {
        errors.dayOffKindLabels = 'יש לבחור את תוויות "כללי" ו"אישי" בעמודת סוג הרשומה';
      }
      if (!settings.dayOffTypeColumnId) {
        errors.dayOffTypeColumnId = 'יש לבחור עמודת סוג היעדרות בלוח החופשות';
      }
    }
    // מדיניות אישור (D2): כשפעילה — עמודת האישור ומיפויי התוויות חובה
    if (settings.dayOffApprovalRequired) {
      if (!settings.dayOffApprovalColumnId) {
        errors.dayOffApprovalColumnId = 'יש לבחור עמודת סטטוס אישור בלוח החופשות';
      }
      if (settings.dayOffApprovalColumnId) {
        if (!settings.dayOffApprovedLabelIds || settings.dayOffApprovedLabelIds.length === 0) {
          errors.dayOffApprovedLabelIds = 'יש לבחור לפחות תווית "מאושר" אחת';
        }
        if (!settings.dayOffPendingLabelIds || settings.dayOffPendingLabelIds.length === 0) {
          errors.dayOffPendingLabelIds = 'יש לבחור לפחות תווית "ממתין לאישור" אחת';
        }
      }
    }
  }

  // --- ולידציה XOR מתקדמת ---
  const advancedValidation = settings.advancedValidation || { enabled: false, xorFields: [null, null] };
  if (advancedValidation.enabled) {
    const [a, b] = advancedValidation.xorFields || [null, null];
    if (!a || !b) {
      errors.xorConfiguration = 'יש לבחור שני שדות לבחירה הדדית (או־או)';
    } else if (a === b) {
      errors.xorConfiguration = 'יש לבחור שני שדות שונים';
    }
  }

  return errors;
};

/**
 * Hook ל-validation של הגדרות
 * @param {Object} settings - ההגדרות הנוכחיות
 * @param {Object} context - ה-context של Monday
 * @returns {Object} { errors, isValid, getFieldError, getMissingFieldsMessage }
 */
export const useSettingsValidation = (settings, context) => {
  const errors = useMemo(
    () => computeSettingsErrors(settings, context),
    [settings, context]
  );

  const isValid = Object.keys(errors).length === 0;

  const getFieldError = (fieldName) => {
    return errors[fieldName] || null;
  };

  const getMissingFieldsMessage = () => {
    const errorCount = Object.keys(errors).length;
    if (errorCount === 0) return null;

    return `יש ${errorCount} שדות חסרים`;
  };

  return {
    errors,
    isValid,
    getFieldError,
    getMissingFieldsMessage
  };
};
