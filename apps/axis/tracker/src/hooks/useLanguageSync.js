import { useEffect } from 'react';
import i18n, { resolveLanguage } from '../i18n';
import { useSettings } from '../contexts/SettingsContext';
import { useMondayContext } from '../contexts/MondayContext';
import logger from '../utils/logger';

/**
 * useLanguageSync — מסנכרן את השפה של i18next עם המקורות הסמכותיים:
 * customSettings.languageOverride → monday.context.user.currentLanguage → 'he'.
 *
 * פעיל בזמן ריצה — מגיב לשינויים בשני המקורות. שימוש: בקריאה אחת
 * ב-AppContent (אחרי ש-providers נטענו).
 *
 * הסיבה שזה צריך להיות hook (ולא init פעם אחת) — כי המשתמש יכול
 * לשנות בורר שפה ב-runtime, וגם monday.listen('context') יכול לעדכן
 * את currentLanguage באמצע session.
 */
export function useLanguageSync() {
    const { customSettings } = useSettings();
    const { context } = useMondayContext();

    useEffect(() => {
        // resolveLanguage זורק כשlanguageOverride לא נתמך (סניטציית קלט מ-UI/storage).
        // ב-runtime זו לא סיבה להפיל את האפליקציה — מדווחים ונופלים ל-he.
        let target;
        try {
            target = resolveLanguage(customSettings, context);
        } catch (err) {
            logger.error('useLanguageSync', `Failed to resolve language (override: ${customSettings?.languageOverride ?? 'none'}), falling back to he`, err);
            target = 'he';
        }
        if (i18n.language !== target) {
            const previous = i18n.language;
            // טלמטריה לאינקרמנט 9 — מנטרים שינויי שפה ב-runtime
            // (תדירות, מקור, ומשתמש) כדי לזהות בעיות שמתגלות רק אחרי
            // הסואיץ' (חוסר תרגום, שבירת layout, וכו').
            logger.info('useLanguageSync', 'Language changing', {
                from: previous,
                to: target,
                source: customSettings?.languageOverride
                    ? 'settings_override'
                    : context?.user?.currentLanguage
                        ? 'monday_context'
                        : 'default'
            });
            i18n.changeLanguage(target).catch((err) => {
                logger.error('useLanguageSync', `Failed to change language to ${target}`, err);
            });
        }
    }, [customSettings?.languageOverride, context?.user?.currentLanguage]);
}

