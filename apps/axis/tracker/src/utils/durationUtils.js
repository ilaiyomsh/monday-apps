/**
 * פונקציות עזר לניהול Duration פולימורפי
 * - אירועים שעתיים: duration = שעות (עשרוני)
 * - אירועים יומיים: duration = ימים (מספר שלם)
 */

import { isAllDayIndex } from './eventTypeMapping';
import logger from './logger';

/**
 * בדיקה אם הערך הוא אובייקט Date תקין (לא Invalid Date)
 * @param {*} date
 * @returns {boolean}
 */
const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());

/**
 * בדיקה אם סוג האירוע הוא יומי (לא שעתי)
 * @param {number|string} eventTypeIndex - אינדקס הלייבל בעמודת Status
 * @param {Object} [mapping] - מיפוי סוגי דיווח (אופציונלי)
 * @returns {boolean}
 */
export const isAllDayEventType = (eventTypeIndex, mapping) => {
    if (mapping) {
        return isAllDayIndex(eventTypeIndex, mapping);
    }
    return false;
};

/**
 * חישוב הפרש ימים בין שני תאריכים
 * משתמש ב-Math.ceil כדי לעגל מעלה (למנוע באגים של שעון קיץ/חורף)
 * @param {Date} start - תאריך התחלה
 * @param {Date} end - תאריך סיום
 * @returns {number} - מספר הימים (מינימום 1)
 */
export const calculateDaysDiff = (start, end) => {
    if (!isValidDate(start) || !isValidDate(end)) {
        logger.warn('durationUtils', 'calculateDaysDiff: תאריך התחלה/סיום לא תקין', { start, end });
        return 1; // ברירת מחדל בטוחה: יום אחד
    }
    const diffMs = Math.abs(end.getTime() - start.getTime());
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // 86400000 ms ביום
    return Math.max(1, days); // מינימום יום אחד
};

/**
 * חישוב תאריך סיום מתאריך התחלה ומספר ימים
 * הסיום הוא Exclusive (כנדרש ע"י react-big-calendar לאירועי allDay)
 * דוגמה: התחלה ב-1 לחודש + 3 ימים = סיום ב-4 לחודש בחצות
 * @param {Date} start - תאריך התחלה
 * @param {number} durationDays - מספר ימים
 * @returns {Date} - תאריך סיום (Exclusive)
 */
export const calculateEndDateFromDays = (start, durationDays) => {
    if (!isValidDate(start)) {
        logger.warn('durationUtils', 'calculateEndDateFromDays: תאריך התחלה לא תקין', { start, durationDays });
        return new Date(NaN); // Invalid Date — נתפס ע"י guards של הפורמטרים בנתיב הכתיבה
    }
    const end = new Date(start);
    end.setHours(0, 0, 0, 0); // איפוס לחצות
    end.setDate(end.getDate() + Math.max(1, durationDays));
    return end;
};

/**
 * פרסור duration לפי סוג האירוע
 * @param {number|string} durationValue - ערך ה-duration מה-DB
 * @param {string} eventType - סוג האירוע
 * @param {Object} [mapping] - מיפוי סוגי דיווח (אופציונלי)
 * @returns {object} - { value: number, unit: 'hours' | 'days' }
 */
export const parseDuration = (durationValue, eventType, mapping) => {
    const numValue = parseFloat(durationValue) || 0;

    if (isAllDayEventType(eventType, mapping)) {
        // אירוע יומי - הערך מייצג ימים
        // תאימות אחורה: duration=0 נחשב כיום אחד
        return {
            value: numValue === 0 ? 1 : Math.max(1, Math.round(numValue)),
            unit: 'days'
        };
    } else {
        // אירוע שעתי - הערך מייצג שעות
        return {
            value: numValue,
            unit: 'hours'
        };
    }
};

/**
 * המרת duration לפורמט לשמירה ב-monday
 * @param {number} value - ערך המשך
 * @param {string} eventType - סוג האירוע
 * @param {Object} [mapping] - מיפוי סוגי דיווח (אופציונלי)
 * @returns {string} - ערך לשמירה (עשרוני לשעות, שלם לימים)
 */
export const formatDurationForSave = (value, eventType, mapping) => {
    const numValue = Number(value);
    if (!Number.isFinite(numValue)) {
        logger.warn('durationUtils', 'formatDurationForSave: ערך משך לא תקין', { value, eventType });
        return ''; // מונע כתיבת "NaN" לעמודת המספרים
    }
    if (isAllDayEventType(eventType, mapping)) {
        // ימים - מספר שלם
        return Math.max(1, Math.round(numValue)).toString();
    } else {
        // שעות - עשרוני
        return numValue.toFixed(2);
    }
};
