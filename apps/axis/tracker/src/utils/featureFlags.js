/**
 * Feature Flags — דגלים לתכונות מאחורי env vars.
 *
 * עוזר לבדוק תכונות פנימית לפני שמשחררים אותן ב-production. בוחנים
 * דרך פונקציות (לא קבועים) כדי שטסטים יוכלו ל-mock אותן.
 */

/**
 * האם להציג את בורר השפה בהגדרות. ברירת מחדל: סגור.
 *
 * הפעלה: VITE_ENABLE_LANGUAGE_PICKER=true בסביבה.
 */
export function isLanguagePickerEnabled() {
    if (typeof import.meta?.env?.VITE_ENABLE_LANGUAGE_PICKER === 'string') {
        return import.meta.env.VITE_ENABLE_LANGUAGE_PICKER === 'true';
    }
    return false;
}

const featureFlags = { isLanguagePickerEnabled };
export default featureFlags;
