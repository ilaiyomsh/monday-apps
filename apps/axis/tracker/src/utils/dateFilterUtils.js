/**
 * כלי עזר לפילטר תאריכים בדשבורד
 * תומך בתנאים: שבוע, חודש, שנה, בין תאריכים
 */

import {
    startOfMonth, endOfMonth, addMonths,
    startOfWeek, endOfWeek, addWeeks,
    startOfYear, endOfYear, addYears,
    addDays,
    format
} from 'date-fns';
import { he } from 'date-fns/locale';
import logger from './logger';

/**
 * בדיקה אם הערך הוא אובייקט Date תקין (לא Invalid Date)
 * @param {*} date
 * @returns {boolean}
 */
const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());

/**
 * פורמט תאריך ל-YYYY-MM-DD
 */
const fmt = (d) => format(d, 'yyyy-MM-dd');

/**
 * פרסור עוגן תאריך מ-YYYY-MM-DD לאובייקט Date מקומי; מחזיר null (ומלוגג) אם לא תקין.
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} caller - שם הפונקציה הקוראת (ללוג)
 * @returns {Date|null}
 */
const parseAnchor = (dateFrom, caller) => {
    const anchor = new Date(dateFrom + 'T00:00:00');
    if (!isValidDate(anchor)) {
        logger.warn('dateFilterUtils', `${caller}: dateFrom לא תקין`, dateFrom);
        return null;
    }
    return anchor;
};

/**
 * בניית חוק פילטר GraphQL לתאריכים
 * @param {'between'|'exact'|'after'|'onOrAfter'|'before'|'onOrBefore'|'month'|'week'|'year'} condition
 * @param {string} dateColumnId
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} dateTo - YYYY-MM-DD
 * @returns {{ column_id: string, compare_value: any, operator: string }}
 */
export const buildDateFilterRule = (condition, dateColumnId, dateFrom, dateTo) => {
    // חוק ברירת מחדל — משמש גם כ-fallback כשהעוגן לא תקין
    const fallbackRule = {
        column_id: dateColumnId,
        compare_value: [dateFrom, dateTo],
        operator: 'between'
    };

    switch (condition) {
        case 'between':
            return fallbackRule;

        case 'day': {
            const anchor = parseAnchor(dateFrom, 'buildDateFilterRule');
            if (!anchor) return fallbackRule;
            const d = fmt(anchor);
            return {
                column_id: dateColumnId,
                compare_value: [d, d],
                operator: 'between'
            };
        }

        case 'month': {
            const anchor = parseAnchor(dateFrom, 'buildDateFilterRule');
            if (!anchor) return fallbackRule;
            return {
                column_id: dateColumnId,
                compare_value: [fmt(startOfMonth(anchor)), fmt(endOfMonth(anchor))],
                operator: 'between'
            };
        }

        case 'week': {
            const anchor = parseAnchor(dateFrom, 'buildDateFilterRule');
            if (!anchor) return fallbackRule;
            const weekStart = startOfWeek(anchor, { weekStartsOn: 0 });
            const weekEnd = endOfWeek(anchor, { weekStartsOn: 0 });
            return {
                column_id: dateColumnId,
                compare_value: [fmt(weekStart), fmt(weekEnd)],
                operator: 'between'
            };
        }

        case 'year': {
            const anchor = parseAnchor(dateFrom, 'buildDateFilterRule');
            if (!anchor) return fallbackRule;
            return {
                column_id: dateColumnId,
                compare_value: [fmt(startOfYear(anchor)), fmt(endOfYear(anchor))],
                operator: 'between'
            };
        }

        default:
            return fallbackRule;
    }
};

/**
 * חישוב טווח תאריכים אפקטיבי לפי תנאי
 * @param {string} condition
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} dateTo - YYYY-MM-DD
 * @returns {{ from: string, to: string }}
 */
export const getEffectiveDateRange = (condition, dateFrom, dateTo) => {
    const fallbackRange = { from: dateFrom, to: dateTo };

    switch (condition) {
        case 'day': {
            const anchor = parseAnchor(dateFrom, 'getEffectiveDateRange');
            if (!anchor) return fallbackRange;
            return { from: fmt(anchor), to: fmt(anchor) };
        }
        case 'month': {
            const anchor = parseAnchor(dateFrom, 'getEffectiveDateRange');
            if (!anchor) return fallbackRange;
            return { from: fmt(startOfMonth(anchor)), to: fmt(endOfMonth(anchor)) };
        }
        case 'week': {
            const anchor = parseAnchor(dateFrom, 'getEffectiveDateRange');
            if (!anchor) return fallbackRange;
            return {
                from: fmt(startOfWeek(anchor, { weekStartsOn: 0 })),
                to: fmt(endOfWeek(anchor, { weekStartsOn: 0 }))
            };
        }
        case 'year': {
            const anchor = parseAnchor(dateFrom, 'getEffectiveDateRange');
            if (!anchor) return fallbackRange;
            return { from: fmt(startOfYear(anchor)), to: fmt(endOfYear(anchor)) };
        }
        default:
            return fallbackRange;
    }
};

/**
 * הזזת תקופה קדימה/אחורה
 * @param {'month'|'week'|'year'} condition
 * @param {Date} anchorDate
 * @param {1|-1} direction - 1=הבא, -1=הקודם
 * @returns {Date}
 */
export const shiftPeriod = (condition, anchorDate, direction) => {
    switch (condition) {
        case 'day':
            return addDays(anchorDate, direction);
        case 'month':
            return addMonths(anchorDate, direction);
        case 'week':
            return addWeeks(anchorDate, direction);
        case 'year':
            return addYears(anchorDate, direction);
        default:
            return anchorDate;
    }
};

/**
 * תווית עברית לתקופה הנוכחית
 * @param {'month'|'week'|'year'} condition
 * @param {Date} anchorDate
 * @returns {string}
 */
export const formatPeriodLabel = (condition, anchorDate, dateFnsLocale = he) => {
    // formatPeriodLabel מקבל אובייקט Date (לא string) — guard מותנה למניעת זריקת RangeError מ-format
    if (!isValidDate(anchorDate)) {
        logger.warn('dateFilterUtils', 'formatPeriodLabel: anchorDate לא תקין', anchorDate);
        return '';
    }
    switch (condition) {
        case 'day':
            return format(anchorDate, 'EEEE, d MMMM yyyy', { locale: dateFnsLocale });

        case 'month':
            return format(anchorDate, 'MMMM yyyy', { locale: dateFnsLocale });

        case 'week': {
            const weekStart = startOfWeek(anchorDate, { weekStartsOn: 0 });
            const weekEnd = endOfWeek(anchorDate, { weekStartsOn: 0 });
            const startDay = format(weekStart, 'd', { locale: dateFnsLocale });
            const endDay = format(weekEnd, 'd', { locale: dateFnsLocale });
            const monthAbbr = format(weekEnd, 'MMM', { locale: dateFnsLocale });
            const year = format(weekEnd, 'yyyy');
            return `${startDay}-${endDay} ${monthAbbr} ${year}`;
        }

        case 'year':
            return format(anchorDate, 'yyyy');

        default:
            return '';
    }
};
