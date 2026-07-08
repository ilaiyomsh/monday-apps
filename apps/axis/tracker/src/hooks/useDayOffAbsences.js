/**
 * Hook לשכבת ההיעדרויות מלוח החופשות של רכיב Day-off (אינטגרציה W4.1)
 *
 * קורא לקריאה-בלבד את לוח החופשות (vacations board) הממופה בהגדרות (D9) וממפה
 * כל פריט לאירוע יומן יומי רב-ימי אחד — ללא פריסה ליום-יום (CONTRACT.md §6.5:
 * react-big-calendar מרנדר אירועי all-day רב-יומיים נטיבית).
 *
 * סמנטיקת השליפה — חפיפת טווחים עם החלון הנראה (CONTRACT.md §6):
 * ל-items_page אין אופרטור חפיפה דו-עמודתי, ובונה החוקים של ה-tracker מחבר
 * חוקים ב-AND שטוח — לכן הנתיב המאושר (כמו Planner W3.2): שליפה בחלון מורחב
 * + סינון חפיפה בצד הלקוח. חוק התאריך: startDate `between`
 * [windowStart−366 ימים, windowEnd] — פריט חופף לחלון תמיד מתחיל לפני סופו,
 * ולכן מוחמצים רק פריטים שהתחילו יותר מ-366 ימים לפני תחילת החלון
 * (היעדרות רציפה ארוכה משנה — מתועד כאן כתקרת הכיסוי של v1).
 *
 * פריטים אישיים של המשתמש הנוכחי OR פריטים כלליים (ימי חברה): ה-OR לא ניתן
 * לביטוי בקבוצת חוקים אחת — לכן שתי שאילתות הממוזגות בצד הלקוח עם דה-דופ לפי
 * מזהה פריט (CONTRACT.md / plan W4.1):
 *   A: תאריך מורחב AND person any_of [assigned_to_me]
 *   B: תאריך מורחב AND kind any_of [generalLabelId]
 *
 * התאמת תוויות לפי label ID יציב בלבד (לעולם לא טקסט) — CONTRACT.md §1.
 * רענון חלון מחליף את כל הנתונים (replace-within-window) — ביטולים נמחקים
 * קשיחות ללא tombstone, וקריאה מחדש היא אות המחיקה היחיד (CONTRACT.md §7).
 *
 * ההוק פעיל רק כאשר showAbsences דולק ולוח Day-off ממופה במלואו — ברירות
 * המחדל (dayOffBoardId=null) משאירות אותו רדום בכל התקנה קיימת.
 */

import { useState, useCallback, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { safeApi } from '../utils/mondayApi';
import { toLocalDateFormat } from '../utils/dateFormatters';
import logger from '../utils/logger';
import { handleGlobalError } from '../utils/globalErrorHandler';

/** הרחבת חלון השליפה אחורה בימים (ראו תקרת הכיסוי בכותרת הקובץ) */
export const DAY_OFF_FETCH_WIDENING_DAYS = 366;

/** day-key לפי החוזה: YYYY-MM-DD, השוואה לקסיקוגרפית (CONTRACT.md §1) */
const DAY_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * מפתחות המיפוי הנדרשים להפעלת השכבה — שיקוף הסט הבלתי-מותנה של ולידטור
 * W4.5 (settingsValidator). מיפוי חלקי מותר בזמן ההגירה (W5.1) תחת
 * absenceSource='tracker' — לכן כאן רק אזהרה והשכבה נשארת כבויה; המשטח
 * הקולני למיפוי שבור הוא הוולידטור כאשר absenceSource='dayoff'.
 */
const REQUIRED_MAPPING_KEYS = [
    'dayOffPersonColumnId',
    'dayOffStartDateColumnId',
    'dayOffEndDateColumnId',
    'dayOffKindColumnId',
    'dayOffKindGeneralLabelId',
    'dayOffKindPersonalLabelId',
    'dayOffTypeColumnId'
];

/** המרת day-key לחצות מקומית (+הזזת ימים) — בנייה מרכיבים, בלי פרסור UTC (TZ-safe) */
const dayKeyToLocalDate = (dayKey, addDays = 0) => {
    const [year, month, day] = dayKey.split('-').map(Number);
    return new Date(year, month - 1, day + addDays);
};

/** הזזת ימים על Date מקומי (מאופס לחצות) — לחישוב גבול החלון המורחב */
const addDaysLocal = (date, days) => {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + days);
    return result;
};

