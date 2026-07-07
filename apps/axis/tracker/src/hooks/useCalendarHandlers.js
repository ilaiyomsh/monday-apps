import { useCallback, useEffect, useRef } from 'react';
import { useStableT } from '../i18n/useStableT';
import logger from '../utils/logger';

/**
 * Hook לניהול handlers של לוח השנה
 * @param {Object} params - פרמטרים
 * @param {Function} params.updateEventPosition - עדכון מיקום אירוע
 * @param {Function} params.showSuccess - הצגת הודעת הצלחה
 * @param {Function} params.showError - הצגת הודעת שגיאה
 * @param {Function} params.showWarning - הצגת הודעת אזהרה
 * @param {Function} params.showErrorWithDetails - הצגת שגיאה עם פרטים
 * @returns {Object} handlers לשימוש בלוח השנה
 */
export const useCalendarHandlers = ({
    updateEventPosition,
    showSuccess,
    showError,
    showWarning,
    showErrorWithDetails
}) => {
    const t = useStableT();

    // מניעת גלילה בזמן גרירת אירוע יומי
    const scrollLockRef = useRef(null);

    // מניעת גרירה בזמן ריסייז — ממתינים ל-DOM להתייצב
    const isResizingRef = useRef(false);
    const resizeTimerRef = useRef(null);

    // משך מינימלי לאירוע שעתי. מתחת לזה react-big-calendar מתייחס לאירוע כ-0-duration
    // וב-DnD addon (common.js:eventTimes) מוסיף לו 24h בגרירה הבאה — מוביל לאירוע פגום בלוח.
    const MIN_TIMED_DURATION_MS = 15 * 60 * 1000;

    /**
     * התחלת גרירה - נועל גלילה לאירועי allDay
     */
    // ref לניקוי RAF loop ב-unmount
    const dragCleanupRef = useRef(null);

    const onDragStart = useCallback(({ event }) => {
        // חסימת גרירה בזמן debounce לאחר ריסייז
        if (isResizingRef.current) {
            return;
        }

        if (event?.allDay) {
            const timeContent = document.querySelector('.rbc-time-content');
            if (timeContent) {
                // שמירת מיקום הגלילה הנוכחי
                const savedScrollTop = timeContent.scrollTop;
                scrollLockRef.current = savedScrollTop;

                // נעילת הגלילה באמצעות requestAnimationFrame לביצועים טובים
                let isLocked = true;
                let rafId = null;
                const lockScroll = () => {
                    if (isLocked && scrollLockRef.current !== null) {
                        timeContent.scrollTop = scrollLockRef.current;
                        rafId = requestAnimationFrame(lockScroll);
                    }
                };
                rafId = requestAnimationFrame(lockScroll);

                // שחרור הנעילה כשהגרירה מסתיימת
                const unlock = () => {
                    isLocked = false;
                    scrollLockRef.current = null;
                    if (rafId) cancelAnimationFrame(rafId);
                    dragCleanupRef.current = null;
                    document.removeEventListener('mouseup', unlock);
                    document.removeEventListener('touchend', unlock);
                };
                // שמירת cleanup ref למקרה של unmount בזמן גרירה
                dragCleanupRef.current = unlock;
                document.addEventListener('mouseup', unlock);
                document.addEventListener('touchend', unlock);
            }
        }
    }, []);

    /**
     * גרירת אירוע קיים (הזזה)
     */
    const onEventDrop = useCallback(async ({ event, start, end, isAllDay }) => {
        try {
            // אירוע נעול - חסימת גרירה
            if (event.isLocked) {
                showWarning(event.lockReason || t('settings.additional.editLock.reasons.default'));
                return;
            }

            // אירוע יומי שנשאר יומי - עדכון תאריכים בלבד (גרירה אופקית)
            if (event.allDay && isAllDay) {
                logger.debug('onEventDrop', 'All-day event moved horizontally', { 
                    eventId: event.id, 
                    from: event.start, 
                    to: start 
                });
                await updateEventPosition(event, start, end);
                showSuccess(t('toasts.eventUpdated'));
                return;
            }
            
            // מניעת גרירת אירוע יומי לאזור השעתי
            if (event.allDay && !isAllDay) {
                showError(t('toasts.moveAllDayToTimedBlocked'));
                return;
            }
            
            // מניעת גרירת אירוע שעתי לאזור היומי
            if (!event.allDay && isAllDay) {
                showError(t('toasts.moveTimedToAllDayBlocked'));
                return;
            }
            
            // אירוע שעתי - בדיקה אם הזמן החדש הוא בעתיד
            const now = new Date();
            if (start > now) {
                showWarning(t('toasts.futureTimeBlocked'));
                logger.debug('onEventDrop', 'Blocked moving event to future', { start, now });
                return;
            }
            
            // אירוע שעתי - המשך כרגיל
            await updateEventPosition(event, start, end);
            showSuccess(t('toasts.eventUpdated'));
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'onEventDrop' });
        }
    }, [updateEventPosition, showSuccess, showError, showWarning, showErrorWithDetails, t]);

    /**
     * שינוי אורך אירוע (מתיחה) - אירועים שעתיים ויומיים
     * הוספת debounce לאחר ריסייז למניעת חוסר התאמה בקואורדינטות הגרירה
     */
    const onEventResize = useCallback(async ({ event, start, end }) => {
        try {
            // אירוע נעול - חסימת שינוי גודל
            if (event.isLocked) {
                showWarning(event.lockReason || t('settings.additional.editLock.reasons.default'));
                return;
            }

            // לאירועים יומיים - חישוב מספר הימים החדש (הרחבה אופקית)
            if (event.allDay) {
                const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
                logger.debug('onEventResize', `All-day event resized to ${days} days`, {
                    eventId: event.id,
                    start,
                    end,
                    days
                });
            } else if (end - start < MIN_TIMED_DURATION_MS) {
                // אירוע שעתי שכווץ מתחת ל-15 דק' — מצמיד את ה-end ל-start+15min.
                // 0-duration מפעיל ב-react-big-calendar קוד שמוסיף 24h ל-end בגרירה הבאה.
                end = new Date(start.getTime() + MIN_TIMED_DURATION_MS);
            }

            await updateEventPosition(event, start, end);
            
            // המתנה של 150ms לייצוב ה-DOM לאחר ריסייז
            isResizingRef.current = true;
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = setTimeout(() => { isResizingRef.current = false; }, 150);
            
            showSuccess(t('toasts.eventUpdated'));
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'onEventResize' });
        }
    }, [updateEventPosition, showSuccess, showErrorWithDetails, showWarning, t]);

    // ניקוי timeout של ריסייז ב-unmount
    useEffect(() => {
        return () => {
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        };
    }, []);

    // ניקוי RAF loop ב-unmount (למקרה שגרירה עדיין פעילה)
    const cleanup = useCallback(() => {
        if (dragCleanupRef.current) {
            dragCleanupRef.current();
        }
    }, []);

    return {
        onDragStart,
        onEventDrop,
        onEventResize,
        scrollLockRef,
        cleanup
    };
};

