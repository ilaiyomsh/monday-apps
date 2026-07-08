import { useState, useCallback, useEffect, useRef } from 'react';
import { deleteItem } from '../utils/mondayApi';
import logger from '../utils/logger';

const UNDO_DURATION = 4000; // 4 שניות
const BATCH_SIZE = 5;

/**
 * Hook לניהול מחיקה עם undo
 * מאפשר מחיקה בודדת ומרובה עם אפשרות ביטול למשך 4 שניות
 *
 * @param {Object} params
 * @param {Object} params.monday - Monday SDK instance
 * @param {Function} params.restoreEvents - החזרת אירועים ל-state
 * @returns {Object} { isVisible, message, scheduleDelete, undoDelete }
 */
// הערה: showError הוסר — כשלי מחיקה מוצגים דרך ה-UI sink (נתיב הצגה יחיד)
export const useUndoDelete = ({ monday, restoreEvents }) => {
    const [pendingDelete, setPendingDelete] = useState(null);
    const timerRef = useRef(null);
    const pendingRef = useRef(null);
    const commitDeleteRef = useRef(null);

    // סנכרון ref עם state
    useEffect(() => {
        pendingRef.current = pendingDelete;
    }, [pendingDelete]);

    // מחיקה סופית מה-API
    const commitDelete = useCallback(async (eventsToDelete) => {
        if (!eventsToDelete || eventsToDelete.length === 0) return;

        logger.functionStart('useUndoDelete.commitDelete', { count: eventsToDelete.length });

        const failedEvents = [];

        try {
            // מחיקה ב-batches של 5
            for (let i = 0; i < eventsToDelete.length; i += BATCH_SIZE) {
                const batch = eventsToDelete.slice(i, i + BATCH_SIZE);
                const results = await Promise.allSettled(
                    batch.map(ev => deleteItem(monday, ev.mondayItemId || ev.id))
                );

                results.forEach((result, idx) => {
                    if (result.status === 'rejected') {
                        // מעבירים את ה-reason עצמו כשהוא Error — safeApi מטביע על השגיאה
                        // העטופה את ה-correlationId של הרשומה הקנונית, ולכן הרישום כאן
                        // מסומן duplicate (הטוסט כבר הוצג מהרשומה של safeApi דרך ה-sink).
                        const reason = result.reason;
                        const err = reason instanceof Error
                            ? reason
                            : Object.assign(new Error('מחיקת אירוע נכשלה'), { details: { eventId: batch[idx].id, reason } });
                        logger.error('useUndoDelete.commitDelete', `Deletion failed (event ${batch[idx].id})`, err);
                        failedEvents.push(batch[idx]);
                    }
                });
            }

            if (failedEvents.length > 0) {
                // הכשלים הפרטניים כבר הוצגו דרך ה-UI sink — אין סיכום-שגיאה נוסף
                // (נתיב הצגה יחיד); משחזרים את האירועים שנכשלו ללוח
                restoreEvents(failedEvents);
            }

            logger.functionEnd('useUndoDelete.commitDelete', { count: eventsToDelete.length - failedEvents.length, failed: failedEvents.length });
        } catch (error) {
            // שגיאה כללית — החזרת כל האירועים ל-state; הרשומה כאן מציגה את הטוסט דרך ה-sink
            logger.error('useUndoDelete.commitDelete', 'Error deleting events', error);
            restoreEvents(eventsToDelete);
        }
    }, [monday, restoreEvents]);

    // שמירת הגרסה העדכנית של commitDelete ב-ref לשימוש ב-cleanup
    commitDeleteRef.current = commitDelete;

    // תזמון מחיקה עם undo
    const scheduleDelete = useCallback((events) => {
        if (!events || events.length === 0) return;

        // אם יש undo קודם — מבצעים אותו מיד
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            if (pendingRef.current) {
                commitDelete(pendingRef.current.events);
            }
        }

        const message = events.length === 1
            ? 'האירוע נמחק'
            : `${events.length} אירועים נמחקו`;

        logger.info('useUndoDelete', 'Scheduling delete with undo', { count: events.length });

        setPendingDelete({ events, message });

        // טיימר למחיקה סופית
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const current = pendingRef.current;
            setPendingDelete(null);
            if (current) {
                commitDelete(current.events);
            }
        }, UNDO_DURATION);
    }, [commitDelete]);

    // ביטול המחיקה — החזרת האירועים
    const undoDelete = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        const current = pendingRef.current;
        setPendingDelete(null);

        if (current) {
            logger.info('useUndoDelete', 'Undo delete', { count: current.events.length });
            restoreEvents(current.events);
        }
    }, [restoreEvents]);

    // Cleanup — ב-unmount, מבצעים את המחיקה מיד
    // שימוש ב-commitDeleteRef (לא commitDelete) למניעת re-registration של effect בכל שינוי deps
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            if (pendingRef.current) {
                commitDeleteRef.current(pendingRef.current.events);
            }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- commitDeleteRef is a stable ref

    return {
        isVisible: !!pendingDelete,
        message: pendingDelete?.message || '',
        scheduleDelete,
        undoDelete
    };
};
