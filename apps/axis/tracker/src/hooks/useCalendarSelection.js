import { useState, useCallback } from 'react';
import { useMultiSelect } from './useMultiSelect';
import { useEventSelection } from './useEventSelection';
import logger from '../utils/logger';

// Hook המאחד את הבחירה בלוח השנה (גל 5.1.2 — F005):
// - בחירה מרובה רגילה (CTRL/CMD) דרך useMultiSelect לשכפול/מחיקה
// - בחירה לאישור מנהל דרך useEventSelection (approvalSelection)
// - selectedEventId — אירוע שנבחר במובייל ל-MobileResizeOverlay
// - contextMenu — תפריט לחיצה ימנית
// - handlers לשכפול/מחיקה/תפריט הקשר
//
// הערה (5.1.2): הספק לא הזכיר effect שמאפס את selectedEventId על שינוי תצוגה
// (5.1.0 דיווח שהשאיר אותו ל-5.1.2). בקריאה חוזרת של MondayCalendar.jsx
// לא קיים effect כזה — selectedEventId מתאפס רק בקליק / ב-overlay onCancel/onCommit/onMove.
// לכן לא הועבר effect כזה.
export const useCalendarSelection = ({
    events,
    createEvent,
    removeEventsFromState,
    undoDelete,
    monthlyHours,
    showSuccess,
    showErrorWithDetails,
    t,
}) => {
    // אירוע מסומן במובייל (long-press פותח overlay עם ידיות, tap רגיל פותח מודל לעריכה)
    const [selectedEventId, setSelectedEventId] = useState(null);

    // בחירה מרובה רגילה (CTRL/CMD) — שכפול/מחיקה
    const multiSelect = useMultiSelect();

    // בחירה לאישור מנהל
    const approvalSelection = useEventSelection();

    // תפריט לחיצה ימנית
    const [contextMenu, setContextMenu] = useState({ isOpen: false, position: { x: 0, y: 0 }, event: null });

    // שכפול אירועים נבחרים
    const handleDuplicateSelected = useCallback(async () => {
        if (!multiSelect.hasSelection) return;

        multiSelect.setIsProcessingBulk(true);
        logger.functionStart('handleDuplicateSelected', { count: multiSelect.selectedCount });

        try {
            const selectedEvents = events.filter(e => multiSelect.isSelected(e.id) && !e.allDay);
            let successCount = 0;
            let failureCount = 0;
            let lastError = null;

            for (const event of selectedEvents) {
                try {
                    const eventData = {
                        title: event.title,
                        itemId: event.projectId,
                        taskId: event.taskId,
                        notes: event.notes,
                        stageId: event.stageId,
                        isBillable: event.isBillable !== false,
                        nonBillableType: event.nonBillableType
                    };

                    await createEvent(eventData, event.start, event.end);
                    successCount++;
                } catch (err) {
                    failureCount++;
                    lastError = err;
                    logger.error('handleDuplicateSelected', `Failed to duplicate event ${event.id}`, err);
                }
            }

            if (successCount > 0) {
                showSuccess(t('toasts.eventsDuplicated', { count: successCount }));
            }

            // כשל מלא או חלקי — מציגים הודעה ממופה (אחרת השכפול נכשל בשקט).
            // נמנעים מהצגה כשלא נבחרו אירועים שעתיים כלל (selectedEvents ריק).
            // ה-Error כבר נרשם בלולאה; showErrorWithDetails לא יכפיל (dedup דרך __loggedId).
            if (failureCount > 0) {
                showErrorWithDetails(lastError || new Error(t('toasts.duplicateEventsError')), { functionName: 'handleDuplicateSelected' });
            }

            // ניקוי הבחירה
            multiSelect.clearSelection();
            logger.functionEnd('handleDuplicateSelected', { successCount, failureCount });
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'handleDuplicateSelected' });
        } finally {
            multiSelect.setIsProcessingBulk(false);
        }
    }, [multiSelect, events, createEvent, showSuccess, showErrorWithDetails, t]);

    // מחיקת אירועים נבחרים — עם undo
    const handleDeleteSelected = useCallback(() => {
        if (!multiSelect.hasSelection) return;

        logger.functionStart('handleDeleteSelected', { count: multiSelect.selectedCount });

        const idsToDelete = multiSelect.getSelectedArray();
        const removed = removeEventsFromState(idsToDelete);
        multiSelect.clearSelection();
        undoDelete.scheduleDelete(removed);
        monthlyHours.refetch();

        logger.functionEnd('handleDeleteSelected', { count: removed.length });
    }, [multiSelect, removeEventsFromState, undoDelete, monthlyHours]);

    // לחיצה ימנית על אירוע — פתיחת תפריט
    const handleEventContextMenu = useCallback((e, calendarEvent) => {
        e.preventDefault();
        if (calendarEvent.isLoading) return;
        // היעדרויות Day-off — read-only (W4.2, D10)
        if (calendarEvent.isDayOff) return;

        setContextMenu({
            isOpen: true,
            position: { x: e.clientX, y: e.clientY },
            event: calendarEvent
        });
    }, []);

    // מחיקה מתפריט לחיצה ימנית — עם undo
    const handleContextMenuDelete = useCallback(() => {
        const ev = contextMenu.event;
        setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, event: null });

        if (!ev) return;

        const removed = removeEventsFromState([ev.id]);
        undoDelete.scheduleDelete(removed);
        monthlyHours.refetch();
    }, [contextMenu.event, removeEventsFromState, undoDelete, monthlyHours]);

    const closeContextMenu = useCallback(() => {
        setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, event: null });
    }, []);

    return {
        multiSelect,
        approvalSelection,
        selectedEventId,
        setSelectedEventId,
        contextMenu,
        handlers: {
            handleDuplicateSelected,
            handleDeleteSelected,
            handleEventContextMenu,
            handleContextMenuDelete,
            closeContextMenu,
        },
    };
};
