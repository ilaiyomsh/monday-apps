/**
 * Hook לשליפת נתונים לדשבורד
 * מבוסס על דפוס useMondayEvents - pagination + מיפוי לאירועים קלים
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { getEffectiveBoardId } from '../utils/boardIdResolver';
import { isAllDayIndex, isProjectIndex, getCategory, getLabelText, getLabelColor } from '../utils/eventTypeMapping';
import { toLocalDateFormat } from '../utils/dateFormatters';
import { safeApi } from '../utils/mondayApi';
import logger from '../utils/logger';
import { handleGlobalError } from '../utils/globalErrorHandler';

/**
 * @typedef {Object} DashboardEvent
 * @property {string} id
 * @property {number|null} reporterId
 * @property {string|null} projectId
 * @property {string|null} projectName
 * @property {number} hours
 * @property {boolean} isBillable
 * @property {string} eventTypeIndex
 * @property {string} eventTypeLabel
 * @property {string} eventTypeColor
 * @property {string} nonBillableType
 * @property {string} notes
 * @property {Date} date
 */

/**
 * Hook לשליפת נתוני דשבורד
 * @param {Object} monday - Monday SDK instance
 * @param {Object} context - Monday context
 * @returns {{ events: DashboardEvent[], loading: boolean, error: string|null, fetchEvents: Function }}
 */
