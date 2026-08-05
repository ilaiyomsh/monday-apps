import React, { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { useStableT } from './i18n/useStableT';
import { Calendar } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';

// ייבוא קבצי עיצוב
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './styles/calendar/index.css';

// קבועים והגדרות
import { createWorkWeekView, createThreeDayView, formats, roundToNearest15Minutes, CALENDAR_DEFAULTS } from './constants/calendarConfig';
import { createLocalizer, createMessages } from './constants/calendarConfig.factory';

// פונקציות עזר
import { getColumnIds } from './utils/mondayColumns';
import { validateSettings } from './utils/settingsValidator';
import { getEffectiveBoardId } from './utils/boardIdResolver';
import { isEventLocked } from './utils/editLockUtils';
import { safeApi } from './utils/mondayApi';
import lazyRetry, { prefetchLazy } from './utils/lazyRetry';
import logger from './utils/logger';
import { useViewTracking } from '@axis/app-core';

// רכיבים - טעינה רגילה (נדרשים מיידית)
import CalendarToolbar from './components/CalendarToolbar';
import CustomEvent from './components/CustomEvent';
import MobileResizeOverlay from './components/MobileResizeOverlay';
import { ToastContainer } from './components/Toast';
import ErrorDetailsModal from './components/ErrorDetailsModal/ErrorDetailsModal';
import SettingsValidationDialog from './components/SettingsValidationDialog';
import UndoBanner from './components/UndoBanner';
import StopwatchLoader from './components/StopwatchLoader';
import loaderStyles from './components/StopwatchLoader/StopwatchLoader.module.css';

// Context
import { useSettings } from './contexts/SettingsContext';
import { useMondayContext, useMobile } from './contexts/MondayContext';

// Event Type Mapping
import { createLegacyMapping } from './utils/eventTypeMapping';
import { parseStatusColumnLabels } from './utils/eventTypeValidation';
import { migrateApprovalMapping } from './utils/approvalMapping';
import { buildDayOffDeepLink } from './utils/dayOffDeepLink';

// Hooks
import { useLocale } from './hooks/useLocale';
import { useProjects } from './hooks/useProjects';
import { useBoardOwner } from './hooks/useBoardOwner';
import { useDayOffAbsences } from './hooks/useDayOffAbsences';
import { useEventModals } from './hooks/useEventModals';
import { useCalendarHandlers } from './hooks/useCalendarHandlers';
import { useAllDayEvents } from './hooks/useAllDayEvents';
import { useEventDataLoader } from './hooks/useEventDataLoader';
import { useFilterOptions } from './hooks/useFilterOptions';
import { useCelebration } from './hooks/useCelebration';
// Wave 5.1.4 — קריאה מאוחדת לשמונה ה-hooks (toasts/events/filter/monthly/undo/selection/approval/swipe)
import { useMondayCalendarHooks } from './hooks/useMondayCalendarHooks';

// רכיבים - Lazy loaded (מודלים ורכיבים כבדים שנטענים רק בעת שימוש).
// חושפים את ה-importer thunks החוצה כדי לאפשר preload ידני ברקע אחרי
// שהיומן והאירועים נטענו (ראה useEffect ב-MondayCalendar).
// thunks גולמיים של import() — מקור יחיד. lazyRetry עוטף אותם לטעינה-לפי-דרישה
// (React.lazy, עם רענון-פעם-אחת על כשל אמיתי כשהמשתמש פותח מודל), ו-prefetchLazy
// משתמש בהם ישירות לטעינה-מקדימה שקטה שלעולם לא מרעננת.
const rawEventModal = () => import('./components/EventModal/EventModal');
const rawAllDayEventModal = () => import('./components/AllDayEventModal/AllDayEventModal');
const rawContextMenu = () => import('./components/ContextMenu');
const rawSelectionActionBar = () => import('./components/SelectionActionBar');
const rawApprovalActionBar = () => import('./components/ApprovalActionBar');

const EventModal = React.lazy(lazyRetry(rawEventModal, 'EventModal'));
const AllDayEventModal = React.lazy(lazyRetry(rawAllDayEventModal, 'AllDayEventModal'));
const ContextMenu = React.lazy(lazyRetry(rawContextMenu, 'ContextMenu'));
const SelectionActionBar = React.lazy(lazyRetry(rawSelectionActionBar, 'SelectionActionBar'));
const ApprovalActionBar = React.lazy(lazyRetry(rawApprovalActionBar, 'ApprovalActionBar'));

// Vite/webpack ממסגרים `import()` כך שאותו module path מחזיר את אותו promise.
// preload triggers את ההורדה ושומר את התוצאה ב-module registry — כשReact.lazy
// יבקש את אותו module מאוחר יותר (בקליק על תא all-day וכו'), הוא יקבל מודול
// כבר טעון ויראנדר סינכרונית, ללא חוויית "כלום לא קורה" של Suspense fallback=null.
//
// קריטי: הטעינה-המקדימה משתמשת ב-prefetchLazy (לא ב-lazyRetry) — כשל chunk בטעינת
// רקע *לא* יבצע window.location.reload. רענון על כשל-רקע הוא הבאג שדווח (2026-06-21):
// האפליקציה עלתה ואז רעננה את עצמה. אם ה-prefetch נכשל, המודול פשוט לא יתחמם מראש
// וייטען לפי-דרישה כשהמשתמש יפתח אותו.
const preloadLazyModals = () => {
    prefetchLazy(rawEventModal, 'EventModal');
    prefetchLazy(rawAllDayEventModal, 'AllDayEventModal');
    prefetchLazy(rawContextMenu, 'ContextMenu');
    prefetchLazy(rawSelectionActionBar, 'SelectionActionBar');
    prefetchLazy(rawApprovalActionBar, 'ApprovalActionBar');
};

// עטיפת הלוח ברכיב Drag and Drop
const DnDCalendar = withDragAndDrop(Calendar);

// פונקציית עזר לשם יום — locale-aware. עם date-fns he/enUS locales,
// localizer.format(date, 'EEEE', culture) מחזיר את שם היום בשפה הנכונה
// ("יום ראשון" / "Sunday"). בעברית נחתוך את התחילית "יום " (חוץ מ"שבת")
// כדי שכותרות העמודות יהיו תמציתיות: "ראשון" / "שלישי" וכו'.
const getDayName = (date, localizer, culture) => {
    const raw = localizer.format(date, 'EEEE', culture);
    return typeof raw === 'string' && raw.startsWith('יום ') ? raw.slice(4) : raw;
};

// רכיב כותרת יום מותאם אישית - שם היום מעל מספר התאריך (תצוגה בלבד, ללא לחיצה)
// Factory — מקבל culture ומחזיר רכיב סגור עליו (rbc לא מעביר culture
// ל-header components, ולכן baking אותו בסגירה).
const createCustomDayHeader = (culture) => ({ date, localizer }) => {
    const dayName = getDayName(date, localizer, culture);
    const dayNumber = localizer.format(date, 'd', culture);

    return (
        <div className="rbc-custom-header">
            <div className="rbc-header-day">{dayName}</div>
            <div className="rbc-header-date">{dayNumber}</div>
        </div>
    );
};

// כותרת ה-time-gutter במובייל — מציגה את התאריך הנוכחי בסגנון Google Calendar
// (יום בשבוע + מספר יום במעגל) מעל סרגל השעות. שם היום נגזר מ-date-fns לפי
// השפה: 'EEEE' לעברית = "ראשון" / "שבת"; לאנגלית = "Sunday" וכו'. ל-Saturday
// (יום 6) לא מוסיפים את ה-prefix "יום" כי "שבת" עומד בפני עצמו (בעברית). באנגלית
// משתמשים תמיד ב-prefix מה-i18n.
const TimeGutterHeaderFactory = (date, t, dateFnsLocale, language) => () => {
    const today = new Date();
    const isToday = date.getFullYear() === today.getFullYear()
        && date.getMonth() === today.getMonth()
        && date.getDate() === today.getDate();
    const i = date.getDay();
    // date-fns localize.day: בעברית wide כולל כבר "יום " ("יום ראשון"/"יום שלישי" — חוץ מ"שבת")
    // ולכן אין להוסיף שוב prefix דרך ה-i18n. באנגלית wide הוא "Sunday"/"Tuesday" ללא prefix
    // — שם משתמשים ב-dayPrefix. בעברית אנחנו רוצים תמציתי: "ראשון"/"שלישי" — נחתוך "יום ".
    const dayNameRaw = dateFnsLocale.localize.day(i, { width: 'wide' });
    const dayName = (language === 'he' && typeof dayNameRaw === 'string' && dayNameRaw.startsWith('יום '))
        ? dayNameRaw.slice(4)
        : dayNameRaw;
    const dayLabel = language === 'he' ? dayName : t('calendar.gutter.dayPrefix', { day: dayName });
    return (
        <div className={`rbc-gutter-date ${isToday ? 'rbc-gutter-date--today' : ''}`}>
            <span className="rbc-gutter-date-day">{dayLabel}</span>
            <span className="rbc-gutter-date-num">{date.getDate()}</span>
        </div>
    );
};

// רכיב כותרת יום לתצוגת חודש - שם היום בלבד, ללא מספר תאריך
const createMonthHeader = (culture) => ({ date, localizer }) => {
    const dayName = getDayName(date, localizer, culture);
    return (
        <div className="rbc-custom-header rbc-month-header">
            <div className="rbc-header-day">{dayName}</div>
        </div>
    );
};

export default function MondayCalendar({ monday, onOpenSettings, onOpenProjectColors, onSwitchToDashboard, appLoadStart, hasIncompleteSettings = false, isFirstInstall = false }) {
    // Init Flow — Step 6 (ref-guarded, פעם אחת)
    const initMountLogged = useRef(false);
    if (!initMountLogged.current) {
        initMountLogged.current = true;
        logger.initDone(6, 'MondayCalendar mounted');
    }

    // v2 usage telemetry — view_open once per session for the calendar view (inert until Axiom sink active)
    useViewTracking(logger, 'calendar');

    const t = useStableT();

    // גישה להגדרות מותאמות
    const { customSettings, updateSettings, isLoading: settingsLoading } = useSettings();
    const isMobile = useMobile();

    // קונטקסט Monday מרכזי — מועלה למעלה כדי שיהיה זמין לכל ה-useMemo
    // הבאים (calendarMessages/isLtr/culture). חייב להופיע לפני שורה 150.
    const { context } = useMondayContext();
    // נגזרות locale מאוחדות דרך useLocale — שורש: i18n.language (מכבד languageOverride).
    const { isLtr, culture, language, dir, dateFnsLocale } = useLocale();

    // ימי עבודה ויום תחילת שבוע מההגדרות
    const workDays = customSettings.workDays ?? [0, 1, 2, 3, 4];
    const weekStartDay = customSettings.weekStartDay ?? 0;

    // localizer + messages locale-aware דרך factory (אינקרמנט 10 follow-up).
    // formats נשארים מהמודול הישן — הם culture-driven (`localizer.format(..., culture)`)
    // ולכן עובדים עם ה-localizer החדש שמכיר גם he וגם en.
    const localizer = useMemo(
        () => createLocalizer({ language, weekStartDay }),
        [language, weekStartDay]
    );
    // messages — לא משתמשים ב-useTranslation כדי שיישארו פונקציות תקפות
    // (showMore = function) שrbc מצפה אליהן סגורות.
    const calendarMessages = useMemo(() => createMessages(language), [language]);
    // isLtr / culture מגיעים מ-useLocale למעלה — שורש אמת אחיד עם שאר
    // הקומפוננטות. culture חייב להתאים למפתח שה-factory רושם ב-locales —
    // useLocale מבטיח שהוא 'he' או 'en' (אותם המפתחות).

    // header components תלויי culture — נוצרים פעם אחת לכל שינוי שפה
    // כך ש-rbc יקבל את אותה רפרנס (אחרת ירונדר מחדש בכל פריים).
    const CustomDayHeaderForCulture = useMemo(() => createCustomDayHeader(culture), [culture]);
    // במובייל בתצוגת "יום" — ה-timeGutterHeader כבר מציג את שם היום והתאריך
    // בסגנון Google Calendar; הסתרת ה-column header מונעת כפילות.
    const EmptyHeader = useMemo(() => () => null, []);
    const MonthHeaderForCulture = useMemo(() => createMonthHeader(culture), [culture]);

    // WorkWeekView דינמי לפי ימי עבודה + culture (לכותרת החודש)
    const DynamicWorkWeekView = useMemo(
        () => createWorkWeekView(workDays, weekStartDay, culture),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(workDays), weekStartDay, culture]
    );

    // ThreeDayView (מובייל) — locale-aware בכותרת החודש
    const DynamicThreeDayView = useMemo(() => createThreeDayView(culture), [culture]);

    // תצוגות לוח שנה - מותאמות למובייל/דסקטופ
    const calendarViews = useMemo(() =>
        isMobile
            ? { three_day: DynamicThreeDayView, day: true, month: true }
            : { month: true, week: true, work_week: DynamicWorkWeekView, day: true },
        [isMobile, DynamicWorkWeekView, DynamicThreeDayView]
    );
    const defaultView = isMobile ? 'day' : 'work_week';
    
    // פונקציית עזר ליצירת תאריך עם שעה ספציפית על בסיס היום הנוכחי
    const getTodayWithTime = (hours, minutes = 0) => {
        const d = new Date();
        d.setHours(hours, minutes, 0, 0);
        return d;
    };

    // State - לוח שנה - שעות עבודה קבועות: 00:00 עד 23:59
    const minTime = useMemo(() => {
        return getTodayWithTime(0, 0);
    }, []);
    
    const maxTime = useMemo(() => {
        const d = new Date();
        d.setHours(23, 59, 59, 999);
        return d;
    }, []);


    // State לניווט בלוח (נדרש לתמיכה בסווייפ)
    const [calendarDate, setCalendarDate] = useState(new Date());
    const [calendarView, setCalendarView] = useState(defaultView);

    // selectedEventId / multiSelect / approvalSelection / contextMenu — חולצו ל-useCalendarSelection (גל 5.1.2)
    // דגל לבליעת ה-click הסינתטי שמגיע אחרי long-press (אחרת היה נפתח מודל מיד אחרי overlay)
    const longPressFiredRef = useRef(false);

    // עדכון תצוגת ברירת מחדל כשמשתנה isMobile
    useEffect(() => {
        setCalendarView(defaultView);
    }, [defaultView]);

    // שמירת טווח התצוגה הנוכחי — קלט ל-useMonthlyHours/useApproval בתוך useMondayCalendarHooks (גל 5.1.4)
    const [currentViewRange, setCurrentViewRange] = useState(null);

    // גלילה ידנית לשעת ההתחלה - מופעל כשהלואדר נעלם והלוח מוצג
    // מובייל: 09:00 (טווח עבודה רגיל). דסקטופ: 08:00.
    const scrollToEightRef = useRef(null);
    scrollToEightRef.current = () => {
        const scrollContainer = document.querySelector('.rbc-time-content');
        if (!scrollContainer) return;
        const targetTime = isMobile ? '09:00' : '08:00';
        const labels = Array.from(document.querySelectorAll('.rbc-time-gutter .rbc-label'));
        const targetLabel = labels.find(label => label.textContent.includes(targetTime));
        if (targetLabel) {
            const slotGroup = targetLabel.closest('.rbc-timeslot-group');
            if (slotGroup) {
                scrollContainer.scrollTop = slotGroup.offsetTop - 10;
            }
        }
    };

    const [settings, setSettings] = useState(null);
    const [columnIds, setColumnIds] = useState(null); // מזהי העמודות

    // Hook לניהול מצב המודלים
    const modals = useEventModals();

    // Hook לניהול פרויקטים
    const { projects, loading: isLoadingProjects, error: projectsError } = useProjects();

    // Hook לבדיקת owner status
    const { isOwner } = useBoardOwner(monday);

    // Hook לשכבת ההיעדרויות מלוח החופשות של Day-off (W4.2) — שכבת תצוגה
    // נפרדת (D10): דגל משלה (showAbsences), gating מלא בתוך ההוק
    // (ברירות המחדל — dayOffBoardId ריק — משאירות אותו רדום בכל התקנה קיימת)
    const { absences: dayOffAbsences, loadAbsences: loadDayOffAbsences } = useDayOffAbsences(monday);

    // חישוב לוח דיווחים אפקטיבי (חייב להיות לפני hooks שמשתמשים ב-effectiveBoardId)
    const effectiveBoardId = useMemo(() =>
        getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    // Wave 5.1.4 — קריאה מאוחדת לשמונה ה-hooks: toasts/events/filter/monthly/undo/selection/approval/swipe.
    // הקלטים calendarDate/calendarView/setCalendarDate/currentViewRange נשארים בבעלות הצרכן ומועברים פנימה.
    const cal = useMondayCalendarHooks({
        monday,
        context,
        customSettings,
        t,
        isMobile,
        calendarDate,
        calendarView,
        setCalendarDate,
        currentViewRange,
    });
    // toasts
    const {
        toasts,
        showSuccess,
        showError,
        showWarning,
        removeToast,
        showErrorWithDetails,
        errorDetailsModal,
        openErrorDetailsModal,
        closeErrorDetailsModal,
        // events
        events,
        eventsLoading,
        loadEvents,
        createEvent,
        updateEvent,
        updateEventPosition,
        addEvent,
        resolvePendingEvent,
        removePendingEvent,
        removeEventsFromState,
        // filter / monthly hours
        calendarFilter,
        monthlyHours,
        // undo
        undoDelete,
        undoBanner,
        // selection / approval
        selection,
        approval,
        // swipe
        swipeHandlers,
        swipeContentRef,
        swipePeekRef,
    } = cal;
    const { multiSelect, approvalSelection, selectedEventId, setSelectedEventId, contextMenu } = selection;
    const {
        handleDuplicateSelected,
        handleDeleteSelected,
        handleEventContextMenu,
        handleContextMenuDelete,
        closeContextMenu,
    } = selection.handlers;

    // Hook לאפשרויות פילטר — נטען ברקע אחרי שהאירועים הראשוניים עלו
    // כך לא מתחרה עם הקריאות החיוניות (אירועים, פרויקטים) בעת עליית האפליקציה
    const [filterEnabled, setFilterEnabled] = useState(false);
    const {
        reporters,
        loadingReporters,
        filterProjects,
        loadingFilterProjects
    } = useFilterOptions(monday, effectiveBoardId, customSettings, filterEnabled);

    // State - אימות הגדרות
    const [settingsValidation, setSettingsValidation] = useState(null);
    const [hasValidatedSettings, setHasValidatedSettings] = useState(false);
    const [showValidationDialog, setShowValidationDialog] = useState(false);

    // State - הצגת אירועים מתוכננים (Temporary)
    const [showTemporaryEvents, setShowTemporaryEvents] = useState(
        customSettings.showTemporaryEvents !== false
    );

    // preload של modals lazy ברגע שהיומן עלה והאירועים נטענו לראשונה.
    // נדחה לחלון idle של הדפדפן כדי לא להתחרות על main thread עם
    // הרינדור הראשוני של היומן/האירועים. רץ פעם אחת בלבד לכל session.
    const modalsPreloadedRef = useRef(false);
    useEffect(() => {
        if (modalsPreloadedRef.current) return;
        // מחכים ש-useMondayEvents יסיים את הטעינה הראשונית.
        // (גם אם events.length=0 — הטעינה הסתיימה, ה-network פנוי, אפשר לטעון.)
        if (eventsLoading) return;
        modalsPreloadedRef.current = true;

        const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
        const cancel = window.cancelIdleCallback || clearTimeout;
        // timeout: 2s — אם הדפדפן לא נכנס ל-idle תוך 2 שניות, מבצעים בכל זאת.
        const handle = idle(() => {
            preloadLazyModals();
            logger.debug('MondayCalendar', 'Preloaded lazy modal chunks');
        }, { timeout: 2000 });

        return () => cancel(handle);
    }, [eventsLoading]);

    // Hook לחגיגות קונפטי באבני דרך יומיות
    const { captureBeforeState, checkCelebration } = useCelebration(events, showSuccess, customSettings.workdayLength);

    // Init Step 7 — כל ה-hooks אותחלו
    const initStep7Logged = useRef(false);
    if (!initStep7Logged.current) {
        initStep7Logged.current = true;
        logger.initDone(7, 'All hooks initialized');
    }

    // State - Loader: מוצג מרגע העלייה, מינימום 1.5 שניות + fade-out
    const [showLoader, setShowLoader] = useState(true);
    const [loaderFading, setLoaderFading] = useState(false);
    const loaderStartRef = useRef(appLoadStart || Date.now());
    const prevLoadingRef = useRef(false);
    const initialLoadDone = useRef(false);
    const loaderTimersRef = useRef({});

    // State - Loader למעברי תצוגה (אחרי טעינה ראשונה)
    const [viewChangeLoading, setViewChangeLoading] = useState(false);
    const [viewChangeFading, setViewChangeFading] = useState(false);

    useEffect(() => {
        const wasLoading = prevLoadingRef.current;
        prevLoadingRef.current = eventsLoading;

        // טעינה ראשונה - לואדר מלא עם מינימום 1.5 שניות
        if (wasLoading && !eventsLoading && !initialLoadDone.current) {
            initialLoadDone.current = true;
            // הפעלת טעינת נתוני פילטר ברקע — לא חוסמים את עליית האפליקציה
            // במובייל הפילטר מוסתר, אז אין צורך לטעון רשימות מסננים
            if (!isMobile) setFilterEnabled(true);
            const elapsed = Date.now() - loaderStartRef.current;
            const remaining = Math.max(0, 1500 - elapsed);

            loaderTimersRef.current.minTimer = setTimeout(() => {
                setLoaderFading(true);
                // גלילה ל-08:00 ברגע שהלוח מוצג
                requestAnimationFrame(() => {
                    scrollToEightRef.current();
                    setTimeout(() => scrollToEightRef.current(), 100);
                });
                loaderTimersRef.current.fadeTimer = setTimeout(() => {
                    setShowLoader(false);
                    setLoaderFading(false);
                    logger.initDone(9, 'Calendar fully interactive');
                    logger.initSummary(loaderStartRef.current);
                    // v2 boot health — same elapsed initSummary reports (inert until Axiom sink active)
                    logger.health('boot_ok', { ms: Date.now() - loaderStartRef.current });
                }, 400);
            }, remaining);
            return;
        }

        // טעינות הבאות - שכבת טעינה שקופה
        if (initialLoadDone.current) {
            if (eventsLoading && !wasLoading) {
                // התחלת טעינה
                setViewChangeLoading(true);
                setViewChangeFading(false);
            } else if (!eventsLoading && wasLoading) {
                // סיום טעינה - fade out + גלילה ל-08:00
                setViewChangeFading(true);
                requestAnimationFrame(() => {
                    scrollToEightRef.current();
                    setTimeout(() => scrollToEightRef.current(), 100);
                });
                loaderTimersRef.current.viewFadeTimer = setTimeout(() => {
                    setViewChangeLoading(false);
                    setViewChangeFading(false);
                }, 300);
            }
        }

        return () => {
            // ניקוי טיימרים רק לפני שהטעינה הראשונה הסתיימה
            if (!initialLoadDone.current) {
                clearTimeout(loaderTimersRef.current.minTimer);
                clearTimeout(loaderTimersRef.current.fadeTimer);
            }
            clearTimeout(loaderTimersRef.current.viewFadeTimer);
        };
    }, [eventsLoading]);

    // Watchdog — אם הלואדר עדיין מוצג אחרי 10 שניות, מבטלים אותו בכל מצב
    // מונע מצב שבו loadEvents לא נקרא (למשל כשחסרות הגדרות) והאפליקציה תקועה
    useEffect(() => {
        const watchdog = setTimeout(() => {
            if (!initialLoadDone.current) {
                logger.warn('MondayCalendar', 'Watchdog: loader stuck after 10s, forcing dismiss');
                initialLoadDone.current = true;
                if (!isMobile) setFilterEnabled(true); // הפעלת פילטרים גם במצב fallback (לא במובייל)
                setLoaderFading(true);
                requestAnimationFrame(() => {
                    scrollToEightRef.current();
                    setTimeout(() => scrollToEightRef.current(), 100);
                });
                setTimeout(() => {
                    setShowLoader(false);
                    setLoaderFading(false);
                }, 400);
            }
        }, 10000);

        return () => clearTimeout(watchdog);
    }, []);

    // גלילה ל-8:00 במובייל אחרי שהלוח מוצג
    // react-big-calendar's scrollToTime לא תמיד עובד במובייל ובמיוחד ב-three_day view
    useEffect(() => {
        if (!isMobile || showLoader) return;
        // ניסיונות חוזרים כדי לתפוס את הרגע שה-DOM מוכן
        const timers = [
            setTimeout(() => scrollToEightRef.current(), 50),
            setTimeout(() => scrollToEightRef.current(), 200),
            setTimeout(() => scrollToEightRef.current(), 500),
            setTimeout(() => scrollToEightRef.current(), 1000),
        ];
        return () => timers.forEach(clearTimeout);
    }, [isMobile, showLoader]);

    // טעינת הגדרות מ-Monday
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settingsResponse = await monday.get("settings");
                const settingsData = settingsResponse.data || {};
                setSettings(settingsData);
                logger.info('MondayCalendar', 'Loaded settings', settingsData);

                // חילוץ מזהי עמודות
                const ids = getColumnIds(settingsData);
                setColumnIds(ids);
                logger.debug('MondayCalendar', 'Column IDs', ids);
            } catch (error) {
                logger.error('MondayCalendar', 'Error loading settings', error);
            }
        };

        loadSettings();
    }, [monday]);

    // טעינת אירועים בפתיחה ראשונית ובעדכון הגדרות
    useEffect(() => {
        if (effectiveBoardId && customSettings?.dateColumnId && calendarFilter.isInitialized) {
            // טעינת השבוע הנוכחי כברירת מחדל
            const now = new Date();
            const currentWeekStart = new Date(now);
            // מציאת יום תחילת השבוע לפי weekStartDay
            const dayOfWeek = now.getDay();
            const daysFromStart = (dayOfWeek - weekStartDay + 7) % 7;
            currentWeekStart.setDate(now.getDate() - daysFromStart);
            currentWeekStart.setHours(0, 0, 0, 0);

            // מציאת יום אחרון בשבוע העבודה (offset של היום האחרון ב-workDays מ-weekStartDay)
            const maxOffset = Math.max(...workDays.map(d => (d - weekStartDay + 7) % 7));
            const currentWeekEnd = new Date(currentWeekStart);
            currentWeekEnd.setDate(currentWeekStart.getDate() + maxOffset);
            currentWeekEnd.setHours(23, 59, 59, 999);

            // שמירת טווח התצוגה הראשוני
            setCurrentViewRange({ start: currentWeekStart, end: currentWeekEnd });
            loadEvents(currentWeekStart, currentWeekEnd, calendarFilter.filterRules);

            // טעינת היעדרויות Day-off לחלון הראשוני (W4.2) — onRangeChange של
            // react-big-calendar נורה רק בניווט/החלפת תצוגה, לא ב-mount; בלי
            // הקריאה כאן השכבה הייתה מופיעה רק אחרי הניווט הראשון
            loadDayOffAbsences(currentWeekStart, currentWeekEnd);
        }
    }, [effectiveBoardId, customSettings?.dateColumnId, calendarFilter.isInitialized]);

    // רענון אירועים כשהפילטר או ה-mapping משתנים
    useEffect(() => {
        if (currentViewRange && calendarFilter.isInitialized) {
            loadEvents(currentViewRange.start, currentViewRange.end, calendarFilter.filterRules);
        }
    }, [calendarFilter.filterRules, customSettings.eventTypeMapping]);

    // רענון שכבת ההיעדרויות כשדגלי/מיפוי ה-Day-off משתנים (W4.2) — מקביל
    // לאפקט רענון האירועים שמעל; הטעינה השוטפת קורית ב-handleRangeChange.
    // ההוק עצמו מנקה את השכבה כשה-gating כבוי (showAbsences/מיפוי חסר)
    useEffect(() => {
        if (currentViewRange) {
            loadDayOffAbsences(currentViewRange.start, currentViewRange.end);
        }
    }, [
        customSettings.showAbsences,
        customSettings.dayOffBoardId,
        customSettings.dayOffPersonColumnId,
        customSettings.dayOffStartDateColumnId,
        customSettings.dayOffEndDateColumnId,
        customSettings.dayOffKindColumnId,
        customSettings.dayOffKindGeneralLabelId,
        customSettings.dayOffKindPersonalLabelId,
        customSettings.dayOffTypeColumnId,
        customSettings.dayOffApprovalRequired,
        customSettings.dayOffApprovalColumnId,
        customSettings.dayOffApprovedLabelIds,
        customSettings.dayOffPendingLabelIds,
        customSettings.dayOffRejectedLabelIds
    ]);

    // אימות הגדרות בעת עליית האפליקציה
    useEffect(() => {
        const runValidation = async () => {
            // מחכים שהטעינה תסתיים לפני אימות - מונע אימות נגד ברירות מחדל ריקות
            if (settingsLoading || !effectiveBoardId || !customSettings || hasValidatedSettings) {
                return;
            }

            logger.info('MondayCalendar', 'Running settings validation...');

            try {
                const validationResult = await validateSettings(monday, customSettings, effectiveBoardId);
                setSettingsValidation(validationResult);
                setHasValidatedSettings(true);
                logger.initDone(8, 'Settings validated');

                if (!validationResult.isValid) {
                    logger.warn('MondayCalendar', 'Settings validation failed', validationResult);

                    // בהתקנה ראשונה - לא להציג דיאלוג, האשף מטפל בהגדרה
                    if (!isFirstInstall) {
                        setShowValidationDialog(true);
                    }
                } else {
                    logger.info('MondayCalendar', 'Settings validation passed');
                    
                    // הצגת אזהרות אם יש
                    if (validationResult.warnings.length > 0) {
                        validationResult.warnings.forEach(warning => {
                            logger.warn('MondayCalendar', warning);
                        });
                    }
                }
            } catch (error) {
                logger.error('MondayCalendar', 'Error during settings validation', error);
            }
        };

        runValidation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customSettings is read inside but stabilized via SettingsContext deep compare
    }, [settingsLoading, effectiveBoardId, monday, hasValidatedSettings, isFirstInstall]);

    // מיגרציה אוטומטית של מיפוי סוגי דיווח
    useEffect(() => {
        const migrateEventTypeMapping = async () => {
            if (customSettings.eventTypeMapping || !customSettings.eventTypeStatusColumnId || !effectiveBoardId) return;

            try {
                logger.info('MondayCalendar', 'Attempting auto-migration of event type mapping...');

                // שליפת לייבלים מהעמודה
                const query = `query {
                    boards(ids: [${effectiveBoardId}]) {
                        columns(ids: ["${customSettings.eventTypeStatusColumnId}"]) {
                            settings
                        }
                    }
                }`;
                const res = await safeApi(monday, 'MondayCalendar:migrateEventTypeMapping', query);
                const settingsStr = res?.data?.boards?.[0]?.columns?.[0]?.settings;

                if (!settingsStr) {
                    logger.warn('MondayCalendar', 'Could not fetch column settings for migration');
                    return;
                }

                const labels = parseStatusColumnLabels(settingsStr);
                if (labels.length === 0) return;

                const result = createLegacyMapping(labels);
                if (result) {
                    await updateSettings({
                        eventTypeMapping: result.mapping,
                        eventTypeLabelMeta: result.labelMeta
                    });
                    logger.info('MondayCalendar', 'Auto-migration completed successfully', result);
                } else {
                    logger.warn('MondayCalendar', 'Auto-migration could not create valid mapping from existing labels');
                }
            } catch (error) {
                logger.error('MondayCalendar', 'Error during event type mapping migration', error);
            }
        };

        migrateEventTypeMapping();
    }, [customSettings.eventTypeMapping, customSettings.eventTypeStatusColumnId, effectiveBoardId]);

    // מיגרציה: עדכון צבעי labelMeta אם חסרים (labels_colors לא נקראו בעבר)
    useEffect(() => {
        const migrateLabelMetaColors = async () => {
            if (!customSettings.eventTypeLabelMeta || !customSettings.eventTypeStatusColumnId || !effectiveBoardId) return;

            // בדיקה אם יש לייבלים עם צבע ריק
            const hasEmptyColors = Object.values(customSettings.eventTypeLabelMeta).some(meta => !meta.color);
            if (!hasEmptyColors) return;

            try {
                logger.info('MondayCalendar', 'Migrating labelMeta colors from column settings...');
                const query = `query {
                    boards(ids: [${effectiveBoardId}]) {
                        columns(ids: ["${customSettings.eventTypeStatusColumnId}"]) {
                            settings
                        }
                    }
                }`;
                const res = await safeApi(monday, 'MondayCalendar:migrateLabelMetaColors', query);
                const settingsStr = res?.data?.boards?.[0]?.columns?.[0]?.settings;
                if (!settingsStr) return;

                const labels = parseStatusColumnLabels(settingsStr);
                if (labels.length === 0) return;

                // עדכון צבעים חסרים ב-labelMeta
                const updatedMeta = { ...customSettings.eventTypeLabelMeta };
                let updated = false;
                for (const labelObj of labels) {
                    const key = String(labelObj.id);
                    if (updatedMeta[key] && !updatedMeta[key].color && labelObj.color) {
                        updatedMeta[key] = { ...updatedMeta[key], color: labelObj.color };
                        updated = true;
                    }
                }

                if (updated) {
                    await updateSettings({ eventTypeLabelMeta: updatedMeta });
                    logger.info('MondayCalendar', 'LabelMeta colors updated successfully');
                }
            } catch (error) {
                logger.error('MondayCalendar', 'Error migrating labelMeta colors', error);
            }
        };

        migrateLabelMetaColors();
    }, [customSettings.eventTypeLabelMeta, customSettings.eventTypeStatusColumnId, effectiveBoardId]);

    // מיגרציה אוטומטית של מיפוי אישור (3 קטגוריות → 4)
    useEffect(() => {
        if (!customSettings.approvalStatusMapping || !customSettings.enableApproval) return;

        const migratedMapping = migrateApprovalMapping(customSettings.approvalStatusMapping);
        if (migratedMapping) {
            logger.info('MondayCalendar', 'Migrating approval mapping from 3 to 4 categories');
            updateSettings({ approvalStatusMapping: migratedMapping });
        }
    }, [customSettings.approvalStatusMapping, customSettings.enableApproval]);

    // --- Helper functions ---

    // useUndoState / useCalendarSelection / useApproval — אוחדו ל-useMondayCalendarHooks למעלה (גל 5.1.4)

    // --- Event handlers ---

    // Hook לניהול handlers של גרירה ושינוי גודל
    const calendarHandlers = useCalendarHandlers({
        updateEventPosition,
        showSuccess,
        showError,
        showWarning,
        showErrorWithDetails
    });

    // Hook לטעינת נתוני אירוע לעריכה
    const { loadEventDataForEdit } = useEventDataLoader({
        context,
        modals
    });

    // Hook לניהול אירועים יומיים
    const allDayEvents = useAllDayEvents({
        monday,
        context,
        modals,
        showSuccess,
        showError,
        showWarning,
        loadEvents,
        addEvent,
        resolvePendingEvent,
        removePendingEvent,
        currentViewRange
    });

    // לחיצה על אירוע קיים - פתיחת Modal לעריכה, המרה, או בחירה מרובה
    const handleEventClick = useCallback(async (event) => {
        logger.functionStart('handleEventClick', { eventId: event.id, title: event.title, isCtrlPressed: multiSelect.isCtrlPressed, isTemporary: event.isTemporary });

        // אירועים בטעינה - לא ניתן ללחוץ עליהם
        if (event.isLoading) {
            return;
        }

        // היעדרויות Day-off הן read-only בתוך ה-tracker (W4.2, D10).
        // לחיצה על יום *אישי* פותחת את הבקשה בטאב חדש בתוך Day-off דרך deep-link
        // ({dayOffAppUrl}?app[itemId]={itemId} — ראו ../Day-off/DEEPLINK.md). ימים כלליים
        // (ימי חברה) ומצב חסר baseUrl תקין נשארים בהתעלמות שקטה כמו קודם.
        if (event.isDayOff) {
            if (event.dayOffKind === 'personal') {
                const deepLink = buildDayOffDeepLink(customSettings.dayOffAppUrl, event.dayOffItemId);
                if (deepLink) {
                    logger.debug('handleEventClick', 'Opening personal day-off in Day-off (new tab)', { itemId: event.dayOffItemId });
                    window.open(deepLink, '_blank', 'noopener,noreferrer');
                    return;
                }
            }
            logger.debug('handleEventClick', 'Day-off absence clicked - ignored', { title: event.title, kind: event.dayOffKind });
            return;
        }

        // מצב בחירה לאישור מנהל - בחירת אירועים ממתינים
        if (approvalSelection.isSelectionMode && event.isPending) {
            approvalSelection.toggleSelection(event.id);
            return;
        }

        // בחירה מרובה עם CTRL/CMD - רק לאירועים שעתיים (לא יומיים)
        const isAllDayEvent = event.allDay;

        // מובייל — בולעים את ה-click הסינתטי שנוצר ע"י long-press (אחרת היינו פותחים מודל מיד אחרי overlay)
        if (isMobile && longPressFiredRef.current) {
            longPressFiredRef.current = false;
            return;
        }

        if (multiSelect.isCtrlPressed && !isAllDayEvent) {
            multiSelect.toggleSelection(event.id);
            return; // לא פותחים modal בבחירה מרובה
        }

        // לחיצה רגילה - ניקוי בחירה קודמת
        if (multiSelect.hasSelection) {
            multiSelect.clearSelection();
        }

        if (isAllDayEvent) {
            // פתיחת AllDayEventModal במצב עריכה
            modals.openAllDayModalForEdit(event);
            return;
        }

        // אירוע מתוכנן (Temporary) - פתיחת EventModal במצב המרה
        if (event.isTemporary) {
            logger.debug('handleEventClick', 'Opening convert mode for temporary event', { eventId: event.id });
            modals.openEventModalForConvert(event);
            return;
        }

        // אירוע רגיל - פתיחת EventModal
        modals.openEventModalForEdit(event);

        // טעינת נתוני האירוע לעריכה ברקע
        loadEventDataForEdit(event).catch(error => {
            showErrorWithDetails(error, { functionName: 'handleEventClick:loadEventData' });
        });
    }, [loadEventDataForEdit, multiSelect, modals, approvalSelection, showErrorWithDetails, isMobile, customSettings.dayOffAppUrl]);

    // לחיצה על סלוט ריק או גרירה - פתיחת Modal
    const onSelectSlot = useCallback(async ({ start, end, slots, allDay, action }) => {
        logger.functionStart('onSelectSlot', { start, end, allDay, action });

        // לחיצה על משבצת ריקה במובייל מבטלת סימון של אירוע קיים
        if (isMobile && selectedEventId) {
            setSelectedEventId(null);
        }

        // בדיקה אם זו לחיצה על all-day area - לוגיקה משופרת וגמישה יותר
        const isAllDayClick = allDay === true || 
            (start.getHours() === 0 && start.getMinutes() === 0 && 
             end.getHours() === 0 && end.getMinutes() === 0 &&
             Math.abs(end.getTime() - start.getTime() - 86400000) < 60000); // הפרש של בערך 24 שעות (סטייה של עד דקה)
        
        if (isAllDayClick) {
            logger.debug('onSelectSlot', 'All-day event clicked', { start });
            modals.openAllDayModal(start);
            return;
        }
        
        // בדיקה אם זמן ההתחלה הוא בעתיד - רק לאירועים שעתיים
        const now = new Date();
        if (start > now) {
            showWarning(t('toasts.futureTimeBlocked'));
            logger.debug('onSelectSlot', 'Blocked future time slot selection', { start, now });
            return;
        }
        
        // עיגול זמנים ל-15 דקות הקרוב
        const roundedStart = roundToNearest15Minutes(start);
        const roundedEnd = roundToNearest15Minutes(end);
        
        // הגדרת זמן מינימלי דינמי: שעה ללחיצה (משבצת אחת) וחצי שעה לגרירה (ריבוי משבצות)
        const isDrag = slots && slots.length > 1;
        const minDurationMinutes = isDrag ? 30 : 60;
        const minDurationMs = minDurationMinutes * 60 * 1000;
        
        const selectedDuration = roundedEnd.getTime() - roundedStart.getTime();
        
        // אם משך הזמן שנבחר קטן מהמינימום שהגדרנו, נרחיב אותו למינימום
        const finalEnd = selectedDuration < minDurationMs 
            ? new Date(roundedStart.getTime() + minDurationMs)
            : roundedEnd;
        
        modals.openEventModal({ start: roundedStart, end: finalEnd });

        // הפרויקטים נטענים אוטומטית דרך useProjects hook
    }, [monday, settings, context, modals, showWarning, isMobile, selectedEventId, setSelectedEventId, t]);

    // Tap-to-create ידני למובייל — rbc חוסם short-tap על touch (touchend מבטל את ה-selection
    // לפני שעובר longPressThreshold), אז אנחנו מטפלים ב-tap קצר באופן ידני: מחשבים את
    // הזמן מתוך מיקום הקליק על העמודה ופותחים את ה-modal הרלוונטי.
    const handleCalendarTap = useCallback((e) => {
        if (!isMobile) return;
        const target = e.target;
        // לא מטפלים בקליקים על אירועים, כפתורים, או overlay
        if (!target.closest) return;
        if (target.closest('.rbc-event')) return;
        if (target.closest('button')) return;
        if (target.closest('.rbc-toolbar')) return;
        if (target.closest('input, textarea, select')) return;

        // לחיצה על תא all-day → חישוב היום ספציפי (לפי x-position) ופתיחת AllDayEventModal
        const allDayCell = target.closest('.rbc-allday-cell');
        if (allDayCell) {
            const numDays = calendarView === 'three_day' ? 3 : 1;
            let dayDate = calendarDate;
            if (numDays > 1) {
                const cellRect = allDayCell.getBoundingClientRect();
                const relX = Math.max(0, Math.min(cellRect.width - 1, e.clientX - cellRect.left));
                const visualIdx = Math.floor((relX / cellRect.width) * numDays);
                // RTL: visualIdx 0 = leftmost, אבל calendarDate מתחיל מימין → היפוך
                const dayOffset = numDays - 1 - visualIdx;
                dayDate = new Date(calendarDate.getTime() + dayOffset * 86400000);
            }
            modals.openAllDayModal(dayDate);
            return;
        }

        // לחיצה על עמודת היום (גריד שעות) → חישוב הזמן ופתיחת EventModal
        const daySlot = target.closest('.rbc-day-slot');
        if (!daySlot) return;
        const rect = daySlot.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        if (clickY < 0 || clickY > rect.height) return;
        const minMin = minTime.getHours() * 60 + minTime.getMinutes();
        const maxMin = maxTime.getHours() * 60 + maxTime.getMinutes();
        const totalMin = maxMin - minMin;
        const ratio = clickY / rect.height;
        const offsetMin = Math.round((ratio * totalMin) / 15) * 15;
        const start = new Date(calendarDate);
        start.setHours(0, 0, 0, 0);
        start.setMinutes(minMin + offsetMin);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        // משתמשים ב-onSelectSlot הקיים — מקבל future-check + עיגול + min-duration
        onSelectSlot({ start, end, slots: [start], allDay: false, action: 'click' });
    }, [isMobile, modals, calendarDate, calendarView, minTime, maxTime, onSelectSlot]);

    // --- Modal handlers ---

    const handleCreateEvent = async (eventData) => {
        const pendingSlot = modals.eventModal.pendingSlot;
        if (!pendingSlot || !eventData?.title) {
            logger.warn('handleCreateEvent', 'Missing required data for event creation');
            showWarning(t('toasts.missingDataCreate'));
            return;
        }

        // סגירת המודאל מיד — השלד יופיע בלוח
        captureBeforeState(pendingSlot.start);
        modals.closeEventModal();

        try {
            const newEvent = await createEvent(eventData, pendingSlot.start, pendingSlot.end);
            // יצירה כושלת שלא זרקה (החזירה falsy) — לא מציגים הצלחה/חגיגה כוזבת.
            // הכשל כבר נרשם והוצג בתוך createEvent (רשומה אחת, טוסט אחד דרך ה-UI sink) —
            // אין רישום/הצגה נוספים כאן (איחוד A-double, ui-sink-plan.md).
            if (!newEvent) {
                return;
            }
            const celebrated = checkCelebration(pendingSlot.start, newEvent);
            if (!celebrated) showSuccess(t('toasts.eventCreated'));
            monthlyHours.refetch();
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'handleCreateEvent' });
        }
    };

    // עדכון אירוע קיים
    const handleUpdateEvent = async (eventData) => {
        const eventToEdit = modals.eventModal.eventToEdit;
        const pendingSlot = modals.eventModal.pendingSlot;
        if (!eventToEdit || !pendingSlot || !eventData?.title) {
            logger.warn('handleUpdateEvent', 'Missing required data for event update');
            showWarning(t('toasts.missingDataUpdate'));
            return;
        }

        // EventModal סוגר את עצמו סינכרונית לאחר onUpdate; אסור לקרוא closeEventModal
        // אחרי ה-await — זה עלול לסגור מודאל אחר שהמשתמש פתח בינתיים.
        try {
            await updateEvent(eventToEdit.id, eventData, pendingSlot.start, pendingSlot.end);
            showSuccess(t('toasts.eventUpdated'));
            monthlyHours.refetch();
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'handleUpdateEvent' });
        }
    };

    // מחיקת אירוע — עם undo
    const handleDeleteEvent = () => {
        const eventToEdit = modals.eventModal.eventToEdit;
        if (!eventToEdit || !eventToEdit.mondayItemId) {
            // רשומה אחת שנושאת את הודעת המשתמש — ה-UI sink מציג ממנה את הטוסט
            // (במקום showError צמוד שהיה יוצר טוסט כפול; איחוד A-double)
            logger.error('handleDeleteEvent', 'Missing event ID for deletion', new Error(t('toasts.deleteEventNotFound')));
            return;
        }

        modals.closeEventModal();
        const removed = removeEventsFromState([eventToEdit.id]);
        undoDelete.scheduleDelete(removed);
        monthlyHours.refetch();
    };

    // המרת אירוע מתוכנן (Temporary) לאירוע רגיל
    const handleConvertEvent = async (eventData) => {
        const eventToEdit = modals.eventModal.eventToEdit;
        const pendingSlot = modals.eventModal.pendingSlot;
        if (!eventToEdit || !pendingSlot || !eventData?.title) {
            logger.warn('handleConvertEvent', 'Missing required data for event conversion');
            showWarning(t('toasts.missingDataConvert'));
            return;
        }

        try {
            logger.functionStart('handleConvertEvent', { eventId: eventToEdit.id, eventData });

            captureBeforeState(pendingSlot.start);

            // עדכון האירוע הקיים - הסטטוס יעודכן בהתאם לבחירת המשתמש בטופס
            // (שעתי/לא לחיוב עם סיווג משני, או חופשה/מחלה/מילואים לאירועים יומיים)
            await updateEvent(eventToEdit.id, {
                ...eventData,
                isBillable: eventData.isBillable !== false
            }, pendingSlot.start, pendingSlot.end);

            // אירוע סינתטי לבדיקת חגיגה — ההמרה מוסיפה שעות אמיתיות
            const convertedEvent = {
                start: pendingSlot.start,
                end: pendingSlot.end,
                allDay: false,
                isTemporary: false,
                isDayOff: false
            };
            const celebrated = checkCelebration(pendingSlot.start, convertedEvent);
            if (!celebrated) showSuccess(t('toasts.eventConverted'));

            monthlyHours.refetch();
            // EventModal כבר נסגר סינכרונית; לא לסגור שוב אחרי await (עלול לסגור מודאל חדש)
            logger.functionEnd('handleConvertEvent', { eventId: eventToEdit.id });
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'handleConvertEvent' });
        }
    };

    // --- All-day event handlers (extracted for error handling + memoization) ---

    const handleCreateAllDayEvent = useCallback(async (allDayData) => {
        try {
            const isBulkReports = allDayData.type === 'reports';
            if (isBulkReports) {
                captureBeforeState(new Date(allDayData.date));
            }
            await allDayEvents.handleCreateAllDayEvent(allDayData);
            if (isBulkReports) {
                const totalHours = allDayData.reports.reduce((sum, r) => sum + (parseFloat(r.hours) || 0), 0);
                const eventDate = new Date(allDayData.date);
                eventDate.setHours(8, 0, 0, 0);
                const syntheticEvent = {
                    start: eventDate,
                    end: new Date(eventDate.getTime() + totalHours * 3600000),
                    allDay: false
                };
                const celebrated = checkCelebration(new Date(allDayData.date), syntheticEvent);
                if (!celebrated) showSuccess(t('toasts.reportsCreated'));
            }
            monthlyHours.refetch();
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'handleCreateAllDayEvent' });
        }
    }, [allDayEvents, captureBeforeState, checkCelebration, showSuccess, monthlyHours, showErrorWithDetails, t]);

    const handleUpdateAllDayEvent = useCallback(async (newType) => {
        // הגנת עומק (W4.2): היעדרויות Day-off הן read-only — לעולם לא מתעדכנות
        // מה-tracker (המודל ממילא לא נפתח עבורן — ראו handleEventClick)
        if (modals.allDayModal.eventToEdit?.isDayOff) {
            logger.warn('handleUpdateAllDayEvent', 'Attempted to update a read-only day-off absence - ignored', { eventId: modals.allDayModal.eventToEdit.id });
            return;
        }
        try {
            await allDayEvents.handleUpdateAllDayEvent(newType);
            monthlyHours.refetch();
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'handleUpdateAllDayEvent' });
        }
    }, [allDayEvents, monthlyHours, showErrorWithDetails, modals]);

    // מחיקת אירוע יומי — עם undo
    const handleDeleteAllDayEvent = useCallback(() => {
        const event = modals.allDayModal.eventToEdit;
        // הגנת עומק (W4.2): היעדרויות Day-off הן read-only — לא נמחקות מה-tracker
        if (event?.isDayOff) {
            logger.warn('handleDeleteAllDayEvent', 'Attempted to delete a read-only day-off absence - ignored', { eventId: event.id });
            return;
        }
        if (!event || !event.mondayItemId) {
            // רשומה אחת שנושאת את הודעת המשתמש — ראו handleDeleteEvent (איחוד A-double)
            logger.error('handleDeleteAllDayEvent', 'Missing event ID for deletion', new Error(t('toasts.deleteEventNotFound')));
            return;
        }

        modals.closeAllDayModal();
        const removed = removeEventsFromState([event.id]);
        undoDelete.scheduleDelete(removed);
        monthlyHours.refetch();
    }, [modals, removeEventsFromState, undoDelete, monthlyHours, t]);

    // multi-select / context-menu handlers — חולצו ל-useCalendarSelection (גל 5.1.2)

    // עדכון שעת התחלה
    const handleStartTimeChange = (option) => {
        const pendingSlot = modals.eventModal.pendingSlot;
        if (!pendingSlot || !option) return;
        
        const [hours, minutes] = option.value.split(':').map(Number);
        const newStart = new Date(pendingSlot.start);
        newStart.setHours(hours, minutes, 0, 0);
        
        // עיגול ל-15 דקות
        const roundedStart = roundToNearest15Minutes(newStart);
        
        // וידוא שהמשך מינימלי הוא 60 דקות
        const minDuration = 60 * 60 * 1000; // 60 דקות במילישניות
        let newEnd = new Date(pendingSlot.end);
        
        if (roundedStart >= newEnd || (newEnd.getTime() - roundedStart.getTime()) < minDuration) {
            newEnd = new Date(roundedStart.getTime() + minDuration);
        }
        
        modals.setPendingSlot({ ...pendingSlot, start: roundedStart, end: newEnd });
    };

    // עדכון שעת סיום
    const handleEndTimeChange = (option) => {
        const pendingSlot = modals.eventModal.pendingSlot;
        if (!pendingSlot || !option) return;
        
        const [hours, minutes] = option.value.split(':').map(Number);
        const newEnd = new Date(pendingSlot.end);
        newEnd.setHours(hours, minutes, 0, 0);
        
        // עיגול ל-15 דקות
        const roundedEnd = roundToNearest15Minutes(newEnd);
        
        // וידוא שהמשך מינימלי הוא 60 דקות
        const minDuration = 60 * 60 * 1000; // 60 דקות במילישניות
        const duration = roundedEnd.getTime() - pendingSlot.start.getTime();
        const finalEnd = duration < minDuration 
            ? new Date(pendingSlot.start.getTime() + minDuration)
            : roundedEnd;
        
        modals.setPendingSlot({ ...pendingSlot, end: finalEnd });
    };

    // עדכון תאריך
    const handleDateChange = (date) => {
        const pendingSlot = modals.eventModal.pendingSlot;
        if (!pendingSlot || !date) return;
        
        const jsDate = date instanceof Date ? date : date.toDate?.() || date;
        
        const newStart = new Date(pendingSlot.start);
        newStart.setFullYear(jsDate.getFullYear(), jsDate.getMonth(), jsDate.getDate());
        
        const newEnd = new Date(pendingSlot.end);
        newEnd.setFullYear(jsDate.getFullYear(), jsDate.getMonth(), jsDate.getDate());
        
        modals.setPendingSlot({ ...pendingSlot, start: newStart, end: newEnd });
    };

    // טיפול בשינוי טווח תאריכים (ניווט בלוח)
    const handleRangeChange = useCallback((range) => {
        logger.debug('handleRangeChange', 'Range changed', range);

        // גלילה מיידית ל-08:00 למניעת קפיצה נראית
        requestAnimationFrame(() => {
            scrollToEightRef.current();
        });

        let start, end;

        if (Array.isArray(range)) {
            // במצב Week או Day - מערך של תאריכים
            start = range[0];
            end = range[range.length - 1];
        } else {
            // במצב Month - אובייקט עם start ו-end
            start = range.start;
            end = range.end;
        }

        if (start && end) {
            // שמירת טווח התצוגה הנוכחי לשימוש בלחיצה על all-day
            setCurrentViewRange({ start, end });
            loadEvents(start, end, calendarFilter.filterRules);

            // טעינת היעדרויות Day-off לטווח (W4.2) — שכבת תצוגה נפרדת (D10);
            // ה-gating המלא (showAbsences + מיפוי הלוח) חי בתוך ההוק, כולל ניקוי בכיבוי
            loadDayOffAbsences(start, end);
        }
    }, [loadEvents, loadDayOffAbsences, calendarFilter.filterRules]);

    // פיצ'ר אירועים עתידיים זמין כאשר עמודת סוג דיווח מוגדרת (לייבל "עתידי" הוא חובה)
    const hasTemporaryEventsFeature = !!customSettings.eventTypeStatusColumnId;

    // Toggle handler לאירועים מתוכננים
    const handleToggleTemporaryEvents = useCallback(() => {
        setShowTemporaryEvents(prev => !prev);
    }, []);

    // Ref לשמירת נתוני הפילטר - מאפשר גישה לערכים עדכניים בלי לשנות את ה-callback reference
    const filterDataRef = useRef({});
    filterDataRef.current = {
        reporters,
        filterProjects,
        calendarFilter,
        loadingReporters,
        loadingFilterProjects,
        onOpenSettings,
        onOpenProjectColors,
        onSwitchToDashboard,
        monday,
        customSettings,
        columnIds,
        events,
        isOwner,
        showTemporaryEvents,
        handleToggleTemporaryEvents,
        hasTemporaryEventsFeature,
        approval,
        approvalSelection,
        monthlyHours,
        hasIncompleteSettings
    };

    // Long-press על אירוע במובייל — פותח את ה-MobileResizeOverlay (גרירה/שינוי גודל עם ידיות)
    // initialTouchY מועבר כדי שה-overlay יוכל להמשיך את הגרירה ברציפות
    // מאותה אצבע — בלי שהמשתמש ישחרר וילחץ שוב
    const [overlayInitialTouchY, setOverlayInitialTouchY] = useState(null);
    const handleEventLongPress = useCallback((event, opts) => {
        if (event.isLoading || event.allDay) return;
        // היעדרויות Day-off — read-only (W4.2, D10)
        if (event.isDayOff) return;
        if (approvalSelection.isSelectionMode) return; // long-press מושבת במצב בחירה
        longPressFiredRef.current = true;
        setOverlayInitialTouchY(opts?.initialClientY ?? null);
        setSelectedEventId(event.id);
    }, [approvalSelection.isSelectionMode, setSelectedEventId]);

    // CustomEvent עם props מוזרקים (onLongPress + isMobile) דרך wrapper יציב
    const CustomEventWithProps = useCallback((props) => (
        <CustomEvent {...props} onLongPress={handleEventLongPress} isMobile={isMobile} />
    ), [handleEventLongPress, isMobile]);

    // Custom Toolbar עם גישה ל-props
    // שימוש ב-ref כדי לשמור על reference יציב ולמנוע re-mount של FilterBar
    const CustomToolbarWithProps = useCallback((props) => {
        const data = filterDataRef.current;

        // הכנת props לפילטר
        const filterProps = {
            reporters: data.reporters,
            projects: data.filterProjects,
            selectedReporterIds: data.calendarFilter.selectedReporterIds,
            selectedProjectIds: data.calendarFilter.selectedProjectIds,
            onReporterChange: data.calendarFilter.setSelectedReporterIds,
            onProjectChange: data.calendarFilter.setSelectedProjectIds,
            onClear: data.calendarFilter.clearFilters,
            hasActiveFilter: data.calendarFilter.hasActiveFilter,
            isLoadingReporters: data.loadingReporters,
            isLoadingProjects: data.loadingFilterProjects,
            showTemporaryEvents: data.showTemporaryEvents,
            onToggleTemporaryEvents: data.handleToggleTemporaryEvents,
            hasTemporaryEventsFeature: data.hasTemporaryEventsFeature
        };

        // הכנת props לבטרייה
        const mh = data.monthlyHours;
        const batteryProps = mh ? {
            breakdown: mh.breakdown,
            totalHours: mh.totalHours,
            targetHours: mh.targetHours,
            loading: mh.loading
        } : null;

        return (
            <CalendarToolbar
                {...props}
                onOpenSettings={data.onOpenSettings}
                onOpenProjectColors={data.onOpenProjectColors}
                onSwitchToDashboard={data.onSwitchToDashboard}
                monday={data.monday}
                customSettings={data.customSettings}
                columnIds={data.columnIds}
                events={data.events}
                isOwner={data.isOwner}
                filterProps={filterProps}
                batteryProps={batteryProps}
                isManager={data.approval.isManager}
                isApprovalEnabled={data.approval.isApprovalEnabled}
                isSelectionMode={data.approvalSelection.isSelectionMode}
                onToggleSelectionMode={data.approvalSelection.toggleSelectionMode}
                onApproveAllInWeek={data.approval.approveAllInWeek}
                hasIncompleteSettings={data.hasIncompleteSettings}
            />
        );
    }, []); // ללא dependencies - reference יציב, מונע re-mount של FilterBar

    // פונקציה לקביעת עיצוב האירוע
    const eventStyleGetter = useCallback((event) => ({
        // encode event ID in className so the wrapper onContextMenu can find it
        className: `rbc-event-id-${event.id}`,
        style: {
            backgroundColor: 'transparent',
            border: 'none',
            display: 'block'
        }
    }), []);

    // העשרת האירועים עם isSelected לשימוש ב-CustomEvent
    // מסנן אירועים מתוכננים אם הטוגל כבוי
    const enrichedEvents = useMemo(() => {
        // חישוב נעילה - מנהלים פטורים
        const lockMode = customSettings.editLockMode || 'none';
        const lockDays = customSettings.editLockDays;
        const managerBypass = approval.isManager;
        const isApprovalEnabled = !!customSettings.enableApproval;

        const lockAfterApproval = !!customSettings.lockAfterApproval;

        let regularEvents = events.map(ev => {
            let lockResult = (!managerBypass && lockMode !== 'none')
                ? isEventLocked(ev, lockMode, lockDays)
                : { locked: false, reasonKey: '' };
            // נעילה לאחר אישור מנהל — רק אירועים במצב "ממתין" ניתנים לעריכה
            if (!lockResult.locked && lockAfterApproval && isApprovalEnabled && !managerBypass) {
                if (!ev.isPending) {
                    lockResult = { locked: true, reasonKey: 'approval.lockReason' };
                }
            }
            // כשאישור מנהל כבוי - ביטול כל דגלי האישור למניעת שקיפות מיותרת
            const effectivePending = isApprovalEnabled && ev.isPending;
            return {
                ...ev,
                isPending: effectivePending,
                isRejected: isApprovalEnabled && ev.isRejected,
                isApproved: isApprovalEnabled && ev.isApproved,
                isSelected: multiSelect.isSelected(ev.id),
                isInApprovalSelection: approvalSelection.isSelectionMode && effectivePending,
                isApprovalSelected: approvalSelection.isSelected(ev.id),
                isLocked: lockResult.locked,
                lockReason: lockResult.locked && lockResult.reasonKey ? t(lockResult.reasonKey, lockResult.reasonParams) : '',
                onContextMenu: (e) => handleEventContextMenu(e, ev),
                isOverlayActive: isMobile && ev.id === selectedEventId
            };
        });

        // סינון אירועים מתוכננים אם הטוגל כבוי
        if (!showTemporaryEvents) {
            regularEvents = regularEvents.filter(ev => !ev.isTemporary);
        }

        // היעדרויות Day-off (W4.2) — שכבת תצוגה נפרדת עם דגל משלה (D10).
        // ה-gating המלא חי בתוך useDayOffAbsences; הבדיקה כאן מסתירה
        // מיידית בכיבוי showAbsences בלי להמתין ל-refetch
        const dayOffOverlay = (customSettings.showAbsences !== false && dayOffAbsences.length > 0)
            ? dayOffAbsences
            : [];

        return dayOffOverlay.length > 0 ? [...regularEvents, ...dayOffOverlay] : regularEvents;
    }, [events, multiSelect, approvalSelection, dayOffAbsences, customSettings.showAbsences, customSettings.editLockMode, customSettings.editLockDays, customSettings.enableApproval, customSettings.eventTypeMapping, customSettings.lockAfterApproval, approval.isManager, showTemporaryEvents, isMobile, selectedEventId, handleEventContextMenu]);

    // לחיצה ימנית על resize handle — נמצא מחוץ ל-CustomEvent, לכן bubbles עד wrapper זה
    // חייב להיות מוגדר אחרי enrichedEvents (תלוי בו) כדי למנוע TDZ בbundle
    const handleCalendarContextMenu = useCallback((e) => {
        const rbcEventEl = e.target.closest('.rbc-event');
        if (!rbcEventEl) return;

        const classMatch = rbcEventEl.className.match(/rbc-event-id-([^\s]+)/);
        if (!classMatch) return;

        const eventId = classMatch[1];
        const calEvent = enrichedEvents.find(ev => String(ev.id) === eventId);
        if (!calEvent) return;

        e.preventDefault();
        handleEventContextMenu(e, calEvent);
    }, [enrichedEvents, handleEventContextMenu]);

    // פונקציה לקביעת גובה משבצות זמן (כדי לדרוס חישובי inline של BCR)
    const slotPropGetter = useCallback(() => ({
        style: {
            minHeight: '10px', // 40px לשעה / 4 משבצות של 15 דקות
        }
    }), []);

    // פונקציה לקביעת גובה עמודות יום
    const dayPropGetter = useCallback(() => ({
        style: {
            minHeight: isMobile ? '720px' : '960px',
        }
    }), [isMobile]);

    // Accessors לקביעה אילו אירועים ניתנים לגרירה ולשינוי גודל
    const draggableAccessor = useCallback((event) => {
        if (event.isLoading) return false;
        // היעדרויות Day-off — read-only (W4.2, D10)
        if (event.isDayOff) return false;
        if (event.isLocked) return false;
        return true;
    }, []);

    const resizableAccessor = useCallback((event) => {
        // במובייל אנו מספקים UI עצמאי ל-resize (לחיצה ארוכה + ידיות פינתיות) במקום הידיות הקטנות של RBC
        if (isMobile) return false;
        if (event.isLoading) return false;
        // היעדרויות Day-off — read-only (W4.2, D10)
        if (event.isDayOff) return false;
        if (event.isLocked) return false;
        return true;
    }, [isMobile]);

    // עדכון גובה דינמי לאזור all-day לפי מספר השורות בפועל
    // הספרייה react-big-calendar מסדרת את האירועים בשורות לפי חפיפות בתאריכים
    // לכן קוראים את מספר השורות מה-DOM
    useEffect(() => {
        const updateAllDayHeight = () => {
            const rowContent = document.querySelector('.rbc-allday-cell .rbc-row-content');
            if (!rowContent) return;
            
            // ספירת שורות (.rbc-row) בתוך ה-row-content שיש בהן אירועים
            const rows = Array.from(rowContent.querySelectorAll('.rbc-row'));
            const rowCountWithEvents = rows.filter(row => row.querySelector('.rbc-event')).length;
            
            // אם אין שורות עם אירועים, בודקים אם יש אירועים ישירות
            let actualRowCount = rowCountWithEvents;
            if (rowCountWithEvents === 0) {
                const directEvents = rowContent.querySelectorAll('.rbc-event');
                actualRowCount = directEvents.length > 0 ? 1 : 0;
            }
            
            // חישוב גובה לאזור all-day
            // כל שורה: 23px גובה אירוע + 2px הפרדה = 25px
            // + 25px ריק בתחתית ללחיצה
            // + 4px הרווח העליון מתחת לעיגול התאריך (padding-top על rbc-row-content, header.css)
            const rowHeight = 25; // 23px אירוע + 2px margin
            const topGap = 4;
            let height;
            if (actualRowCount === 0) {
                height = topGap + rowHeight; // שורה ריקה
            } else if (actualRowCount === 1) {
                height = topGap + rowHeight + rowHeight; // שורה אחת + ריק
            } else {
                height = topGap + actualRowCount * rowHeight + rowHeight; // כל השורות + ריק
            }
            
            const allDayCells = document.querySelectorAll('.rbc-allday-cell');
            allDayCells.forEach(cell => {
                cell.style.height = `${height}px`;
            });
        };
        
        // עדכון אחרי שהספרייה מרנדרת (צריך לחכות לרינדור)
        const timer1 = setTimeout(updateAllDayHeight, 50);
        const timer2 = setTimeout(updateAllDayHeight, 200);
        const timer3 = setTimeout(updateAllDayHeight, 500);
        
        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
            clearTimeout(timer3);
        };
    }, [events]);

    return (
        <div
            className="gcCalendarRoot"
            style={{ height: '100%', padding: isMobile ? '0' : '0 20px', direction: dir, display: 'flex', flexDirection: 'column', position: 'relative' }}
            onClick={isMobile ? handleCalendarTap : undefined}
            {...(isMobile ? swipeHandlers : {})}
        >
            {showLoader && !loaderFading && (
                <div className={loaderStyles.overlay}>
                    <StopwatchLoader size={80} />
                    <p className={loaderStyles.brandText}>Powered by Twyst</p>
                </div>
            )}
            {loaderFading && (
                <div className={loaderStyles.overlayFadeOut}>
                    <StopwatchLoader size={80} />
                    <p className={loaderStyles.brandText}>Powered by Twyst</p>
                </div>
            )}
            {isMobile && (
                <div
                    ref={swipePeekRef}
                    className="gc-swipe-peek"
                    aria-hidden="true"
                >
                    <span className="gc-peek-day"></span>
                    <span className="gc-peek-num"></span>
                </div>
            )}
            <div ref={swipeContentRef} className="gc-calendar-content" style={{ flex: 1, display: showLoader && !loaderFading ? 'none' : 'flex', flexDirection: 'column', height: '100%', position: 'relative', willChange: isMobile ? 'transform' : undefined }} onContextMenu={handleCalendarContextMenu}>
                {/* שכבת טעינה חצי-שקופה למעברי תצוגה */}
                {viewChangeLoading && !viewChangeFading && (
                    <div className={loaderStyles.viewChangeOverlay}>
                        <StopwatchLoader size={80} />
                    </div>
                )}
                {viewChangeFading && (
                    <div className={loaderStyles.viewChangeOverlayFadeOut}>
                        <StopwatchLoader size={80} />
                    </div>
                )}
                <DnDCalendar
                    localizer={localizer}
                    events={enrichedEvents}
                    startAccessor="start"
                    endAccessor="end"
                    allDayAccessor="allDay"
                    style={{ height: '100%' }}
                    culture={culture}
                    rtl={!isLtr}
                    messages={calendarMessages}
                    formats={formats}
                    date={calendarDate}
                    onNavigate={setCalendarDate}
                    view={calendarView}
                    onView={setCalendarView}
                    defaultView={defaultView}
                    views={calendarViews}
                    touchDragDelay={isMobile ? 300 : 0}
                    longPressThreshold={isMobile ? 300 : 250}
                    min={minTime}
                    max={maxTime}
                    scrollToTime={isMobile ? new Date(1970, 1, 1, 9, 0, 0) : CALENDAR_DEFAULTS.SCROLL_TO_TIME}
                    showMultiDayTimes={false}
                    onDragStart={calendarHandlers.onDragStart}
                    onEventDrop={calendarHandlers.onEventDrop}
                    onEventResize={calendarHandlers.onEventResize}
                    onSelectEvent={handleEventClick}
                    resizable
                    draggableAccessor={draggableAccessor}
                    resizableAccessor={resizableAccessor}
                    selectable
                    onSelectSlot={onSelectSlot}
                    onRangeChange={handleRangeChange}
                    step={15}
                    timeslots={4}
                    dayLayoutAlgorithm="overlap"
                    eventPropGetter={eventStyleGetter}
                    slotPropGetter={slotPropGetter}
                    dayPropGetter={dayPropGetter}
                    drilldownView={isMobile ? 'day' : null}
                    components={{
                        toolbar: CustomToolbarWithProps,
                        event: CustomEventWithProps,
                        header: (isMobile && calendarView === 'day') ? EmptyHeader : CustomDayHeaderForCulture,
                        month: { header: MonthHeaderForCulture },
                        // במובייל בלבד — תאריך פינתי בכותרת ה-time-gutter (סגנון Google Calendar)
                        timeGutterHeader: isMobile ? TimeGutterHeaderFactory(calendarDate, t, dateFnsLocale, language) : undefined
                    }}
                />
                {isMobile && selectedEventId && (() => {
                    const ev = enrichedEvents.find(e => e.id === selectedEventId);
                    if (!ev || ev.allDay) return null;
                    return (
                        <MobileResizeOverlay
                            event={ev}
                            initialTouchY={overlayInitialTouchY}
                            onCancel={() => { setSelectedEventId(null); setOverlayInitialTouchY(null); }}
                            onCommit={(newStart, newEnd) => {
                                calendarHandlers.onEventResize({ event: ev, start: newStart, end: newEnd });
                                setSelectedEventId(null);
                                setOverlayInitialTouchY(null);
                            }}
                            onMove={(newStart, newEnd) => {
                                calendarHandlers.onEventDrop({ event: ev, start: newStart, end: newEnd, isAllDay: false });
                                setSelectedEventId(null);
                                setOverlayInitialTouchY(null);
                            }}
                        />
                    );
                })()}
            </div>

            {modals.eventModal.isOpen && (
                <Suspense fallback={null}>
                    <EventModal
                        isOpen={modals.eventModal.isOpen}
                        onClose={modals.closeEventModal}
                        pendingSlot={modals.eventModal.pendingSlot}
                        monday={monday}
                        context={context}
                        projects={projects}
                        loadingProjects={isLoadingProjects}
                        projectsError={projectsError}
                        newEventTitle={modals.eventModal.newEventTitle}
                        setNewEventTitle={modals.setNewEventTitle}
                        selectedItem={modals.eventModal.selectedItem}
                        setSelectedItem={modals.setSelectedItem}
                        onStartTimeChange={handleStartTimeChange}
                        onEndTimeChange={handleEndTimeChange}
                        onDateChange={handleDateChange}
                        onCreate={handleCreateEvent}
                        eventToEdit={modals.eventModal.eventToEdit}
                        isEditMode={modals.eventModal.isEditMode}
                        isConvertMode={modals.eventModal.isConvertMode}
                        isLoadingEventData={modals.eventModal.isLoading}
                        onUpdate={handleUpdateEvent}
                        onDelete={handleDeleteEvent}
                        onConvert={handleConvertEvent}
                        isManager={approval.isManager}
                        isApprovalEnabled={approval.isApprovalEnabled}
                        onApprove={approval.approveEventWithFeedback}
                        onReject={approval.rejectEventWithFeedback}
                        isLocked={modals.eventModal.eventToEdit?.isLocked || false}
                        lockReason={modals.eventModal.eventToEdit?.lockReason || ''}
                    />
                </Suspense>
            )}

            {modals.allDayModal.isOpen && (
                <Suspense fallback={null}>
                    <AllDayEventModal
                        monday={monday}
                        context={context}
                        isOpen={modals.allDayModal.isOpen}
                        projects={projects}
                        loadingProjects={isLoadingProjects}
                        onClose={modals.closeAllDayModal}
                        pendingDate={modals.allDayModal.date}
                        onCreate={handleCreateAllDayEvent}
                        eventToEdit={modals.allDayModal.eventToEdit}
                        isEditMode={modals.allDayModal.isEditMode}
                        onUpdate={handleUpdateAllDayEvent}
                        onDelete={handleDeleteAllDayEvent}
                        isManager={approval.isManager}
                        isApprovalEnabled={approval.isApprovalEnabled}
                        onApprove={approval.approveEventWithFeedback}
                        onReject={approval.rejectEventWithFeedback}
                        isLocked={modals.allDayModal.eventToEdit?.isLocked || false}
                        lockReason={modals.allDayModal.eventToEdit?.lockReason || ''}
                    />
                </Suspense>
            )}

            {/* Toast Notifications */}
            <ToastContainer 
                toasts={toasts} 
                onRemove={removeToast}
                onShowErrorDetails={openErrorDetailsModal}
            />
            
            {/* Error Details Modal */}
            <ErrorDetailsModal
                isOpen={!!errorDetailsModal}
                onClose={closeErrorDetailsModal}
                errorDetails={errorDetailsModal}
            />

            {/* Settings Validation Dialog */}
            <SettingsValidationDialog
                isOpen={showValidationDialog}
                onClose={() => setShowValidationDialog(false)}
                onOpenSettings={onOpenSettings}
                validationResult={settingsValidation}
                isOwner={isOwner}
            />

            {/* Selection Action Bar - תפריט פעולות לאירועים נבחרים */}
            {multiSelect.hasSelection && (
                <Suspense fallback={null}>
                    <SelectionActionBar
                        selectedCount={multiSelect.selectedCount}
                        onDuplicate={handleDuplicateSelected}
                        onDelete={handleDeleteSelected}
                        onClear={multiSelect.clearSelection}
                        isProcessing={multiSelect.isProcessingBulk}
                    />
                </Suspense>
            )}

            {/* Approval Action Bar - סרגל אישור מנהל לאירועים נבחרים */}
            {approvalSelection.selectedCount > 0 && (
                <Suspense fallback={null}>
                    <ApprovalActionBar
                        selectedCount={approvalSelection.selectedCount}
                        onApprove={approval.approveSelected}
                        onClear={approvalSelection.clearSelection}
                        isProcessing={approval.isProcessingApproval}
                    />
                </Suspense>
            )}

            {/* Undo Banner - באנר ביטול מחיקה (slot מאוחד מ-useUndoState — גל 5.1.3) */}
            <UndoBanner {...undoBanner} />

            {/* Context Menu - תפריט לחיצה ימנית */}
            {contextMenu.isOpen && (
                <Suspense fallback={null}>
                    <ContextMenu
                        isOpen={contextMenu.isOpen}
                        position={contextMenu.position}
                        onDelete={handleContextMenuDelete}
                        onClose={closeContextMenu}
                    />
                </Suspense>
            )}
        </div>
    );
}
