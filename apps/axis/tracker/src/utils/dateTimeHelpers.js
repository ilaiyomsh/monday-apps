/**
 * dateTimeHelpers — מודול ריכוזי לפורמוט וחישוב זמן (Increment 7).
 *
 * המודול מחליף בהדרגה קריאות פזורות ל-toMondayDateFormat / toLocalDateFormat
 * וכו'. כולו locale-aware ועקבי תחת timezone שונים.
 *
 * עקרונות:
 * - פונקציות פורמט (formatTime/Date) מקבלות options.locale ו-options.timeFormat
 * - פונקציות שמייצאות ל-Monday (toMondayDateString/toMondayDateTimeString)
 *   הן TZ-stable: משתמשות בערכי שעון לוקאלי כש-Monday מצפה לתאריך לוקאלי.
 * - פונקציות חישוב (addDays, isSameDay) מתבססות על local-time ולא ms
 *   כדי להיות יציבות ב-DST boundaries.
 */

const DEFAULT_OPTIONS = { locale: 'he', timeFormat: '24h' };

/**
 * @param {Date} date
 * @param {{ locale?: 'he'|'en', timeFormat?: '24h'|'12h' }} [options]
 * @returns {string} HH:MM (24h) או "h:MM AM/PM" (12h)
 */
export function formatTime(date, options = DEFAULT_OPTIONS) {
    const { timeFormat = '24h' } = options;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

    const hours = date.getHours();
    const minutes = date.getMinutes();
    const mm = String(minutes).padStart(2, '0');

    if (timeFormat === '12h') {
        const period = hours >= 12 ? 'PM' : 'AM';
        let h12 = hours % 12;
        if (h12 === 0) h12 = 12;
        return `${h12}:${mm} ${period}`;
    }

    return `${String(hours).padStart(2, '0')}:${mm}`;
}

/**
 * @param {Date} date
 * @param {{ locale?: 'he'|'en' }} [options]
 * @returns {string} תאריך מפורמט לפי locale
 */
export function formatDate(date, options = DEFAULT_OPTIONS) {
    const { locale = 'he' } = options;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

    const intlLocale = locale === 'en' ? 'en-US' : 'he-IL';
    return new Intl.DateTimeFormat(intlLocale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(date);
}

/**
 * @param {Date} date
 * @param {{ locale?: 'he'|'en', timeFormat?: '24h'|'12h' }} [options]
 * @returns {string} תאריך + שעה לתצוגה
 */
export function formatDateTime(date, options = DEFAULT_OPTIONS) {
    return `${formatDate(date, options)} ${formatTime(date, options)}`;
}

/**
 * פרסור קלט חופשי של משתמש לזמן.
 *
 * @param {string} input — כמו "14:30", "9:5", "2:30 PM"
 * @param {{ locale?: 'he'|'en' }} [options]
 * @returns {{ hours: number, minutes: number } | null} null אם הקלט לא תקין
 */
export function parseUserTime(input, options = DEFAULT_OPTIONS) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();

    // ניסיון 12h: "h:mm AM/PM" — קודם, אחרת ייתכן שייפול ב-24h regex
    const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})\s*(AM|PM)$/i);
    if (ampmMatch) {
        let h = parseInt(ampmMatch[1], 10);
        const m = parseInt(ampmMatch[2], 10);
        const period = ampmMatch[3].toUpperCase();
        if (h < 1 || h > 12 || m < 0 || m > 59) return null;
        if (period === 'AM') h = h === 12 ? 0 : h;
        else h = h === 12 ? 12 : h + 12;
        return { hours: h, minutes: m };
    }

    // 24h: "HH:MM" או "H:M"
    const match24 = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
    if (match24) {
        const h = parseInt(match24[1], 10);
        const m = parseInt(match24[2], 10);
        if (h < 0 || h > 23 || m < 0 || m > 59) return null;
        return { hours: h, minutes: m };
    }

    return null;
}

/**
 * תאריך לוקאלי בפורמט YYYY-MM-DD — יציב תחת timezone (משתמש בערכי
 * שעון לוקאלי, לא UTC). שימושי לעמודות תאריך של Monday שמצפות לתאריך
 * לוקאלי בלי שעה.
 *
 * @param {Date} date
 * @returns {string}
 */
export function toMondayDateString(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * תאריך + שעה ב-ISO UTC לעמודות date+time של Monday.
 *
 * @param {Date} date
 * @returns {string} ISO 8601 UTC עם Z
 */
export function toMondayDateTimeString(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toISOString();
}

/**
 * השוואת ימים — נכונה ב-DST boundaries (משתמשת בערכי שעון לוקאלי).
 *
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
export function isSameDay(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

/**
 * הוספת ימים — DST-safe. שומרת על שעה לוקאלית גם כשעוברים את גבול ה-DST
 * (החישוב ב-ms יזיז ב-±שעה ויחטיא את השעה הלוקאלית).
 *
 * @param {Date} date
 * @param {number} days
 * @returns {Date}
 */
export function addDays(date, days) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return date;
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

const dateTimeHelpers = {
    formatTime,
    formatDate,
    formatDateTime,
    parseUserTime,
    toMondayDateString,
    toMondayDateTimeString,
    isSameDay,
    addDays
};
export default dateTimeHelpers;