/** השוואת label IDs עמידה לטיפוס (ההגדרות שומרות מחרוזות, ה-API מחזיר מספרים) */
const sameLabelId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

/** האם label ID נמצא בסט תוויות מההגדרות */
const labelIdInSet = (ids, labelId) => Array.isArray(ids) && ids.some(id => sameLabelId(id, labelId));

/** איתור ערך עמודה בפריט לפי מזהה עמודה */
const getCol = (item, columnId) => (columnId ? item.column_values?.find(col => col.id === columnId) : null) || null;

/**
 * המרת חוקים לפורמט GraphQL (operator הוא enum — בלי מרכאות).
 * זהה לתבנית המוכחת ב-useMondayEvents.rulesToGraphQL.
 */
const rulesToGraphQL = (rules) => rules.map(rule => `{
    column_id: "${rule.column_id}",
    compare_value: ${JSON.stringify(rule.compare_value)},
    operator: ${rule.operator}
}`).join(',\n');

/**
 * זיהוי סוג הרשומה (אישי/כללי) — label ID קודם, ואז כלל ה-fallback הנורמטיבי
 * (CONTRACT.md §2): kind ריק/לא מזוהה ⇒ אישי אם ועמודת האדם אינה ריקה, אחרת כללי.
 * תווית לא-ריקה שאינה תואמת אף תווית מוגדרת = חשד ל-drift בהגדרות — נאסף לדיווח.
 */
const resolveKind = (kindLabelId, personNonEmpty, cs, driftCollector, itemId) => {
    if (kindLabelId !== null && kindLabelId !== undefined) {
        if (sameLabelId(kindLabelId, cs.dayOffKindGeneralLabelId)) return 'general';
        if (sameLabelId(kindLabelId, cs.dayOffKindPersonalLabelId)) return 'personal';
        driftCollector.push({ itemId, kindLabelId });
    }
    return personNonEmpty ? 'personal' : 'general';
};

/**
 * Hook לטעינת היעדרויות מלוח החופשות של Day-off כשכבת תצוגה לקריאה בלבד.
 * @param {Object} monday - Monday SDK instance
 * @returns {{ absences: Array, loading: boolean, error: string|null, loadAbsences: Function, clearAbsences: Function }}
 */