export const useDashboardData = (monday, context) => {
    const { customSettings } = useSettings();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // התקדמות טעינה: כמה פריטים נטענו עד כה + אחוז
    const [progress, setProgress] = useState({ loaded: 0, hasMore: false, percent: 0 });

    const effectiveBoardId = useMemo(() =>
        getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    // חילוץ שדות settings ספציפיים למניעת refetch מיותרים
    const dateColumnId = customSettings?.dateColumnId;
    const durationColumnId = customSettings?.durationColumnId;
    const eventTypeStatusColumnId = customSettings?.eventTypeStatusColumnId;
    const projectColumnId = customSettings?.projectColumnId;
    const reporterColumnId = customSettings?.reporterColumnId;
    const nonBillableStatusColumnId = customSettings?.nonBillableStatusColumnId;
    const stageColumnId = customSettings?.stageColumnId;
    const notesColumnId = customSettings?.notesColumnId;
    const eventTypeMapping = customSettings?.eventTypeMapping;
    const eventTypeLabelMeta = customSettings?.eventTypeLabelMeta;
    const customerReportColumnId = customSettings?.customerReportColumnId;
    const temporaryCheckboxColumnId = customSettings?.temporaryCheckboxColumnId;

    // AbortController לביטול fetch ישן כשמשתנה הטווח
    const abortRef = useRef(null);

    // Cache פשוט — מפתח = "from|to|rules" → תוצאות
    const cacheRef = useRef(new Map());

    /**
     * שליפת אירועים בטווח תאריכים
     * @param {Date} dateFrom
     * @param {Date} dateTo
     * @param {Array} [customFilterRules] - חוקי פילטר אופציונליים
     */
    const fetchEvents = useCallback(async (dateFrom, dateTo, customFilterRules = []) => {
        if (!effectiveBoardId || !dateColumnId || !durationColumnId) {
            logger.warn('useDashboardData', 'Missing board ID or settings');
            return;
        }

        // בדיקת cache — אם יש תוצאות מהירות, הצג מיד
        // מפתח כולל את כל ה-column IDs וההגדרות שמשפיעות על מיפוי האירועים,
        // כך ששינוי עמודה בהגדרות (כגון projectColumnId) מאפס cache ישן.
        const mappingKey = eventTypeMapping ? Object.entries(eventTypeMapping).sort().join(',') : '';
        const settingsKey = [
            effectiveBoardId,
            dateColumnId,
            durationColumnId,
            eventTypeStatusColumnId,
            projectColumnId,
            reporterColumnId,
            nonBillableStatusColumnId,
            stageColumnId,
            notesColumnId,
            customerReportColumnId,
            temporaryCheckboxColumnId,
        ].join('|');
        const cacheKey = `${toLocalDateFormat(dateFrom)}|${toLocalDateFormat(dateTo)}|${JSON.stringify(customFilterRules)}|${mappingKey}|${settingsKey}`;
        const cached = cacheRef.current.get(cacheKey);
        if (cached) {
            setEvents(cached);
            setProgress({ loaded: cached.length, hasMore: false, percent: 100 });
            setLoading(false);
            setError(null);
            logger.info('useDashboardData', 'Served from cache', { count: cached.length });
            return;
        }

        // ביטול fetch קודם אם עדיין רץ
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);
        setProgress({ loaded: 0, hasMore: true, percent: 0 });

        try {
            logger.functionStart('useDashboardData.fetchEvents', { dateFrom, dateTo });

            // בניית חוקי פילטר — חוק תאריכים מגיע מבחוץ דרך customFilterRules
            const rules = [...(customFilterRules || [])];

            // הוצאת אירועים יומיים ברמת ה-API — ללא משיכתם כלל
            if (eventTypeStatusColumnId && eventTypeMapping) {
                const excludedIndices = Object.entries(eventTypeMapping)
                    .filter(([, v]) => v === 'allDay')
                    .map(([k]) => String(k));
                if (excludedIndices.length > 0) {
                    rules.push({
                        column_id: eventTypeStatusColumnId,
                        compare_value: excludedIndices,
                        operator: 'not_any_of',
                    });
                }
            }

            // הוצאת אירועים מתוכננים (Checkbox מסומן) ברמת ה-API
            if (temporaryCheckboxColumnId) {
                rules.push({
                    column_id: temporaryCheckboxColumnId,
                    compare_value: [],
                    operator: 'is_empty',
                });
            }

            const rulesGraphQL = rules.map(rule => {
                const compareValue = JSON.stringify(rule.compare_value);
                const operatorStr = rule.operator ? `, operator: ${rule.operator}` : '';
                return `{
                    column_id: "${rule.column_id}",
                    compare_value: ${compareValue}${operatorStr}
                }`;
            }).join(',\n');

            // בניית רשימת עמודות נדרשות בלבד (חסכון של 60-70% ב-payload)
            const neededColumnIds = [
                dateColumnId,
                durationColumnId,
                eventTypeStatusColumnId,
                projectColumnId,
                reporterColumnId,
                nonBillableStatusColumnId,
                stageColumnId,
                notesColumnId,
                customerReportColumnId
            ].filter(Boolean);
            const columnIdsStr = neededColumnIds.map(id => `"${id}"`).join(', ');

            // שאילתת עמוד ראשון - items_page עם query_params
            const itemsFragment = `
                cursor
                items {
                    id
                    column_values(ids: [${columnIdsStr}]) {
                        id
                        value
                        ... on DateValue {
                            date
                            time
                        }
                        ... on PeopleValue {
                            persons_and_teams {
                                id
                                kind
                            }
                        }
                        ... on StatusValue {
                            id
                            index
                            label
                            text
                            label_style {
                                color
                            }
                        }
                        ... on BoardRelationValue {
                            linked_items {
                                id
                                name
                            }
                        }
                        ... on TextValue {
                            text
                        }
                    }
                }`;

            const firstPageQuery = `query {
                boards (ids: [${effectiveBoardId}]) {
                    items_page (
                        limit: 500,
                        query_params: {
                            rules: [${rulesGraphQL}],
                            operator: and
                        }
                    ) {
                        ${itemsFragment}
                    }
                }
            }`;


            // מיפוי פריט בודד לאירוע דשבורד
            const mapping = eventTypeMapping;
            const labelMeta = eventTypeLabelMeta;

            const mapItem = (item) => {
                const dateColumn = item.column_values.find(col => col.id === dateColumnId);
                if (!dateColumn?.date) return null;

                const [year, month, day] = dateColumn.date.split('-').map(Number);
                const date = new Date(year, month - 1, day);
                if (isNaN(date.getTime())) return null;

                const typeColumn = eventTypeStatusColumnId
                    ? item.column_values.find(col => col.id === eventTypeStatusColumnId)
                    : null;
                const eventTypeIndex = typeColumn?.index ?? null;

                if (isAllDayIndex(eventTypeIndex, mapping)) return null;

                const durationColumn = item.column_values.find(col => col.id === durationColumnId);
                let hours = 0;
                if (durationColumn?.value) {
                    try {
                        const parsed = JSON.parse(durationColumn.value);
                        hours = parseFloat(parsed) || 0;
                    } catch (parseError) {
                        // value אינו JSON תקין — fallback לפענוח כמחרוזת מספרית גולמית
                        logger.debug('useDashboardData', 'duration value אינו JSON, fallback ל-parseFloat', parseError);
                        hours = parseFloat(durationColumn.value) || 0;
                    }
                } else if (durationColumn?.text) {
                    hours = parseFloat(durationColumn.text) || 0;
                }

                const reporterColumn = reporterColumnId
                    ? item.column_values.find(col => col.id === reporterColumnId)
                    : null;
                const reporterId = reporterColumn?.persons_and_teams?.[0]?.id || null;

                const projectColumn = projectColumnId
                    ? item.column_values.find(col => col.id === projectColumnId)
                    : null;
                const projectId = projectColumn?.linked_items?.[0]?.id || null;
                const projectName = projectColumn?.linked_items?.[0]?.name || null;

                const nonBillableColumn = nonBillableStatusColumnId
                    ? item.column_values.find(col => col.id === nonBillableStatusColumnId)
                    : null;
                const nonBillableType = nonBillableColumn?.text || nonBillableColumn?.label || '';
                const nonBillableColor = nonBillableColumn?.label_style?.color || null;

                const stageColumn = stageColumnId
                    ? item.column_values.find(col => col.id === stageColumnId)
                    : null;
                const stageLabel = stageColumn?.text || stageColumn?.label || '';
                const stageColor = stageColumn?.label_style?.color || null;

                const notesColumn = notesColumnId
                    ? item.column_values.find(col => col.id === notesColumnId)
                    : null;
                const notes = notesColumn?.text || '';

                const customerColumn = customerReportColumnId
                    ? item.column_values.find(col => col.id === customerReportColumnId)
                    : null;
                const customerId = customerColumn?.linked_items?.[0]?.id || null;
                const customerName = customerColumn?.linked_items?.[0]?.name || null;

                return {
                    id: item.id,
                    reporterId,
                    projectId,
                    projectName,
                    customerId,
                    customerName,
                    hours,
                    isBillable: isProjectIndex(eventTypeIndex, mapping),
                    category: getCategory(eventTypeIndex, mapping),
                    eventTypeIndex: String(eventTypeIndex),
                    eventTypeLabel: getLabelText(eventTypeIndex, labelMeta) || typeColumn?.text || '',
                    eventTypeColor: typeColumn?.label_style?.color || getLabelColor(eventTypeIndex, labelMeta) || '#0073ea',
                    nonBillableType,
                    nonBillableColor,
                    stageLabel,
                    stageColor,
                    notes,
                    date
                };
            };

            // לולאת pagination עם הצגת נתונים חלקיים
            let allDashboardEvents = [];

            // עמוד ראשון
            const firstRes = await safeApi(monday, 'useDashboardData:firstPage', firstPageQuery);
            if (controller.signal.aborted) return;

            const firstPage = firstRes.data?.boards?.[0]?.items_page;
            if (firstPage?.items) {
                const mapped = firstPage.items.map(mapItem).filter(Boolean);
                allDashboardEvents.push(...mapped);
            }
            let cursor = firstPage?.cursor || null;

            // מעקב עמודים לאחוזי התקדמות
            let pageCount = 1;
            let totalEstimate = cursor ? 3 : 1; // ניחוש ראשוני: אם יש cursor, מניחים ~3 עמודים

            // הצגת תוצאות חלקיות מיד אחרי עמוד ראשון
            if (cursor && allDashboardEvents.length > 0) {
                const percent = Math.round((pageCount / totalEstimate) * 100);
                setEvents([...allDashboardEvents]);
                setProgress({ loaded: allDashboardEvents.length, hasMore: true, percent: Math.min(percent, 90) });
                setLoading(false); // מסיר את הלודר כדי להציג נתונים חלקיים
            }

            // עמודים הבאים - next_items_page (שאילתה נפרדת ברמת root)
            while (cursor && !controller.signal.aborted) {
                const nextQuery = `query {
                    next_items_page (cursor: "${cursor}", limit: 500) {
                        ${itemsFragment}
                    }
                }`;
                const nextRes = await safeApi(monday, 'useDashboardData:nextPage', nextQuery);
                if (controller.signal.aborted) return;

                const nextPage = nextRes.data?.next_items_page;
                if (nextPage?.items) {
                    const mapped = nextPage.items.map(mapItem).filter(Boolean);
                    allDashboardEvents.push(...mapped);
                    pageCount++;
                    // עדכון הערכה: אם יש עוד cursor, הגדל את הסך הכולל
                    if (nextPage.cursor && pageCount >= totalEstimate) {
                        totalEstimate = pageCount + 1;
                    }
                    const percent = nextPage.cursor
                        ? Math.min(Math.round((pageCount / totalEstimate) * 100), 90)
                        : 100;
                    setEvents([...allDashboardEvents]);
                    setProgress({ loaded: allDashboardEvents.length, hasMore: !!nextPage.cursor, percent });
                }
                cursor = nextPage?.cursor || null;
            }

            if (controller.signal.aborted) return;

            // עדכון סופי + שמירה ב-cache
            setEvents(allDashboardEvents);
            setProgress({ loaded: allDashboardEvents.length, hasMore: false, percent: 100 });

            // שמירה ב-cache (מוגבל ל-10 ערכים למניעת דליפת זיכרון)
            if (cacheRef.current.size >= 10) {
                const firstKey = cacheRef.current.keys().next().value;
                cacheRef.current.delete(firstKey);
            }
            cacheRef.current.set(cacheKey, allDashboardEvents);

            logger.functionEnd('useDashboardData.fetchEvents', { count: allDashboardEvents.length });

        } catch (err) {
            if (controller.signal.aborted) return;
            logger.error('useDashboardData', 'Error fetching dashboard data', err);
            setError('שגיאה בטעינת נתוני הדשבורד');
            handleGlobalError(err, { functionName: 'useDashboardData.fetchEvents' });
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [effectiveBoardId, monday, dateColumnId, durationColumnId, eventTypeStatusColumnId,
        projectColumnId, reporterColumnId, nonBillableStatusColumnId, stageColumnId, notesColumnId, eventTypeMapping, eventTypeLabelMeta, temporaryCheckboxColumnId, customerReportColumnId]);

    // לקוחות ייחודיים הנגזרים מהאירועים שנטענו — ללא קריאת API נוספת
    const customers = useMemo(() => {
        const map = new Map();
        events.forEach(e => {
            if (e.customerId && !map.has(e.customerId)) {
                map.set(e.customerId, { id: e.customerId, name: e.customerName || '' });
            }
        });
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'he'));
    }, [events]);

    // פרויקטים ייחודיים הנגזרים מהאירועים שנטענו — כולל customerId לצורך cascading
    const projects = useMemo(() => {
        const map = new Map();
        events.forEach(e => {
            if (e.projectId && !map.has(e.projectId)) {
                map.set(e.projectId, {
                    id: e.projectId,
                    name: e.projectName || '',
                    customerId: e.customerId || null,
                });
            }
        });
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'he'));
    }, [events]);

    return { events, loading, error, progress, fetchEvents, customers, projects };
};
