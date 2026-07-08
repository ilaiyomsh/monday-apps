// עוזר משותף לאכיפת "GraphQL soft-error ≠ הצלחה" במסלולי הכתיבה.
//
// רקע (תוכנית טיפול בשגיאות, Phase 2 + §3.1): safeApi מחזיר את התשובה הגולמית
// ולא זורק על GraphQL soft-errors (status 200 עם res.errors) — הוא רק מלוגג אותם
// ברמת ERROR ב-client.js:256 (זו הרשומה הקנונית לאותו כשל). התוצאה: מסלולי
// כתיבה (create_item / change_multiple_column_values / delete_item) שקיבלו
// soft-error היו "מצליחים" בשקט (createdItem היה falsy והקוד החזיר null /
// הציג טוסט הצלחה כוזב).
//
// assertNoGraphQLErrors סוגר את השורש: הוא נקרא מיד אחרי safeApi במסלולי
// הכתיבה וזורק MondayApiError כש-res.errors קיים. הוא **לא מלוגג** — כי
// safeApi כבר רשם את ה-soft-error (client.js:256). רישום נוסף כאן היה יוצר
// כפילות מיותרת; ה-MondayApiError שנזרק יירשם פעם אחת ב-catch של הקורא
// (למשל useMondayEvents.createEvent) ויעבור dedup דרך emit (log-once) בכל
// מעבר חוזר.

import { MondayApiError } from './client.js';
import { extractOperationName } from '../errorHandler';

/**
 * אכיפת היעדר GraphQL soft-errors בתשובת safeApi במסלול כתיבה.
 *
 * זורק MondayApiError כאשר res.errors קיים (status 200 עם שגיאות GraphQL).
 * **אינו מלוגג** — ה-soft-error כבר נרשם ב-safeApi (client.js:256). הקורא
 * אחראי לרשום את ה-MondayApiError פעם אחת ב-catch שלו (dedup דרך emit).
 *
 * @param {Object} res - התשובה הגולמית מ-safeApi
 * @param {Object} [meta] - מטא-דאטה להקשר השגיאה (להצגה ב-ErrorDetailsModal)
 * @param {string} [meta.functionName] - שם הפונקציה הקוראת
 * @param {string} [meta.query] - השאילתה/mutation שנשלחה
 * @param {Object} [meta.variables] - המשתנים שנשלחו
 * @returns {Object} res - מוחזר כמות שהוא כאשר אין שגיאות (שרשור נוח)
 * @throws {MondayApiError} כאשר res.errors קיים ולא ריק
 */
export const assertNoGraphQLErrors = (res, { functionName = null, query = null, variables = null } = {}) => {
    const errors = res?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
        const firstError = errors[0];
        const message = firstError?.message || 'GraphQL error';
        const apiErr = new MondayApiError(message, {
            response: res,
            apiRequest: query
                ? { query, variables: variables || null, operationName: extractOperationName(query) }
                : null,
            errorCode: firstError?.extensions?.code || null,
            functionName
        });
        // ירושת מזהה הרישום מה-soft-error שכבר נרשם ב-safeApi (client.js מטביע
        // __softErrorLoggedId על התשובה) — כך רישום ה-throw אצל הקורא מסומן
        // duplicate ע"י log-once: רשומה אחת + טוסט אחד לכשל.
        if (res?.__softErrorLoggedId !== undefined) {
            try {
                Object.defineProperty(apiErr, '__loggedId', {
                    value: res.__softErrorLoggedId, enumerable: false, configurable: true, writable: true
                });
                Object.defineProperty(apiErr, 'correlationId', {
                    value: res.__softErrorLoggedId, enumerable: false, configurable: true, writable: true
                });
            // בליעה שקטה מכוונת: כשל defineProperty (אובייקט קפוא) רק מוותר על
            // האופטימיזציה של dedup — השגיאה עצמה נזרקת ונרשמת בהמשך ממילא.
            // eslint-disable-next-line no-restricted-syntax
            } catch { /* לא חוסם */ }
        }
        throw apiErr;
    }
    return res;
};
