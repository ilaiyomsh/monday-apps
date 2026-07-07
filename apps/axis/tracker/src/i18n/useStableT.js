import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * עוטפת את t() של react-i18next ומחזירה רפרנס יציב לכל שפה.
 *
 * הסיבה: שימוש ב-t במערכי תלות של useEffect/useCallback/useMemo
 * הפעיל את האזהרה react-hooks/exhaustive-deps כשהפונקציה לא הופיעה
 * שם, ולא הצדיק שורת eslint-disable בכל אתר. react-i18next כבר
 * ממסד את t לפי שפה דרך useSyncExternalStore (זהותו משתנה רק כשהשפה
 * מתחלפת), ו-wrapper זה ממסד אותו פעם נוספת כך שצרכנים יכולים לכלול
 * אותו במערכי תלות בלי לחשוש מרנדורים מיותרים.
 *
 * שימוש: `const t = useStableT();` במקום
 *        `const { t } = useTranslation();`
 *
 * הערה: כשהשפה מתחלפת, useTranslation גורם לרנדור מחדש של הצרכן
 * דרך i18next React context, ובאותו רנדור useStableT מחזירה זהות
 * חדשה ל-t — כך useMemo/useCallback שתלויים ב-t מחזירים תרגום עדכני.
 */
export function useStableT() {
    const { t } = useTranslation();
    return useCallback((...args) => t(...args), [t]);
}
