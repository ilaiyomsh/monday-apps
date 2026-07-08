import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he/translation.json';
import en from './locales/en/translation.json';
import logger from '../utils/logger';

/**
 * תשתית i18n של האפליקציה (Increment 1).
 *
 * עקרונות:
 * - fallbackLng = 'he' — בעברית בלבד עד שיוקצב soft launch של אנגלית.
 * - SUPPORTED_LANGUAGES — נשמר מצומצם בכוונה. הוספת שפה חדשה דורשת
 *   קובץ locale חדש ועדכון של מי שמשתמש ב-resolveLanguage.
 * - resolveLanguage — שרשרת רזולוציה: settings.languageOverride →
 *   monday.context.user.currentLanguage → ברירת מחדל 'he'.
 */

export const SUPPORTED_LANGUAGES = ['he', 'en'];

// init() מחזיר Promise — נתיב boot דרך import "./i18n" ב-index.jsx.
// כשל אתחול i18next היה dark עד כה (אין catch). מנתבים אותו ל-logger
// כדי שלא יבלע בשקט; ה-ErrorBoundary נופל ל-fallback עברי קשיח בכל מקרה.
i18next
    .use(initReactI18next)
    .init({
        resources: {
            he: { translation: he },
            en: { translation: en }
        },
        lng: 'he',
        fallbackLng: ['he'],
        interpolation: { escapeValue: false }, // React מטפל ב-escape
        returnEmptyString: false
    })
    .then(() => {
        logger.debug('i18n', 'i18next initialized', { lng: i18next.language });
    })
    .catch((error) => {
        logger.error('i18n', 'i18next initialization failed', error);
    });

/**
 * שרשרת רזולוציה של שפה.
 *
 * @param {object} settings — customSettings (languageOverride אופציונלי)
 * @param {object} mondayContext — Monday SDK context (user.currentLanguage)
 * @returns {'he' | 'en'}
 * @throws Error כשsettings.languageOverride קיים אבל לא נתמך —
 *   הצורה הזאת בכוונה: שפה לא תקינה ב-override = שגיאת קונפיגורציה
 *   שמגיעה מ-UI ההגדרות, לא ממקור חיצוני שאי אפשר לסמוך עליו.
 */
export function resolveLanguage(settings, mondayContext) {
    const override = settings?.languageOverride;
    if (override) {
        if (!SUPPORTED_LANGUAGES.includes(override)) {
            throw new Error(`Unsupported language override: "${override}"`);
        }
        return override;
    }

    const fromContext = mondayContext?.user?.currentLanguage;
    if (fromContext && SUPPORTED_LANGUAGES.includes(fromContext)) {
        return fromContext;
    }

    return 'he';
}

export const t = i18next.t.bind(i18next);

export default i18next;
