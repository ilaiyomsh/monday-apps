/**
 * בניית deep-link ליום היעדרות בתוך רכיב Day-off (אינטגרציה W4 / DEEPLINK.md).
 *
 * הפורמט הנדרש (ראו ../Day-off/DEEPLINK.md):
 *   {baseUrl}?app[itemId]={itemId}
 *
 * monday חושפת לאפליקציה המוטמעת (iframe) רק פרמטרים תחת ה-namespace
 * "app[...]"; פרמטר רגיל יסונן. ה-baseUrl הוא ה-URL של ה-Custom Object של
 * מופע ה-Day-off, מוגדר ידנית בהגדרות (customSettings.dayOffAppUrl) — אין
 * קבוע בקוד, הכתובת משתנה בין מופע למופע.
 */

import logger from './logger';

/**
 * בונה את הקישור העמוק לפריט היעדרות מסוים ב-Day-off.
 *
 * @param {string} baseUrl - כתובת ה-Custom Object של מופע ה-Day-off (http/https)
 * @param {string|number} itemId - מזהה הפריט בלוח ההיעדרויות
 * @returns {string|null} הקישור המלא, או null אם ה-baseUrl אינו http(s) תקין
 *   או שחסר itemId (התעלמות שקטה במעלה הזרם)
 */
export const buildDayOffDeepLink = (baseUrl, itemId) => {
    const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    if (!/^https?:\/\//i.test(trimmed)) return null;
    if (itemId === null || itemId === undefined || String(itemId).trim() === '') return null;

    try {
        const url = new URL(trimmed);
        // השם המלא של הפרמטר הוא "app[itemId]" — monday מסירה את עטיפת app[]
        // בצד הלקוח. URL.searchParams יקודד את הסוגריים כ-%5B/%5D, מה ש-monday
        // מפענחת חזרה (DEEPLINK.md §3).
        url.searchParams.set('app[itemId]', String(itemId));
        return url.toString();
    } catch (parseError) {
        // URL שעבר את בדיקת ה-regex אך נכשל בפרסור (קלט פגום) — null, התעלמות שקטה במעלה הזרם
        logger.debug('buildDayOffDeepLink', 'Invalid base URL - cannot build deep link', { baseUrl: trimmed, error: parseError?.message });
        return null;
    }
};
