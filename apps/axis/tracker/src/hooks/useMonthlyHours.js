import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { getEffectiveBoardId } from '../utils/boardIdResolver';
import { getCategory, isAllDayIndex, getLabelText } from '../utils/eventTypeMapping';
import { toLocalDateFormat } from '../utils/dateFormatters';
import { safeApi } from '../utils/mondayApi';
import logger from '../utils/logger';
import { handleGlobalError } from '../utils/globalErrorHandler';

/**
 * Hook לחישוב שעות לפי טווח התצוגה הנוכחי בלוח
 * מקבל viewRange (start, end) ו-calendarView ומחשב breakdown + יעד דינמי
 */
export const useMonthlyHours = (monday, context, viewRange, calendarView) => {
    const { customSettings } = useSettings();
    const [breakdown, setBreakdown] = useState([]);
    const [totalHours, setTotalHours] = useState(0);
    const [loading, setLoading] = useState(false);

    const effectiveBoardId = useMemo(() =>
        getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    const monthlyTarget = customSettings.monthlyHoursTarget ?? 182.5;
    const weeklyTarget = customSettings.weeklyHoursTarget ?? (monthlyTarget / 4.33);
    const workdayLength = customSettings.workdayLength ?? 8.5;
    const numWorkDays = (customSettings.workDays ?? [0, 1, 2, 3, 4]).length;
    const mapping = customSettings.eventTypeMapping;
    const labelMeta = customSettings.eventTypeLabelMeta;
    const dateColumnId = customSettings.dateColumnId;
    const durationColumnId = customSettings.durationColumnId;
    const eventTypeColumnId = customSettings.eventTypeStatusColumnId;
    const reporterColumnId = customSettings.reporterColumnId;
    const temporaryCheckboxColumnId = customSettings.temporaryCheckboxColumnId;

    // חישוב יעד דינמי לפי סוג תצוגה
    const targetHours = useMemo(() => {
        if (calendarView === 'month') return monthlyTarget;
        if (calendarView === 'day') return weeklyTarget / numWorkDays;
        // week, work_week, three_day
        return weeklyTarget;
    }, [calendarView, monthlyTarget, weeklyTarget, numWorkDays]);

    // ייצוב ה-viewRange כדי למנוע רינדורים מיותרים
    const rangeStart = viewRange?.start?.getTime() || 0;
    const rangeEnd = viewRange?.end?.getTime() || 0;

    // Ref למניעת race conditions
    const fetchIdRef = useRef(0);

    const fetchData = useCallback(async () => {
        if (!effectiveBoardId || !dateColumnId || !durationColumnId || !eventTypeColumnId || !mapping || !rangeStart || !rangeEnd) {
            setBreakdown([]);
            setTotalHours(0);
            return;
        }

        const fetchId = ++fetchIdRef.current;
        setLoading(true);

        try {
            const fromDateStr = toLocalDateFormat(viewRange.start);
            const toDateStr = toLocalDateFormat(viewRange.end);

            // בניית חוקי סינון
            const rules = [
                `{ column_id: "${dateColumnId}", compare_value: ["${fromDateStr}", "${toDateStr}"], operator: between }`
            ];

            if (reporterColumnId) {
                rules.push(
                    `{ column_id: "${reporterColumnId}", compare_value: ["assigned_to_me"], operator: any_of }`
                );
            }

            // הוצאת אירועים מתוכננים (Checkbox מסומן) ברמת ה-API
            if (temporaryCheckboxColumnId) {
                rules.push(
                    `{ column_id: "${temporaryCheckboxColumnId}", compare_value: [], operator: is_empty }`
                );
            }

            const rulesStr = rules.join(',\n');

            // שליפת אירועים — כולל label_style לצבעי סטטוס ישירות מהפריט
            const firstPageQuery = `query {
                boards (ids: [${effectiveBoardId}]) {
                    items_page (
                        limit: 500,
                        query_params: {
                            rules: [${rulesStr}],
                            operator: and
                        }
                    ) {
                        cursor
                        items {
                            id
                            column_values (ids: ["${eventTypeColumnId}", "${durationColumnId}"]) {
                                id
                                value
                                ... on StatusValue {
                                    index
                                    label_style {
                                        color
                                    }
                                }
                            }
                        }
                    }
                }
            }`;

            // איסוף כל הפריטים (עם pagination). מוחזר null אם נטענה fetch חדשה במקביל.
            const collectAllItems = async () => {
                const firstPageRes = await safeApi(monday, 'useMonthlyHours:firstPage', firstPageQuery);
                if (fetchId !== fetchIdRef.current) return null;

                const firstPage = firstPageRes?.data?.boards?.[0]?.items_page;
                if (!firstPage) return [];

                let items = firstPage.items || [];
                let cursor = firstPage.cursor;

                while (cursor) {
                    const nextQuery = `query {
                        next_items_page (
                            limit: 500, cursor: "${cursor}"
                        ) {
                            cursor
                            items {
                                id
                                column_values (ids: ["${eventTypeColumnId}", "${durationColumnId}"]) {
                                    id
                                    value
                                    ... on StatusValue {
                                        index
                                        label_style {
                                            color
                                        }
                                    }
                                }
                            }
                        }
                    }`;

                    const nextRes = await safeApi(monday, 'useMonthlyHours:nextPage', nextQuery);
                    if (fetchId !== fetchIdRef.current) return null;

                    const nextPage = nextRes?.data?.next_items_page;
                    if (!nextPage) break;

                    items = items.concat(nextPage.items || []);
                    cursor = nextPage.cursor;
                }
                return items;
            };

            // ה-cursor של monday חי ~60 שניות. אם פג באמצע — מתחילים את כל ה-pagination מחדש פעם אחת.
            let allItems;
            try {
                allItems = await collectAllItems();
            } catch (err) {
                const code = err?.errorCode || err?.response?.errors?.[0]?.extensions?.code;
                if (code === 'CursorException') {
                    logger.warn('useMonthlyHours', 'Cursor expired, retrying full fetch once');
                    allItems = await collectAllItems();
                } else {
                    throw err;
                }
            }
            if (allItems === null) return;

            // חישוב שעות לפי אינדקס + איסוף צבעים מ-label_style
            const hoursByIndex = {};
            const colorsByIndex = {};

            for (const item of allItems) {
                let eventTypeIndex = null;
                let durationValue = 0;

                for (const col of item.column_values) {
                    if (col.id === eventTypeColumnId) {
                        // שימוש ב-index ישירות מ-StatusValue (עדיף על פירסור value)
                        if (col.index != null) {
                            eventTypeIndex = String(col.index);
                        } else if (col.value) {
                            try {
                                const parsed = JSON.parse(col.value);
                                eventTypeIndex = parsed?.index != null ? String(parsed.index) : null;
                            } catch (e) { logger.warn('useMonthlyHours', 'Failed to parse event type value', { itemId: item.id, value: col.value }); }
                        }
                        // איסוף צבע מ-label_style (הצבע האמיתי מ-Monday)
                        if (eventTypeIndex != null && col.label_style?.color) {
                            colorsByIndex[eventTypeIndex] = col.label_style.color;
                        }
                    }
                    if (col.id === durationColumnId && col.value) {
                        try {
                            const parsed = JSON.parse(col.value);
                            durationValue = parseFloat(parsed) || 0;
                        } catch (e) {
                            // value לא-JSON — נופלים לפירוש ישיר של המחרוזת
                            durationValue = parseFloat(col.value) || 0;
                            logger.debug('useMonthlyHours', 'Duration value not JSON, parsed raw', { itemId: item.id, value: col.value, error: e?.message });
                        }
                    }
                }

                if (eventTypeIndex == null) continue;

                let hours;
                if (isAllDayIndex(eventTypeIndex, mapping)) {
                    const days = Math.max(1, Math.round(durationValue));
                    hours = days * workdayLength;
                } else {
                    hours = durationValue;
                }

                if (!hoursByIndex[eventTypeIndex]) {
                    hoursByIndex[eventTypeIndex] = 0;
                }
                hoursByIndex[eventTypeIndex] += hours;
            }

            // בניית breakdown — צבע מ-label_style (מהפריטים), fallback ל-labelMeta
            const result = Object.entries(hoursByIndex).map(([index, hours]) => ({
                index,
                label: getLabelText(index, labelMeta) || `לייבל ${index}`,
                color: colorsByIndex[index] || labelMeta?.[index]?.color || '#c4c4c4',
                category: getCategory(index, mapping) || 'unknown',
                hours: Math.round(hours * 10) / 10
            }));

            const categoryOrder = {
                billable: 0, internalProject: 0, externalProject: 1,
                nonBillable: 2, routine: 2,
                allDay: 3
            };
            result.sort((a, b) => (categoryOrder[a.category] ?? 3) - (categoryOrder[b.category] ?? 3));

            const total = result.reduce((sum, item) => sum + item.hours, 0);

            if (fetchId === fetchIdRef.current) {
                setBreakdown(result);
                setTotalHours(Math.round(total * 10) / 10);
            }

            logger.debug('useMonthlyHours', 'View range breakdown computed', {
                calendarView,
                itemCount: allItems.length,
                total,
                categories: result.length
            });
        } catch (error) {
            logger.error('useMonthlyHours', 'Error fetching data', error);
            handleGlobalError(error, { functionName: 'useMonthlyHours.fetchData' });
            if (fetchId === fetchIdRef.current) {
                setBreakdown([]);
                setTotalHours(0);
            }
        } finally {
            if (fetchId === fetchIdRef.current) {
                setLoading(false);
            }
        }
    }, [effectiveBoardId, dateColumnId, durationColumnId, eventTypeColumnId, reporterColumnId, mapping, labelMeta, workdayLength, rangeStart, rangeEnd, monday, temporaryCheckboxColumnId]);

    // טעינה אוטומטית בשינוי טווח או הגדרות
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return {
        breakdown,
        totalHours,
        targetHours,
        loading,
        refetch: fetchData
    };
};
