/**
 * פונקציות עזר לפורמוט תאריכים עבור Monday API
 * Monday API מצפה לפורמט UTC ספציפי
 */

import logger from './logger';

/**
 * בדיקה אם הערך הוא אובייקט Date תקין (לא Invalid Date)
 * @param {*} date
 * @returns {boolean}
 */
const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());

/**
 * המרת Date לפורמט תאריך של Monday (YYYY-MM-DD)
 *
 * זהו פורמטר בגבול הכתיבה ל-Monday: על תאריך לא תקין הוא *זורק* Error
 * (אחרי logger.error) במקום להחזיר '' — כדי שלא ייכתב תאריך ריק ל-Monday
 * ויוצג טוסט הצלחה כוזב (בליעה שקטה). הקוראים בנתיב הכתיבה עטופים ב-try/catch
 * שמציג את השגיאה דרך showErrorWithDetails.
 * @param {Date} date - תאריך להמרה
 * @returns {string} פורמט YYYY-MM-DD
 * @throws {Error} אם התאריך לא תקין (Invalid Date)
 */
export const toMondayDateFormat = (date) => {
    if (!isValidDate(date)) {
        // רושמים וזורקים את *אותו* instance — log-once מקפל את הרישום כאן ואת התפיסה
        // אצל הקורא לרשומה אחת (טוסט אחד מה-UI sink, לא שניים).
        const err = new Error('תאריך לא תקין - לא ניתן לשמור את האירוע');
        err.details = { rawValue: date };
        logger.error('dateFormatters', 'toMondayDateFormat: תאריך לא תקין', err);
        throw err;
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * המרת Date לפורמט שעה של Monday (HH:MM:SS)
 *
 * פורמטר בגבול הכתיבה — *זורק* Error על שעה לא תקינה (ראו toMondayDateFormat).
 * @param {Date} date - תאריך/שעה להמרה
 * @returns {string} פורמט HH:MM:SS
 * @throws {Error} אם התאריך לא תקין (Invalid Date)
 */
export const toMondayTimeFormat = (date) => {
    if (!isValidDate(date)) {
        // אותו instance לרישום ולזריקה — ראו toMondayDateFormat
        const err = new Error('שעה לא תקינה - לא ניתן לשמור את האירוע');
        err.details = { rawValue: date };
        logger.error('dateFormatters', 'toMondayTimeFormat: תאריך לא תקין', err);
        throw err;
    }
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
};

/**
 * המרת Date לאובייקט עמודת תאריך של Monday
 *
 * פורמטר בגבול הכתיבה — *זורק* Error על תאריך לא תקין (ראו toMondayDateFormat).
 * @param {Date} date - תאריך/שעה להמרה
 * @returns {{date: string, time: string}} אובייקט עם date ו-time
 * @throws {Error} אם התאריך לא תקין (Invalid Date)
 */
export const toMondayDateTimeColumn = (date) => {
    if (!isValidDate(date)) {
        // אותו instance לרישום ולזריקה — ראו toMondayDateFormat
        const err = new Error('תאריך לא תקין - לא ניתן לשמור את האירוע');
        err.details = { rawValue: date };
        logger.error('dateFormatters', 'toMondayDateTimeColumn: תאריך לא תקין', err);
        throw err;
    }
    return {
        date: toMondayDateFormat(date),
        time: toMondayTimeFormat(date)
    };
};

/**
 * המרת Date לפורמט תאריך מקומי (YYYY-MM-DD) בזמן מקומי
 * @param {Date} date - תאריך להמרה
 * @returns {string} פורמט YYYY-MM-DD (או '' אם התאריך לא תקין)
 */
export const toLocalDateFormat = (date) => {
    if (!isValidDate(date)) {
        logger.warn('dateFormatters', 'toLocalDateFormat: תאריך לא תקין', date);
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * המרת Date לפורמט שעה מקומי (HH:MM)
 * @param {Date} date - תאריך/שעה להמרה
 * @returns {string} פורמט HH:MM (או '' אם התאריך לא תקין)
 */
export const toLocalTimeFormat = (date) => {
    if (!isValidDate(date)) {
        logger.warn('dateFormatters', 'toLocalTimeFormat: תאריך לא תקין', date);
        return '';
    }
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
};