export const useDayOffAbsences = (monday) => {
    const { customSettings } = useSettings();
    const settingsRef = useRef(customSettings);
    settingsRef.current = customSettings;

    const [absences, setAbsences] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const fetchIdRef = useRef(0);

    /**
     * טעינת היעדרויות לטווח התצוגה הנוכחי. מחליפה את כל נתוני החלון
     * (replace-within-window — CONTRACT.md §7).
     * @param {Date} startDate - תחילת החלון הנראה
     * @param {Date} endDate - סוף החלון הנראה
     */
    const loadAbsences = useCallback(async (startDate, endDate) => {
        const cs = settingsRef.current || {};
        // כל קריאה חדשה מבטלת את הקודמת (כולל קריאות gating שמכבות את השכבה)
        const fetchId = ++fetchIdRef.current;

        // gating: ההוק פעיל רק כש-showAbsences דולק ולוח חופשות מוגדר.
        // ברירת המחדל (dayOffBoardId=null) משאירה את ההתקנות הקיימות רדומות בשקט.
        if (cs.showAbsences === false || !cs.dayOffBoardId) {
            setAbsences(prev => (prev.length ? [] : prev));
            return;
        }

        if (!startDate || !endDate) {
            logger.warn('useDayOffAbsences.loadAbsences', 'Missing start or end date');
            return;
        }

        const windowStartKey = toLocalDateFormat(startDate);
        const windowEndKey = toLocalDateFormat(endDate);
        if (!windowStartKey || !windowEndKey) return; // toLocalDateFormat כבר רשם אזהרה

        // בדיקת מוכנות המיפוי — שיקוף דרישות ולידטור W4.5 (ראו הערת REQUIRED_MAPPING_KEYS)
        const missing = REQUIRED_MAPPING_KEYS.filter(key => !cs[key]);
        const approvalRequired = !!cs.dayOffApprovalRequired;
        if (approvalRequired) {
            // תחת מדיניות אישור (D2) מיפוי האישור הופך חובה (הסט "נדחה" אופציונלי)
            if (!cs.dayOffApprovalColumnId) missing.push('dayOffApprovalColumnId');
            if (!cs.dayOffApprovedLabelIds?.length) missing.push('dayOffApprovedLabelIds');
            if (!cs.dayOffPendingLabelIds?.length) missing.push('dayOffPendingLabelIds');
        }
        const generalLabelIdNum = Number(cs.dayOffKindGeneralLabelId);
        if (cs.dayOffKindGeneralLabelId && !Number.isFinite(generalLabelIdNum)) {
            missing.push('dayOffKindGeneralLabelId (not a numeric label id)');
        }
        if (missing.length > 0) {
            logger.warn('useDayOffAbsences.loadAbsences', 'Day-off mapping incomplete - absence overlay inactive', { missing });
            setAbsences(prev => (prev.length ? [] : prev));
            return;
        }

        setLoading(true);
        setError(null);

        try {
            logger.functionStart('useDayOffAbsences.loadAbsences', { windowStartKey, windowEndKey });

            const widenedFromKey = toLocalDateFormat(addDaysLocal(startDate, -DAY_OFF_FETCH_WIDENING_DAYS));

            // רק העמודות הממופות נשלפות (חיסכון בנתונים, כמו useMondayEvents)
            const columnIds = [
                cs.dayOffPersonColumnId,
                cs.dayOffStartDateColumnId,
                cs.dayOffEndDateColumnId,
                cs.dayOffKindColumnId,
                cs.dayOffTypeColumnId,
                cs.dayOffApprovalColumnId
            ].filter(Boolean);
            const columnIdsStr = columnIds.map(id => `"${id}"`).join(', ');

            // חוק התאריך המשותף: חלון מורחב אחורה (ראו כותרת הקובץ)
            const dateRule = {
                column_id: cs.dayOffStartDateColumnId,
                compare_value: [widenedFromKey, windowEndKey],
                operator: 'between'
            };
            // שאילתה A: הבקשות האישיות של המשתמש הנוכחי (הצמדה בצד השרת לזהות monday)
            const personalRules = [dateRule, {
                column_id: cs.dayOffPersonColumnId,
                compare_value: ['assigned_to_me'],
                operator: 'any_of'
            }];
            // שאילתה B: רשומות כלליות (ימי חברה) — לעמודת האדם שלהן אין ערך,
            // ולכן הן לעולם לא יוחזרו משאילתה A
            const generalRules = [dateRule, {
                column_id: cs.dayOffKindColumnId,
                compare_value: [generalLabelIdNum],
                operator: 'any_of'
            }];

            // טעינת כל הדפים עבור סט חוקים אחד; מחזיר null כשהקריאה התיישנה
            const fetchAllPages = async (rules, callerName) => {
                const rulesGraphQL = rulesToGraphQL(rules);
                let items = [];
                let cursor = null;
                do {
                    if (fetchId !== fetchIdRef.current) return null;
                    const cursorParam = cursor ? `, cursor: "${cursor}"` : '';
                    const query = `query {
                        boards (ids: [${cs.dayOffBoardId}]) {
                            items_page (
                                limit: 500${cursorParam},
                                query_params: {
                                    rules: [${rulesGraphQL}],
                                    operator: and
                                }
                            ) {
                                cursor
                                items {
                                    id
                                    name
                                    column_values (ids: [${columnIdsStr}]) {
                                        id
                                        text
                                        value
                                        ... on DateValue {
                                            date
                                        }
                                        ... on StatusValue {
                                            index
                                            label
                                            label_style {
                                                color
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }`;
                    const res = await safeApi(monday, callerName, query);
                    if (fetchId !== fetchIdRef.current) return null;
                    const page = res?.data?.boards?.[0]?.items_page;
                    if (page?.items) {
                        items = items.concat(page.items);
                    }
                    cursor = page?.cursor || null;
                } while (cursor);
                return items;
            };

            const [personalItems, generalItems] = await Promise.all([
                fetchAllPages(personalRules, 'useDayOffAbsences.loadPersonalPage'),
                fetchAllPages(generalRules, 'useDayOffAbsences.loadGeneralPage')
            ]);
            if (personalItems === null || generalItems === null) {
                logger.debug('useDayOffAbsences.loadAbsences', 'Fetch cancelled (stale)');
                return;
            }

            // מיזוג שתי השאילתות + דה-דופ לפי מזהה פריט (פריט כללי שבעמודת האדם
            // שלו מופיע המשתמש הנוכחי עלול לחזור משתיהן)
            const itemsById = new Map();
            for (const item of personalItems) itemsById.set(item.id, item);
            for (const item of generalItems) {
                if (!itemsById.has(item.id)) itemsById.set(item.id, item);
            }

            const events = [];
            const malformedItems = [];
            const kindDrift = [];
            const approvalMismatches = [];

            for (const item of itemsById.values()) {
                const startCol = getCol(item, cs.dayOffStartDateColumnId);
                const endCol = getCol(item, cs.dayOffEndDateColumnId);
                const startKey = startCol?.date || startCol?.text || '';
                const endKey = endCol?.date || endCol?.text || '';

                // פריט ללא שני תאריכים תקינים פגום — מדלגים, לעולם לא מנחשים (CONTRACT.md §2)
                if (!DAY_KEY_REGEX.test(startKey) || !DAY_KEY_REGEX.test(endKey) || endKey < startKey) {
                    malformedItems.push({ itemId: item.id, startKey, endKey });
                    continue;
                }

                // סינון חפיפה בצד הלקוח מול החלון האמיתי (טווחים כוללים בשני הקצוות):
                // start <= windowEnd AND end >= windowStart, השוואה לקסיקוגרפית
                if (startKey > windowEndKey || endKey < windowStartKey) continue;

                const personCol = getCol(item, cs.dayOffPersonColumnId);
                const personNonEmpty = !!(personCol?.text && personCol.text.trim());
                const kindCol = getCol(item, cs.dayOffKindColumnId);
                const kind = resolveKind(kindCol?.index ?? null, personNonEmpty, cs, kindDrift, item.id);

                // כותרת + צבע מתווית סוג ההיעדרות (מפתח = label ID, הטקסט לתצוגה בלבד — D1).
                // לרשומה כללית שם הפריט הוא שדה החוזה (CONTRACT.md §4).
                const typeCol = kind === 'personal' ? getCol(item, cs.dayOffTypeColumnId) : null;
                const typeLabelId = typeCol?.index ?? null;
                const typeText = typeCol?.label || typeCol?.text || '';
                const typeColor = typeCol?.label_style?.color || null;

                const approvalCol = kind === 'personal' ? getCol(item, cs.dayOffApprovalColumnId) : null;
                const approvalLabelId = approvalCol?.index ?? null;

                // נדחה מוחרג תמיד — בלי תלות במדיניות (תיקון D2 של המשתמש,
                // 2026-06-10 / DEV-2): הדחייה רק מסמנת; הפריט נשאר על הלוח ומוצג
                // בתוך Day-off בלבד. בלי מיפוי תוויות "נדחה" אין יכולת החרגה
                // (דגרדציה מתועדת ב-CONTRACT.md §5.2 — יש למפות גם כשהמדיניות כבויה).
                if (
                    kind === 'personal' &&
                    approvalLabelId !== null &&
                    approvalLabelId !== undefined &&
                    labelIdInSet(cs.dayOffRejectedLabelIds, approvalLabelId)
                ) {
                    continue;
                }

                // דגלי אישור לפי מדיניות D2: כשהמדיניות כבויה — שאר הפריטים האישיים
                // (ממתין/מאושר/ריק) נספרים ומוצגים מלאים (CONTRACT.md §5.2)
                let isPending = false;
                let isApproved = false;
                if (kind === 'personal' && approvalRequired) {
                    if (approvalLabelId === null || approvalLabelId === undefined) {
                        // ערך אישור ריק = ממתין (ברירת מחדל סמנטית לבקשה שטרם הוכרעה,
                        // CONTRACT.md §3 — זו אינה ברירת המחדל השקטה האסורה)
                        isPending = true;
                    } else if (labelIdInSet(cs.dayOffApprovedLabelIds, approvalLabelId)) {
                        isApproved = true;
                    } else if (labelIdInSet(cs.dayOffPendingLabelIds, approvalLabelId)) {
                        isPending = true;
                    } else {
                        // תווית אישור לא-ריקה שאינה באף סט מוגדר = drift בהגדרות —
                        // חייב להיכשל בקול (CONTRACT.md §1 כלל 3); נאסף לדיווח מרוכז אחרי הלולאה
                        approvalMismatches.push({
                            itemId: item.id,
                            labelId: approvalLabelId,
                            label: approvalCol?.label || approvalCol?.text || ''
                        });
                        continue;
                    }
                }

                // פריט אחד = אירוע יומי רב-ימי אחד; end בלעדי (endDate + יום) —
                // הסמנטיקה של react-big-calendar לאירועי all-day (CONTRACT.md §6.5)
                events.push({
                    id: `dayoff_${item.id}`,
                    dayOffItemId: item.id,
                    title: kind === 'general' ? item.name : (typeText || item.name),
                    start: dayKeyToLocalDate(startKey),
                    end: dayKeyToLocalDate(endKey, 1),
                    allDay: true,
                    isDayOff: true,
                    readOnly: true,
                    dayOffKind: kind,
                    typeLabelId: typeLabelId !== null && typeLabelId !== undefined ? String(typeLabelId) : null,
                    eventType: typeText,
                    eventTypeColor: typeColor,
                    approvalLabelId: approvalLabelId !== null && approvalLabelId !== undefined ? String(approvalLabelId) : null,
                    isPending,
                    isApproved,
                    startDateKey: startKey,
                    endDateKey: endKey
                });
            }

            if (malformedItems.length > 0) {
                logger.warn('useDayOffAbsences.loadAbsences', 'Dropped day-off items with missing/invalid dates', {
                    count: malformedItems.length,
                    sample: malformedItems.slice(0, 5)
                });
            }
            if (kindDrift.length > 0) {
                logger.warn('useDayOffAbsences.loadAbsences', 'Day-off kind labels matched neither configured label - settings drift?', {
                    count: kindDrift.length,
                    sample: kindDrift.slice(0, 5)
                });
            }
            if (approvalMismatches.length > 0) {
                // רשומת שגיאה אחת מרוכזת לכל טעינה — ה-UI sink הופך אותה לטוסט יחיד
                const mismatchError = new Error('סטטוס אישור לא מזוהה בלוח החופשות - בדוק את מיפוי תוויות האישור בהגדרות');
                mismatchError.details = {
                    count: approvalMismatches.length,
                    sample: approvalMismatches.slice(0, 5)
                };
                logger.error('useDayOffAbsences.loadAbsences', 'Day-off approval labels matched no configured set - items excluded', mismatchError);
            }

            setAbsences(events);
            logger.functionEnd('useDayOffAbsences.loadAbsences', { count: events.length });
        } catch (loadError) {
            logger.error('useDayOffAbsences.loadAbsences', 'Error loading day-off absences', loadError);
            setError('שגיאה בטעינת היעדרויות מלוח החופשות');
            handleGlobalError(loadError, { functionName: 'useDayOffAbsences.loadAbsences' });
        } finally {
            if (fetchId === fetchIdRef.current) {
                setLoading(false);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customSettings נקרא דרך settingsRef כדי לא לייצר את ה-callback מחדש על כל שינוי הגדרות (כמו useMondayEvents)
    }, [monday]);

    /** ניקוי השכבה (למשל בכיבוי showAbsences) — מבטל גם טעינות בתהליך */
    const clearAbsences = useCallback(() => {
        fetchIdRef.current++;
        setAbsences([]);
    }, []);

    return {
        absences,
        loading,
        error,
        loadAbsences,
        clearAbsences
    };
};
