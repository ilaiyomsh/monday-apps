import React, { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react';
import { resolveInstanceId, withTimeout, ATTEMPT_TIMEOUT_MS } from '@axis/app-core';
import logger from '../utils/logger';
import { recordReload } from '../utils/reloadDiag'; // ⚠️ TEMP diagnostic (#103) — להסיר אחרי איתור השורש
import { isLegacyMapping } from '../utils/eventTypeMapping';
import { handleGlobalError } from '../utils/globalErrorHandler';
import { clearTasksBoardCache } from '../utils/portfolioResolver';
import { useMondayContext } from './MondayContext';

// יצירת Context
const SettingsContext = createContext(null);

// מצבי מבנה הדיווח (legacy — נשמר לתאימות לאחור, לא בשימוש ישיר)
export const STRUCTURE_MODES = {
  PROJECT_ONLY: 'PROJECT_ONLY',                           // רמה 1 בלבד - פרויקט
  PROJECT_WITH_STAGE: 'PROJECT_WITH_STAGE',               // רמה 1 + סיווג (סטטוס)
  PROJECT_WITH_TASKS: 'PROJECT_WITH_TASKS'                // רמה 1 + משימות (Items)
};

// מצבי שדות דיווח
export const FIELD_MODES = {
  REQUIRED: 'required',   // חובה - חייב למלא
  OPTIONAL: 'optional',   // רשות - מוצג אך לא חובה
  HIDDEN: 'hidden'        // מוסתר - לא מוצג כלל
};

// מצבי טוגל
export const TOGGLE_MODES = {
  VISIBLE: 'visible',     // מוצג
  HIDDEN: 'hidden'        // מוסתר
};

// ברירת מחדל להגדרת שדות
export const DEFAULT_FIELD_CONFIG = {
  task:            FIELD_MODES.HIDDEN,      // משימה
  stage:           FIELD_MODES.HIDDEN,      // סיווג (חיוב)
  notes:           FIELD_MODES.HIDDEN,      // הערות
  billableToggle:  TOGGLE_MODES.VISIBLE,    // טוגל לחיוב/לא לחיוב
  nonBillableType: FIELD_MODES.REQUIRED     // סוג לא לחיוב
};

// ברירות מחדל להגדרות
const DEFAULT_SETTINGS = {
  // --- הגדרות מבנה (Structure) ---
  structureMode: STRUCTURE_MODES.PROJECT_WITH_STAGE,  // legacy - נשמר לתאימות לאחור
  enableNotes: true,                                   // legacy - נשמר לתאימות לאחור

  // --- הגדרת שדות דיווח (מחליף את structureMode + enableNotes) ---
  fieldConfig: { ...DEFAULT_FIELD_CONFIG },
  
  // --- לוח פרויקטים (רמה 1) ---
  // מקור הפרויקטים: 'board' = לוח קלאסי רגיל. 'portfolio' = לוח Portfolio של monday
  // (לוח classic עם עמודות portfolio_project_* ועמודת portfolio_project_link מסוג hierarchy).
  // כאשר 'portfolio': tasksBoardId לא בשימוש — נפתר אוטומטית לפר פרויקט.
  projectsSourceMode: 'board',      // 'board' | 'portfolio'
  connectedBoardId: null,           // לוח הפרויקטים (במצב portfolio = מזהה לוח הפורטפוליו)
  peopleColumnIds: [],              // עמודות people לסינון לפי משתמש
  
  // סוג פרויקט (פנימי/חיצוני) — עמודת סטטוס בלוח פרויקטים
  projectTypeColumnId: null,
  enableProjectTypeDistinction: false,   // הבחנה בין פרויקט פנימי/חיצוני
  projectTypeMapping: null,              // { labelText: 'internal'|'external' } - מיפוי לייבל לתפקיד
  projectTypeSourceBoardId: null,        // מזהה לוח מקור (לפענוח mirror)
  projectTypeSourceColumnId: null,       // מזהה עמודת סטטוס מקור (לפענוח mirror)

  // פילטר סטטוס לפרויקטים
  projectStatusFilterEnabled: false,
  projectStatusColumnId: null,
  projectActiveStatusValues: [],
  
  // --- לוח משימות (רמה 2 - רק במצבי TASKS) ---
  tasksBoardId: null,               // לוח המשימות
  tasksProjectColumnId: null,       // עמודת Connect Boards בלוח פרויקטים שמקשרת למשימות
  
  // פילטר סטטוס למשימות
  taskStatusFilterEnabled: false,
  taskStatusColumnId: null,
  taskActiveStatusValues: [],
  
  // --- לוח הקצאות (Assignments) - אופציונלי ---
  useAssignmentsMode: false,          // האם להשתמש בלוח הקצאות למשיכת פרויקטים
  assignmentsBoardId: null,           // לוח ההקצאות
  assignmentPersonColumnId: null,     // עמודת People בלוח הקצאות
  assignmentStartDateColumnId: null,  // עמודת Date להתחלת ההקצאה
  assignmentEndDateColumnId: null,    // עמודת Date לסיום ההקצאה
  assignmentProjectLinkColumnId: null, // עמודת Connect Boards לקישור לפרויקט

  // --- לוח דיווחי שעות ---
  useCurrentBoardForReporting: true, // האם להשתמש בלוח הנוכחי לדיווחים (ברירת מחדל: כן)
  timeReportingBoardId: null,        // מזהה לוח דיווחי שעות (אם לא משתמשים בלוח הנוכחי)
  dateColumnId: null,               // עמודת Date למועד התחלה
  endTimeColumnId: null,            // עמודת Date לזמן סיום (אופציונלי)
  durationColumnId: null,           // עמודת Numbers למשך זמן בשעות
  projectColumnId: null,            // עמודת Connected Board לקישור לפרויקט
  taskColumnId: null,               // עמודת Connected Board לקישור למשימה (רק במצבי TASKS)
  assignmentColumnId: null,         // עמודת Connected Board לקישור להקצאה (רק במצב הקצאות)
  reporterColumnId: null,           // עמודת People למדווח
  eventTypeStatusColumnId: null,    // עמודת Status לסוג האירוע (לחיוב/לא לחיוב)
  allDayTypeStatusColumnId: null,   // עמודת Status לתת-סוג של אירוע יומי (חופשה/מחלה/...)
  nonBillableStatusColumnId: null,  // עמודת Status לסוגי "לא לחיוב"
  stageColumnId: null,              // עמודת Status/Dropdown לסיווג (רק במצבי STAGE)
  notesColumnId: null,              // עמודת Text להערות חופשיות (רק אם enableNotes)
  customerColumnId: null,           // עמודת Connect Boards בלוח הפרויקטים → לקוחות (בכל המצבים)
  customerReportColumnId: null,     // עמודת Connect Boards בלוח דיווחים → לקוחות

  // --- אירועים עתידיים (temporary) ---
  // עמודת Checkbox מסמנת אירוע מתוכנן (true=עתידי, false/null=קבוע).
  // עמודת סוג דיווח מתעדכנת רק בעת המרה לאירוע אמיתי.
  temporaryCheckboxColumnId: null,  // עמודת Checkbox לסימון אירוע עתידי
  showTemporaryEvents: true,        // האם להציג אירועים זמניים בלוח

  // --- מיפוי סוגי דיווח ---
  eventTypeMapping: null,          // { index: 'category', ... } - מיפוי אינדקס לייבל לקטגוריה
  eventTypeLabelMeta: null,        // { index: { label, color }, ... } - מטא-דאטה של לייבלים

  // --- אישור מנהל ---
  enableApproval: false,              // הפעלה/השבתה של פיצ'ר אישור מנהל
  approvalStatusColumnId: null,       // מזהה עמודת Status לאישור
  approvalStatusMapping: null,        // { index: 'pending'|'approved'|'rejected' }
  approvalStatusLabelMeta: null,      // { index: { label, color } }
  approvedManagerIds: [],             // רשימת מזהי משתמשים מנהלים

  // --- מקור היעדרויות (אינטגרציית Day-off, W4.5) ---
  // 'tracker' = הדיווח הקיים דרך אירועים יומיים בלוח הדיווחים (ברירת מחדל - שומר התנהגות נוכחית).
  // 'dayoff' = לוח החופשות של רכיב Day-off הוא מקור האמת; הזנת היעדרויות עוברת לשם (D5/W4.4).
  absenceSource: 'tracker',          // 'tracker' | 'dayoff'
  dayOffAppUrl: '',                  // קישור עומק לרכיב Day-off (W4.4/D5) - מוגדר ידנית; מוצג בהודעת ההפניה במודל היומי כשהמקור dayoff (אופציונלי, http/https בלבד)
  showAbsences: true,                // הצגת שכבת ההיעדרויות מלוח החופשות ביומן (D10; פעילה רק כשמקור dayoff ממופה)
  dayOffApprovalRequired: false,     // מדיניות אישור של ה-tracker (D2): כשפעיל - ממתין לאישור מוצג חלול, ומיפוי עמודת האישור הופך חובה
  // מיפוי לוח החופשות (Day-off vacations board) - מוגדר ידנית בדיאלוג ההגדרות (D9).
  // התאמת לייבלים לפי label ID יציב (לעולם לא לפי טקסט) - ראה Day-off/CONTRACT.md.
  dayOffBoardId: null,               // לוח החופשות
  dayOffPersonColumnId: null,        // עמודת People של העובד (מזהה משתמש monday - מפתח הזהות המערכתי)
  dayOffStartDateColumnId: null,     // עמודת Date תחילת היעדרות (כולל)
  dayOffEndDateColumnId: null,       // עמודת Date סיום היעדרות (כולל)
  dayOffKindColumnId: null,          // עמודת Status מבחינה אישי/כללי
  dayOffKindGeneralLabelId: null,    // label ID של "כללי" (יום חברה)
  dayOffKindPersonalLabelId: null,   // label ID של "אישי" (בקשת היעדרות)
  dayOffTypeColumnId: null,          // עמודת Status של סוג ההיעדרות (סט פתוח ודינמי - D1)
  dayOffApprovalColumnId: null,      // עמודת Status של סטטוס אישור
  dayOffApprovedLabelIds: [],        // label IDs הנחשבים "מאושר"
  dayOffPendingLabelIds: [],         // label IDs הנחשבים "ממתין לאישור" (לרינדור חלול - D2)
  dayOffRejectedLabelIds: [],        // label IDs הנחשבים "נדחה" (W4.1) - מוחרגים תמיד, גם כשמדיניות האישור כבויה (תיקון D2, DEV-2); תווית שאינה באף סט תחת מדיניות פעילה = drift שמדווח בקול (CONTRACT.md §1 כלל 3)

  // --- Filter Configuration ---
  // רשימת הפרויקטים לפילטר נגזרת אוטומטית מהאירועים שנטענו לדשבורד (ראה useDashboardData.projects)
  filterEmployeesBoardId: null,  // לוח שממנו נטען רשימת העובדים לפילטר
  filterEmployeesColumnId: null, // עמודת People בלוח העובדים

  // --- מטא-דאטה של עריכה אחרונה ---
  lastModifiedBy: null,   // { id, name }
  lastModifiedAt: null,   // ISO timestamp string

  // --- ולידציה מתקדמת (XOR) ---
  advancedValidation: { enabled: false, xorFields: [null, null] },

  // --- נעילת עריכה ---
  editLockMode: 'none',           // none | days_after
  editLockDays: 2,                // מספר הימים המותרים במצב days_after
  lockAfterApproval: false,        // נעילה לאחר אישור מנהל

  // --- יעד שעות ---
  monthlyHoursTarget: 182.5,      // יעד שעות חודשי
  weeklyHoursTarget: null,        // יעד שעות שבועי (null = חישוב אוטומטי מהחודשי / 4.33)
  workdayLength: 8.5,             // אורך יום עבודה בשעות (לחישוב שעות מאירועים יומיים)

  // --- הגדרות לוח שנה ---
  workDays: [0, 1, 2, 3, 4],     // ימי עבודה: 0=ראשון, 1=שני, ..., 6=שבת
  weekStartDay: 0,                  // יום ראשון בשבוע (חייב להיות אחד מ-workDays)

  // --- שפה (אינקרמנט 8 — מאחורי VITE_ENABLE_LANGUAGE_PICKER) ---
  languageOverride: null,          // 'he' | 'en' | null. null = שימוש ב-monday.context.user.currentLanguage.

  // --- מראה (Dark Mode) ---
  themeMode: 'auto'                // 'light' | 'dark' | 'auto'. auto = לפי הגדרת המערכת (prefers-color-scheme).
};

// Provider Component
export function SettingsProvider({ monday, children }) {
  const { context, currentUser } = useMondayContext();
  const [customSettings, setCustomSettingsRaw] = useState(DEFAULT_SETTINGS);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const contextRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);   // { kind: 'network' } | null
  const loadInFlightRef = useRef(false);              // race guard נגד re-entrance
  const loadedInstanceIdRef = useRef(null);           // ה-instanceId שטענו עבורו בהצלחה

  // עדכון settings רק אם התוכן באמת השתנה - מונע רינדורים מיותרים בכל downstream hooks
  const setCustomSettings = useCallback((newSettings) => {
    const prev = settingsRef.current;
    const json = JSON.stringify(newSettings);
    if (JSON.stringify(prev) === json) return;
    settingsRef.current = newSettings;
    setCustomSettingsRaw(newSettings);
  }, []);

  // בדיקת תגובת monday.storage — זורק שגיאה אם success === false
  const validateStorageResponse = (result, operation, key) => {
    if (result?.data?.success === false) {
      const errorMsg = result.data.error || 'Unknown storage error';
      // אותו instance לרישום ולזריקה — log-once מקפל לרשומה אחת (טוסט אחד מה-UI sink)
      const storageErr = new Error(`Storage ${operation} failed: ${errorMsg}`);
      storageErr.details = result.data;
      logger.error('SettingsContext', `Storage ${operation} failed for key "${key}"`, storageErr);
      throw storageErr;
    }
  };

  // טעינת הגדרות מ-Monday Storage — ניסיון יחיד + silent reload חד-פעמי על כשלון רשת.
  // מבחין בין: success+value (טען+מיגרציה) / success+ריק (מופע חדש, ברירות מחדל) /
  // timeout/exception/success:false (תקלת רשת → reload חד-פעמי, אחר כך error UI).
  const RELOAD_GUARD_KEY = 'tracker_settings_reload_done';
  // ATTEMPT_TIMEOUT_MS (5000) is the shared Axis storage timeout, imported from @axis/app-core (#17).

  const loadSettings = useCallback(async () => {
    if (loadInFlightRef.current) return;

    const instanceId = resolveInstanceId(contextRef.current);
    // אם כבר טענו בהצלחה עבור ה-instanceId הזה — מדלגים. מונע ריצה מרובה כש-context משתנה.
    if (loadedInstanceIdRef.current === instanceId) return;

    loadInFlightRef.current = true;
    const globalKey = `customSettings_${instanceId}`;

    // עוטף קריאה ב-timeout כדי שלא ניתקע אם monday.storage לא חוזר.
    // app-core withTimeout משחזר בדיוק את ה-race הקודם: דוחה עם Error('storage.getItem timeout')
    // אחרי ATTEMPT_TIMEOUT_MS — בדיוק ההודעה שה-classifier למטה מזהה כ-reason:'timeout'.
    const getItemWithTimeout = () =>
      withTimeout(monday.storage.getItem(globalKey), ATTEMPT_TIMEOUT_MS, 'storage.getItem');

    // נכשל ב-network — מנסה silent reload פעם אחת, אחרת מציג שגיאה
    const handleNetworkFailure = (reason, errorDetails) => {
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
      } catch (storageError) {
        // sessionStorage לא זמין — נחשוב כאילו כבר נוסה reload (fail-safe)
        logger.debug('SettingsContext', 'sessionStorage.getItem לא זמין', storageError);
      }

      if (!alreadyReloaded) {
        try {
          sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
        } catch (storageError) {
          // sessionStorage לא זמין — ממשיכים ל-reload בכל מקרה
          logger.debug('SettingsContext', 'sessionStorage.setItem לא זמין', storageError);
        }
        logger.info('SettingsContext', 'Triggering silent reload', { reason, key: globalKey });
        recordReload('settings-silent', reason, errorDetails?.message || String(errorDetails || '')); // ⚠️ TEMP diagnostic (#103)
        // לא משחררים את ה-ref — הדף בכל מקרה עומד לעשות reload
        window.location.reload();
        return;
      }

      const reloadErr = new Error('טעינת ההגדרות נכשלה גם לאחר ניסיון רענון שקט');
      reloadErr.details = { reason, error: errorDetails };
      logger.error('SettingsContext', 'Silent reload already attempted — surfacing error', reloadErr);
      setLoadError({ kind: 'network' });
      setIsLoading(false);
      loadInFlightRef.current = false;
    };

    let result;
    try {
      result = await getItemWithTimeout();
    } catch (error) {
      const reason = error?.message === 'storage.getItem timeout' ? 'timeout' : 'exception';
      logger.warn('SettingsContext', 'Load outcome', { reason, timeoutMs: ATTEMPT_TIMEOUT_MS, key: globalKey, error });
      handleNetworkFailure(reason, error);
      return;
    }

    // success:false — ה-SDK ענה אבל הסיגנל "תקלה"
    if (result?.data?.success === false) {
      const err = result.data.error || 'Unknown storage error';
      logger.warn('SettingsContext', 'Load outcome', { reason: 'success_false', error: err, key: globalKey });
      handleNetworkFailure('success_false', err);
      return;
    }

    try {
      // success + value — טעינה תקינה
      if (result?.data?.value) {
        const savedSettings = JSON.parse(result.data.value);
        logger.initDone(4, 'Settings loaded from storage');

        // מיגרציה של מפתחות ישנים לחדשים (תאימות לאחור)
        const migratedSettings = { ...savedSettings };

        if (savedSettings.productsBoardId && !savedSettings.tasksBoardId) {
          migratedSettings.tasksBoardId = savedSettings.productsBoardId;
        }
        if (savedSettings.productsCustomerColumnId && !savedSettings.tasksProjectColumnId) {
          migratedSettings.tasksProjectColumnId = savedSettings.productsCustomerColumnId;
        }
        if (savedSettings.productColumnId && !savedSettings.taskColumnId) {
          migratedSettings.taskColumnId = savedSettings.productColumnId;
        }

        if (!savedSettings.structureMode) {
          migratedSettings.structureMode = detectStructureMode(migratedSettings);
          logger.info('SettingsContext', 'Auto-detected structureMode', { mode: migratedSettings.structureMode });
        }

        if (migratedSettings.eventTypeMapping && isLegacyMapping(migratedSettings.eventTypeMapping)) {
          logger.info('SettingsContext', 'Detected legacy text-based eventTypeMapping, clearing for re-migration');
          migratedSettings.eventTypeMapping = null;
          migratedSettings.eventTypeLabelMeta = null;
        }
        if (migratedSettings.eventTypeLabelColors) {
          delete migratedSettings.eventTypeLabelColors;
        }

        delete migratedSettings.useStageField;
        delete migratedSettings.useEmployeeCost;
        delete migratedSettings.employeesBoardId;
        delete migratedSettings.employeesPersonColumnId;
        delete migratedSettings.employeesHourlyRateColumnId;
        delete migratedSettings.totalCostColumnId;
        delete migratedSettings.productsBoardId;
        delete migratedSettings.productsCustomerColumnId;
        delete migratedSettings.productColumnId;

        if (!migratedSettings.fieldConfig) {
          migratedSettings.fieldConfig = migrateToFieldConfig(migratedSettings);
          logger.info('SettingsContext', 'Migrated structureMode to fieldConfig', { fieldConfig: migratedSettings.fieldConfig });
        }

        const finalSettings = { ...DEFAULT_SETTINGS, ...migratedSettings };
        logger.initDone(5, 'Migrations complete', finalSettings);

        setCustomSettings(finalSettings);
        setLoadError(null);
        setIsLoading(false);
        loadedInstanceIdRef.current = instanceId;
        try {
          sessionStorage.removeItem(RELOAD_GUARD_KEY);
        } catch (storageError) {
          logger.debug('SettingsContext', 'sessionStorage.removeItem לא זמין', storageError);
        }
        logger.info('SettingsContext', 'Load outcome', { reason: 'success_with_value', key: globalKey });
        return;
      }

      // success ללא value — מופע חדש. אין retry, טוענים ברירות מחדל.
      logger.initDone(4, 'Using default settings (new instance)');
      logger.initDone(5, 'No migrations needed');
      logger.info('SettingsContext', 'Load outcome', { reason: 'success_empty_new_instance', key: globalKey });
      setLoadError(null);
      setIsLoading(false);
      loadedInstanceIdRef.current = instanceId;
      try {
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
      } catch (storageError) {
        logger.debug('SettingsContext', 'sessionStorage.removeItem לא זמין', storageError);
      }
    } catch (error) {
      // JSON.parse פגום או כשל מיגרציה — לא משאירים את הספינר תקוע.
      // נופלים חזרה לברירות המחדל כדי שהאפליקציה תיטען, ומסמנים שהטעינה הסתיימה.
      logger.error('SettingsContext', 'Failed to parse/migrate stored settings, falling back to defaults', error);
      setCustomSettings(DEFAULT_SETTINGS);
      setLoadError(null);
      setIsLoading(false);
      loadedInstanceIdRef.current = instanceId;
      try {
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
      } catch (storageError) {
        logger.debug('SettingsContext', 'sessionStorage.removeItem לא זמין', storageError);
      }
    } finally {
      loadInFlightRef.current = false;
    }
  }, [monday]);

  // ריענון ידני (מ-NetworkErrorScreen) — מנקה guard ומפעיל טעינה מחדש
  const reloadSettings = useCallback(() => {
    if (loadInFlightRef.current) return;
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch (storageError) {
      logger.debug('SettingsContext', 'sessionStorage.removeItem לא זמין', storageError);
    }
    loadedInstanceIdRef.current = null;  // לאפשר טעינה חוזרת אחרי כשלון
    setLoadError(null);
    setIsLoading(true);
    loadSettings();
  }, [loadSettings]);

  // שמירת context ב-ref כדי שיהיה נגיש בתוך loadSettings (useCallback עם deps מינימליים)
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  // טעינת הגדרות רק אחרי שה-context נטען (מבטיח שה-parent frame מזהה את ה-instance)
  useEffect(() => {
    if (!context) return;
    // loadSettings מטפל פנימית בכל נתיבי הכשל (handleNetworkFailure / fallback ל-DEFAULT_SETTINGS),
    // אך מוסיפים .catch כרשת ביטחון לכשל בלתי-צפוי כדי שלא תיווצר unhandled rejection שקטה.
    loadSettings().catch((error) => {
      logger.error('SettingsContext', 'Unexpected error in loadSettings effect', error);
      setIsLoading(false);
    });
  }, [context, loadSettings]);
  
  // מיגרציה מ-structureMode + enableNotes ל-fieldConfig
  const migrateToFieldConfig = (settings) => {
    const fieldConfig = { ...DEFAULT_FIELD_CONFIG };
    const mode = settings.structureMode || detectStructureMode(settings);

    switch (mode) {
      case STRUCTURE_MODES.PROJECT_WITH_TASKS:
        fieldConfig.task = FIELD_MODES.REQUIRED;
        fieldConfig.stage = FIELD_MODES.HIDDEN;
        break;
      case STRUCTURE_MODES.PROJECT_WITH_STAGE:
        fieldConfig.task = FIELD_MODES.HIDDEN;
        fieldConfig.stage = FIELD_MODES.REQUIRED;
        break;
      case STRUCTURE_MODES.PROJECT_ONLY:
      default:
        fieldConfig.task = FIELD_MODES.HIDDEN;
        fieldConfig.stage = FIELD_MODES.HIDDEN;
        break;
    }

    // מיגרציה של enableNotes
    if (settings.enableNotes === true) {
      fieldConfig.notes = FIELD_MODES.OPTIONAL;
    } else if (settings.enableNotes === false) {
      fieldConfig.notes = FIELD_MODES.HIDDEN;
    }

    return fieldConfig;
  };

  // זיהוי אוטומטי של structureMode לפי הגדרות קיימות
  const detectStructureMode = (settings) => {
    const hasTasks = settings.tasksBoardId || settings.taskColumnId || settings.tasksProjectColumnId;
    const hasStage = settings.stageColumnId;
    const useStageField = settings.useStageField !== false; // ברירת מחדל true
    
    if (hasTasks) {
      return STRUCTURE_MODES.PROJECT_WITH_TASKS;
    } else if (hasStage && useStageField) {
      return STRUCTURE_MODES.PROJECT_WITH_STAGE;
    } else {
      return STRUCTURE_MODES.PROJECT_ONLY;
    }
  };

  // עדכון הגדרות ושמירה ב-Storage (עם rollback בכשלון)
  const updateSettings = async (newSettings) => {
    const previousSettings = customSettings;
    try {
      // שימוש במשתמש שכבר נטען ב-MondayContext
      let modifiedBy = customSettings.lastModifiedBy;
      if (currentUser?.id) {
        modifiedBy = { id: currentUser.id, name: currentUser.name || '' };
      } else if (context?.user?.id) {
        modifiedBy = { id: context.user.id, name: context.user.name || '' };
      }

      const updatedSettings = {
        ...customSettings,
        ...newSettings,
        lastModifiedBy: modifiedBy,
        lastModifiedAt: new Date().toISOString(),
      };

      // איפוס מטמון פתרון לוחות-משימות במצב Portfolio בעת שינוי מקור הפרויקטים.
      // לא משפיע במצב 'board' (המטמון ריק ממילא).
      const sourceChanged =
        updatedSettings.projectsSourceMode !== customSettings.projectsSourceMode ||
        updatedSettings.connectedBoardId !== customSettings.connectedBoardId;
      if (sourceChanged) {
        clearTasksBoardCache();
      }

      setCustomSettings(updatedSettings);

      const instanceId = resolveInstanceId(contextRef.current);
      const globalKey = `customSettings_${instanceId}`;
      const payload = JSON.stringify(updatedSettings);

      const globalResult = await monday.storage.setItem(globalKey, payload);
      validateStorageResponse(globalResult, 'setItem (global)', globalKey);

      return true;
    } catch (error) {
      setCustomSettings(previousSettings);
      logger.error('SettingsContext', 'Failed to save settings, rolled back', error);
      handleGlobalError(error, { functionName: 'updateSettings' });
      return false;
    }
  };

  // איפוס הגדרות לברירת מחדל (עם rollback בכשלון)
  const resetSettings = async () => {
    const previousSettings = customSettings;
    try {
      clearTasksBoardCache();
      setCustomSettings(DEFAULT_SETTINGS);
      const instanceId = resolveInstanceId(contextRef.current);
      const globalKey = `customSettings_${instanceId}`;
      const payload = JSON.stringify(DEFAULT_SETTINGS);

      const globalResult = await monday.storage.setItem(globalKey, payload);
      validateStorageResponse(globalResult, 'setItem (global)', globalKey);

      return true;
    } catch (error) {
      setCustomSettings(previousSettings);
      logger.error('SettingsContext', 'Failed to reset settings, rolled back', error);
      handleGlobalError(error, { functionName: 'resetSettings' });
      return false;
    }
  };

  const value = {
    customSettings,
    updateSettings,
    resetSettings,
    isLoading,
    loadError,
    reloadSettings
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

// Custom Hook לשימוש ב-Context
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}

export default SettingsContext;
