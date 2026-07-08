import { useTranslation } from 'react-i18next';
import { he, enUS } from 'date-fns/locale';

/**
 * useLocale — נגזרות locale לכל קומפוננטה.
 *
 * שורש האמת: i18n.language. הוא מסונכרן ע"י useLanguageSync לשרשרת
 * resolveLanguage(settings, context), כך שתמיד משקף את המצב המעודכן —
 * כולל override מההגדרות ושינויים ב-runtime דרך ה-language picker.
 *
 * Lookup table — להוסיף שפה חדשה: שורה אחת. fallback ל-he בטוח כש
 * i18n.language לא נתמך.
 *
 * @returns {{
 *   language: 'he' | 'en',
 *   isRtl: boolean,
 *   isLtr: boolean,
 *   dir: 'rtl' | 'ltr',
 *   dateLocale: 'he-IL' | 'en-US',     // עבור Intl / toLocaleDateString
 *   dateFnsLocale: object,              // he | enUS — עבור date-fns format()
 *   culture: 'he' | 'en'                // alias סמנטי ל-react-big-calendar
 * }}
 */

const LOCALE_TABLE = {
    he: { isRtl: true,  dir: 'rtl', dateLocale: 'he-IL', dateFnsLocale: he   },
    en: { isRtl: false, dir: 'ltr', dateLocale: 'en-US', dateFnsLocale: enUS },
};

const FALLBACK_LANG = 'he';

export function useLocale() {
    const { i18n } = useTranslation();
    const lang = LOCALE_TABLE[i18n.language] ? i18n.language : FALLBACK_LANG;
    const meta = LOCALE_TABLE[lang];
    return {
        language: lang,
        isRtl: meta.isRtl,
        isLtr: !meta.isRtl,
        dir: meta.dir,
        dateLocale: meta.dateLocale,
        dateFnsLocale: meta.dateFnsLocale,
        culture: lang,
    };
}

