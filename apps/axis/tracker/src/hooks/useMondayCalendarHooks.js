// Hook הרכבה — Wave 5.1.4 (F005)
// מאחד את 8 ה-hooks המשותפים לרכיב MondayCalendar.jsx לקריאה אחת:
//   useToast, useMondayEvents, useCalendarFilter, useMonthlyHours,
//   useUndoState, useCalendarSelection, useApproval, useCalendarSwipe.
// המטרה: לצמצם את ה-prelude של רכיב הענק וליצור גבול ברור בין
// "תשתית-נתונים-ובחירה" (שמועברים פנימה לכאן) לבין JSX/effects שנשארים בצרכן.
// המוסיף לא משנה לוגיקה — רק מעביר את הסדר אל תוך ה-hook החדש.
// State צרכנים שדרוש כקלט (calendarDate / calendarView / currentViewRange)
// נשאר בבעלות הצרכן ומועבר כפרמטר, כדי שלא לשנות את גבולות ה-React state
// של MondayCalendar.jsx (deps של effects קיימים מצביעים עליהם).

import { useToast } from './useToast';
import { useMondayEvents } from './useMondayEvents';
import { useCalendarFilter } from './useCalendarFilter';
import { useMonthlyHours } from './useMonthlyHours';
import { useUndoState } from './useUndoState';
import { useCalendarSelection } from './useCalendarSelection';
import { useApproval } from './useApproval';
import { useCalendarSwipe } from './useCalendarSwipe';

export function useMondayCalendarHooks({
    monday,
    context,
    customSettings,
    t,
    isMobile,
    calendarDate,
    calendarView,
    setCalendarDate,
    currentViewRange,
}) {
    // Toasts — שירות הודעות משותף לכל ה-handlers
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
    } = useToast();

    // אירועים — קריאה ראשית, יוצרת ומעדכנת אירועים בלוח הדיווחים
    const {
        events,
        loading: eventsLoading,
        loadEvents,
        createEvent,
        updateEvent,
        updateEventPosition,
        addEvent,
        resolvePendingEvent,
        removePendingEvent,
        removeEventsFromState,
        restoreEvents,
    } = useMondayEvents(monday, context);

    // פילטר היומן — מקור filterRules ל-loadEvents ול-useApproval
    const calendarFilter = useCalendarFilter(customSettings, context);

    // סיכום שעות חודשי — תלוי ב-currentViewRange + calendarView, ומועבר ל-useCalendarSelection ול-CalendarToolbar
    const monthlyHours = useMonthlyHours(monday, context, currentViewRange, calendarView);

    // Undo — עוטף את useUndoDelete + מספק slot מוכן ל-<UndoBanner {...undoBanner} />
    // (showError הוסר — כשלי מחיקה מוצגים דרך ה-UI sink)
    const { undoDelete, banner: undoBanner } = useUndoState({
        monday,
        restoreEvents,
    });

    // Selection — multi-select / approval-selection / context-menu / handlers; צורך undoDelete ו-monthlyHours
    const selection = useCalendarSelection({
        events,
        createEvent,
        removeEventsFromState,
        undoDelete,
        monthlyHours,
        showSuccess,
        showErrorWithDetails,
        t,
    });

    // Approval — צורך approvalSelection מ-selection ואת filterRules מ-calendarFilter
    const approval = useApproval({
        monday,
        context,
        events,
        currentViewRange,
        filterRules: calendarFilter.filterRules,
        loadEvents,
        approvalSelection: selection.approvalSelection,
        toasts: { showSuccess, showError, showWarning, showErrorWithDetails },
        t,
    });

    // Swipe — finger-following בין שבועות במובייל
    const { swipeHandlers, swipeContentRef, swipePeekRef } = useCalendarSwipe({
        calendarDate,
        calendarView,
        setCalendarDate,
        isMobile,
    });

    return {
        // toasts
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
        // restoreEvents — לא נחשף החוצה: נצרך פנימית רק על ידי useUndoState למעלה
        // filter
        calendarFilter,
        // monthly hours
        monthlyHours,
        // undo
        undoDelete,
        undoBanner,
        // selection
        selection,
        // approval
        approval,
        // swipe
        swipeHandlers,
        swipeContentRef,
        swipePeekRef,
    };
}
