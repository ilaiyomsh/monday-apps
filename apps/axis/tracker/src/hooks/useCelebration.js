/**
 * Hook לחגיגות קונפטי באבני דרך יומיות
 * - דיווח ראשון ביום
 * - 4 שעות מדווחות
 * - 8 שעות מדווחות (יום מלא)
 */

import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';
import logger from '../utils/logger';

/**
 * חישוב סך שעות מדווחות ליום מסוים (אירועים שעתיים בלבד)
 * @param {Array} events - מערך האירועים
 * @param {Date} date - התאריך לבדיקה
 * @returns {{ hours: number, count: number }}
 */
const getTimedHoursForDate = (events, date, extraEvent = null) => {
    const dateStr = date.toDateString();
    let hours = 0;
    let count = 0;

    const allEvents = extraEvent ? [...events, extraEvent] : events;

    for (const event of allEvents) {
        if (event.allDay || event.isTemporary) continue;
        // היעדרויות Day-off — לעולם לא נספרות כשעות (W4.2, D10)
        if (event.isDayOff) continue;
        if (event.start.toDateString() !== dateStr) continue;

        count++;
        hours += (event.end - event.start) / 3600000; // ms → שעות
    }

    return { hours, count };
};

/**
 * ירי קונפטי בעוצמה מותאמת
 */
const fireCelebration = (intensity) => {
    const defaults = {
        origin: { y: 0.7 },
        zIndex: 9999,
        disableForReducedMotion: true,
    };

    switch (intensity) {
        case 'small':
            confetti({ ...defaults, particleCount: 50, spread: 55 });
            break;
        case 'medium':
            confetti({ ...defaults, particleCount: 100, spread: 70 });
            break;
        case 'big':
            // ירי כפול משני הצדדים
            confetti({ ...defaults, particleCount: 100, spread: 70, origin: { x: 0.3, y: 0.7 } });
            confetti({ ...defaults, particleCount: 100, spread: 70, origin: { x: 0.7, y: 0.7 } });
            break;
        default:
            logger.warn('useCelebration', `Unknown celebration intensity: ${intensity}`);
            break;
    }
};

export const useCelebration = (events, showSuccess, workdayLength = 8.5) => {
    const { t } = useTranslation();
    // שמירת snapshot של שעות לפני יצירת אירוע
    const beforeStateRef = useRef(null);

    /**
     * לכידת מצב השעות לפני יצירת אירוע חדש
     * @param {Date} eventDate - תאריך האירוע שעומד להיווצר
     */
    const captureBeforeState = useCallback((eventDate) => {
        const { hours, count } = getTimedHoursForDate(events, eventDate);
        beforeStateRef.current = { hours, count, dateStr: eventDate.toDateString() };
    }, [events]);

    /**
     * בדיקה אם חציית אבן דרך והפעלת חגיגה
     * @param {Date} eventDate - תאריך האירוע שנוצר
     */
    /**
     * בדיקה אם חציית אבן דרך והפעלת חגיגה
     * @param {Date} eventDate - תאריך האירוע שנוצר
     * @param {Object|null} newEvent - האירוע החדש (לעקיפת stale closure)
     * @returns {boolean} האם הופעלה חגיגה (true = אין צורך בהודעת הצלחה רגילה)
     */
    const checkCelebration = useCallback((eventDate, newEvent = null) => {
        const before = beforeStateRef.current;
        if (!before || before.dateStr !== eventDate.toDateString()) return false;

        const after = getTimedHoursForDate(events, eventDate, newEvent);

        // דיווח ראשון ביום
        if (before.count === 0 && after.count > 0) {
            fireCelebration('small');
            showSuccess(t('celebration.dayStart'));
            beforeStateRef.current = null;
            return true;
        }

        // יום מלא — בדיקה לפני חצי יום כי שניהם יכולים להתקיים
        if (before.hours < workdayLength && after.hours >= workdayLength) {
            fireCelebration('big');
            showSuccess(t('celebration.fullDay'));
            beforeStateRef.current = null;
            return true;
        }

        // חצי יום
        const halfDay = workdayLength / 2;
        if (before.hours < halfDay && after.hours >= halfDay) {
            fireCelebration('medium');
            showSuccess(t('celebration.halfDay'));
            beforeStateRef.current = null;
            return true;
        }

        beforeStateRef.current = null;
        return false;
    }, [events, showSuccess, workdayLength, t]);

    return { captureBeforeState, checkCelebration };
};
