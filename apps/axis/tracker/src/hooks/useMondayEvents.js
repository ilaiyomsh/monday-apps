import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { createBoardItem, deleteItem, updateItemColumnValues, safeApi, MondayApiError } from '../utils/mondayApi';
import { isAllDayEventType, parseDuration, calculateEndDateFromDays, calculateDaysDiff, formatDurationForSave } from '../utils/durationUtils';
import { resolveTimedEventIndex, getLabelText, isProjectIndex } from '../utils/eventTypeMapping';
import { isPendingIndex, isApprovedIndex, isRejectedIndex, getPendingIndex } from '../utils/approvalMapping';
import { toMondayDateFormat, toMondayTimeFormat, toLocalDateFormat } from '../utils/dateFormatters';
import { getEffectiveBoardId } from '../utils/boardIdResolver';
import logger from '../utils/logger';
import { handleGlobalError } from '../utils/globalErrorHandler';

/**
 * @typedef {Object} CalendarEvent
 * @property {string} id - Monday item ID
 * @property {string} title - כותרת האירוע
 * @property {Date} start - זמן התחלה
 * @property {Date} end - זמן סיום
 * @property {boolean} allDay - האם זה אירוע יומי
 * @property {string} [mondayItemId] - Monday item ID (זהה ל-id)
 * @property {string} [notes] - הערות
 * @property {string} [projectId] - מזהה פרויקט מקושר
 * @property {string} [taskId] - מזהה משימה מקושרת
 * @property {string} [eventType] - סוג אירוע (שעתי/חופשה/מחלה/מילואים)
 * @property {number} [durationDays] - משך בימים (לאירועים יומיים)
 */

/**
 * @typedef {Object} UseMondayEventsReturn
 * @property {CalendarEvent[]} events - רשימת האירועים
 * @property {boolean} loading - האם בטעינה
 * @property {string|null} error - הודעת שגיאה
 * @property {Function} loadEvents - טעינת אירועים
 * @property {Function} createEvent - יצירת אירוע חדש
 * @property {Function} updateEvent - עדכון אירוע
 * @property {Function} deleteEvent - מחיקת אירוע
 * @property {Function} updateEventPosition - עדכון מיקום אירוע (drag/resize)
 * @property {Function} addEvent - הוספת אירוע ל-state
 */

/**
 * Hook לניהול אירועים ב-Monday Calendar
 * מטפל בכל הפעולות CRUD על אירועים
 * @param {Object} monday - Monday SDK instance
 * @param {Object} context - Monday context (boardId, etc.)
 * @returns {UseMondayEventsReturn}
 */
export const useMondayEvents = (monday, context) => {
    const { customSettings } = useSettings();
    const settingsRef = useRef(customSettings);
    settingsRef.current = customSettings;

    const [events, setEvents] = useState([]);
    const eventsRef = useRef([]);
    eventsRef.current = events;
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [currentFilter, setCurrentFilter] = useState(null);
    // eslint-disable-next-line no-unused-vars -- ה-state נשמר רק כדי להפעיל re-render דרך הסטר; הקריאה נעשית מ-viewRangeRef
    const [viewRange, setViewRange] = useState(null);
    const viewRangeRef = useRef(null);
    const customFilterRulesRef = useRef([]);
    const fetchIdRef = useRef(0);

    // חישוב לוח דיווחים אפקטיבי
    const effectiveBoardId = useMemo(() =>
        getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    // האזנה לשינויים ב-filter
    useEffect(() => {
        if (!monday) return;

        // האזנה ל-filter
        const unsubscribeFilter = monday.listen("filter", (res) => {
            const filter = res?.data || res;
            setCurrentFilter(filter);
            logger.debug('useMondayEvents', 'Filter updated', filter);
        });

        // קריאה ראשונית לטעינת הפילטר הנוכחי
        (async () => {
            try {
                const filter = await monday.get("filter");
                setCurrentFilter(filter?.data || filter);
            } catch (error) {
                logger.error('useMondayEvents', 'Error fetching initial filter', error);
            }
        })();

        // ניקוי בעת unmount
        return () => {
            if (unsubscribeFilter) unsubscribeFilter();
        };
    }, [monday]);

    /**
     * המרת חוקים לפורמט GraphQL
     * חשוב: operator הוא enum ב-GraphQL, לכן בלי מרכאות
     */
    const rulesToGraphQL = useCallback((rules) => {
        return rules.map(rule => {
            const compareValue = JSON.stringify(rule.compare_value);
            return `{
                column_id: "${rule.column_id}",
                compare_value: ${compareValue},
                operator: ${rule.operator}
            }`;
        }).join(',\n');
    }, []);

    /**
     * בניית כל החוקים: תאריכים + פילטר מדווח (assigned_to_me) + פילטר מותאם אישית + פילטר Monday + חיפוש טקסט
     */
    const buildAllRules = useCallback((fromDateStr, toDateStr, filter, customFilterRules = []) => {
        const rules = [];

        // חוק תאריכים (תמיד קיים)
        rules.push({
            column_id: customSettings.dateColumnId,
            compare_value: [fromDateStr, toDateStr],
            operator: "between"
        });

        // פילטר ברירת מחדל: הצגת אירועים של המשתמש הנוכחי בלבד (assigned_to_me)
        // זה יסנן לפי עמודת המדווח (reporterColumnId) ויציג רק פריטים שהמשתמש הנוכחי מופיע בהם
        if (customSettings.reporterColumnId) {
            // בדיקה אם יש כבר פילטר על עמודת המדווח מ-customFilterRules
            const hasReporterFilter = customFilterRules?.some(rule => rule.column_id === customSettings.reporterColumnId);

            // הוספת פילטר assigned_to_me רק אם אין פילטר אחר על אותה עמודה
            if (!hasReporterFilter) {
                rules.push({
                    column_id: customSettings.reporterColumnId,
                    compare_value: ["assigned_to_me"],
                    operator: "any_of"
                });
                logger.debug('useMondayEvents', 'Added default assigned_to_me filter on reporter column');
            }
        }

        // חוקי פילטר מותאם אישית (מ-FilterBar)
        if (customFilterRules && Array.isArray(customFilterRules) && customFilterRules.length > 0) {
            rules.push(...customFilterRules);
            logger.debug('useMondayEvents', 'Added custom filter rules', { count: customFilterRules.length });
        }

        // חוקי הפילטר מ-Monday (אם יש - רק במצב board view)
        if (filter && filter.rules && Array.isArray(filter.rules) && filter.rules.length > 0) {
            rules.push(...filter.rules);
        }

        // חיפוש טקסט (term)
        if (filter && filter.term) {
            rules.push({
                column_id: "name",
                compare_value: [filter.term],
                operator: "contains_text"
            });
        }

        return rules;
    }, [customSettings.dateColumnId, customSettings.reporterColumnId]);

    /**
     * טעינת אירועים מ-Monday בטווח תאריכים
     * @param {Date} startDate - תאריך התחלה
     * @param {Date} endDate - תאריך סיום
     * @param {Array} customFilterRules - חוקי פילטר מותאמים אישית (אופציונלי)
     */
    const loadEvents = useCallback(async (startDate, endDate, customFilterRules = []) => {
        const cs = settingsRef.current;
        if (!effectiveBoardId || !cs?.dateColumnId || !cs?.durationColumnId) {
            logger.warn('useMondayEvents.loadEvents', 'Missing board ID or settings for fetching events');
            return;
        }

        // הגנה מ-race conditions — כל קריאה חדשה מבטלת את הקודמת
        const fetchId = ++fetchIdRef.current;

        // שמירת הטווח והפילטרים לשימוש ברענון אוטומטי
        setViewRange({ start: startDate, end: endDate });
        viewRangeRef.current = { start: startDate, end: endDate };
        customFilterRulesRef.current = customFilterRules;

        setLoading(true);
        setError(null);

        try {
            logger.functionStart('useMondayEvents.loadEvents', {
                startDate,
                endDate,
                filter: currentFilter,
                customFilterRules: customFilterRules?.length || 0
            });

            const fromDateStr = toLocalDateFormat(startDate);
            const toDateStr = toLocalDateFormat(endDate);

            // בניית כל החוקים (תאריכים + פילטר מותאם + פילטר Monday + term)
            const allRules = buildAllRules(fromDateStr, toDateStr, currentFilter, customFilterRules);
            const rulesGraphQL = rulesToGraphQL(allRules);
            const operator = currentFilter?.operator || 'and';

            // בניית רשימת עמודות רלוונטיות בלבד (חיסכון בנתונים מיותרים)
            const columnIds = [
                cs.dateColumnId,
                cs.durationColumnId,
                cs.notesColumnId,
                cs.eventTypeStatusColumnId,
                cs.allDayTypeStatusColumnId,
                cs.projectColumnId,
                cs.taskColumnId,
                cs.stageColumnId,
                cs.nonBillableStatusColumnId,
                cs.endTimeColumnId,
                cs.approvalStatusColumnId,
                cs.temporaryCheckboxColumnId
            ].filter(Boolean);
            const columnIdsStr = columnIds.map(id => `"${id}"`).join(', ');

            // פונקציה פנימית לטעינת דף אחד
            const loadEventsPage = async (cursor = null) => {
                const cursorParam = cursor ? `, cursor: "${cursor}"` : '';

                const query = `query {
                    boards (ids: [${effectiveBoardId}]) {
                        items_page (
                            limit: 500${cursorParam},
                            query_params: {
                                rules: [${rulesGraphQL}],
                                operator: ${operator}
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
                                        time
                                    }
                                    ... on StatusValue {
                                        index
                                        label
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
                                    ... on CheckboxValue {
                                        checked
                                    }
                                }
                            }
                        }
                    }
                }`;

                return await safeApi(monday, 'useMondayEvents.loadEventsPage', query);
            };

            // לולאת pagination עם הגנה מ-race conditions
            let allItems = [];
            let cursor = null;

            do {
                // בדיקה אם קריאה חדשה התחילה — מפסיקים את הנוכחית
                if (fetchId !== fetchIdRef.current) {
                    logger.debug('useMondayEvents.loadEvents', 'Fetch cancelled (stale)', { fetchId, currentFetchId: fetchIdRef.current });
                    return;
                }

                const res = await loadEventsPage(cursor);

                // בדיקה נוספת אחרי ה-await
                if (fetchId !== fetchIdRef.current) {
                    logger.debug('useMondayEvents.loadEvents', 'Fetch cancelled after page load (stale)');
                    return;
                }

                const page = res.data?.boards?.[0]?.items_page;

                if (page?.items) {
                    allItems = [...allItems, ...page.items];
                }

                cursor = page?.cursor || null;
            } while (cursor);

            if (allItems.length === 0) {
                logger.warn('useMondayEvents.loadEvents', 'No items found in response');
                setEvents([]);
                return;
            }

            const rawItems = allItems;
            
            // מיפוי וחישוב לתצוגה תוך שימוש בהגדרות המותאמות
            const mappedEvents = rawItems.map(item => {
                const dateColumn = item.column_values.find(col => col.id === cs.dateColumnId);
                const durationColumn = item.column_values.find(col => col.id === cs.durationColumnId);
                const notesColumn = item.column_values.find(col => col.id === cs.notesColumnId);
                const typeColumn = cs.eventTypeStatusColumnId
                    ? item.column_values.find(col => col.id === cs.eventTypeStatusColumnId)
                    : null;
                // חילוץ פרויקט מקושר
                const projectColumn = cs.projectColumnId
                    ? item.column_values.find(col => col.id === cs.projectColumnId)
                    : null;
                const projectId = projectColumn?.linked_items?.[0]?.id || null;
                const projectName = projectColumn?.linked_items?.[0]?.name || null;

                // חילוץ משימה מקושרת
                const taskColumn = cs.taskColumnId
                    ? item.column_values.find(col => col.id === cs.taskColumnId)
                    : null;
                const taskId = taskColumn?.linked_items?.[0]?.id || null;
                const taskName = taskColumn?.linked_items?.[0]?.name || null;

                // חילוץ שלב (stage)
                const stageColumn = cs.stageColumnId
                    ? item.column_values.find(col => col.id === cs.stageColumnId)
                    : null;
                const stageId = stageColumn?.text || stageColumn?.label || null;

                // חילוץ סוג לא לחיוב
                const nonBillableColumn = cs.nonBillableStatusColumnId
                    ? item.column_values.find(col => col.id === cs.nonBillableStatusColumnId)
                    : null;
                const nonBillableType = nonBillableColumn?.text || nonBillableColumn?.label || '';

                // חילוץ התחלה
                let start = null;
                if (dateColumn?.date) {
                    const [year, month, day] = dateColumn.date.split('-').map(Number);
                    let hours = 0, minutes = 0, seconds = 0;
                    if (dateColumn.time) {
                        [hours, minutes, seconds] = dateColumn.time.split(':').map(Number);
                    }
                    start = new Date(year, month - 1, day, hours, minutes, seconds || 0);
                }

                if (!start || isNaN(start.getTime())) return null;

                // חילוץ זמן סיום מעמודת endTimeColumnId (אם מוגדרת)
                const endTimeColumn = cs.endTimeColumnId
                    ? item.column_values.find(col => col.id === cs.endTimeColumnId)
                    : null;

                // חילוץ משך גולמי מהעמודה
                let rawDuration = 0;
                if (durationColumn?.value) {
                    try {
                        const parsed = JSON.parse(durationColumn.value);
                        rawDuration = parseFloat(parsed) || 0;
                    } catch (parseError) {
                        // value אינו JSON תקין — fallback לפענוח כמחרוזת מספרית גולמית
                        logger.debug('useMondayEvents', 'duration value אינו JSON, fallback ל-parseFloat', parseError);
                        rawDuration = parseFloat(durationColumn.value) || 0;
                    }
                } else if (durationColumn?.text) {
                    rawDuration = parseFloat(durationColumn.text) || 0;
                }

                // זיהוי סוג האירוע לפי אינדקס
                const eventTypeIndex = typeColumn?.index ?? null;
                const isAllDay = isAllDayEventType(eventTypeIndex, cs.eventTypeMapping);

                // לאירוע יומי — סוג + צבע נקראים מעמודת התת-סוג. לאירוע שעתי — מעמודת ה-eventType.
                const allDayTypeColumn = isAllDay && cs.allDayTypeStatusColumnId
                    ? item.column_values.find(col => col.id === cs.allDayTypeStatusColumnId)
                    : null;
                const allDayTypeIndex = allDayTypeColumn?.index ?? null;
                const eventTypeText = isAllDay
                    ? (allDayTypeColumn?.text || allDayTypeColumn?.label || '')
                    : (typeColumn?.text || '');
                const eventTypeColor = isAllDay
                    ? (allDayTypeColumn?.label_style?.color || null)
                    : (typeColumn?.label_style?.color || null);

                // פרסור Duration פולימורפי - שעות לשעתי, ימים ליומי
                const duration = parseDuration(rawDuration, eventTypeIndex, cs.eventTypeMapping);

                let end;
                if (isAllDay) {
                    // אירוע יומי - duration מייצג ימים
                    start.setHours(0, 0, 0, 0);
                    // חישוב end (Exclusive) - נדרש ע"י react-big-calendar
                    end = calculateEndDateFromDays(start, duration.value);
                } else {
                    // אירוע שעתי - נסה לקרוא זמן סיום מעמודה ייעודית
                    if (endTimeColumn?.date && endTimeColumn?.time) {
                        // קריאת זמן סיום מעמודת endTimeColumnId
                        const [endYear, endMonth, endDay] = endTimeColumn.date.split('-').map(Number);
                        const [endHours, endMinutes, endSeconds] = endTimeColumn.time.split(':').map(Number);
                        end = new Date(endYear, endMonth - 1, endDay, endHours, endMinutes, endSeconds || 0);
                    } else {
                        // Fallback: חישוב מ-duration
                        const durationMinutes = Math.round(duration.value * 60);
                        // ברירת מחדל שעה אחת אם אין משך
                        const effectiveDurationMinutes = durationMinutes > 0 ? durationMinutes : 60;
                        end = new Date(start.getTime() + effectiveDurationMinutes * 60000);
                    }
                }

                // בדיקה אם זה אירוע זמני/מתוכנן — נקרא מעמודת ה-Checkbox
                const temporaryColumn = cs.temporaryCheckboxColumnId
                    ? item.column_values.find(col => col.id === cs.temporaryCheckboxColumnId)
                    : null;
                const isTemporary = !!temporaryColumn?.checked;

                // סטטוס אישור מנהל
                const approvalColumn = cs.approvalStatusColumnId
                    ? item.column_values.find(c => c.id === cs.approvalStatusColumnId)
                    : null;
                const approvalStatusIndex = approvalColumn?.index ?? null;
                const isPending = cs.enableApproval && isPendingIndex(approvalStatusIndex, cs.approvalStatusMapping);
                const isApproved = cs.enableApproval && isApprovedIndex(approvalStatusIndex, cs.approvalStatusMapping);
                const isRejected = cs.enableApproval && isRejectedIndex(approvalStatusIndex, cs.approvalStatusMapping);

                return {
                    id: item.id,
                    title: item.name,
                    start: start,
                    end: end,
                    allDay: isAllDay,
                    mondayItemId: item.id,
                    notes: notesColumn?.text || '',
                    projectId,
                    projectName,
                    taskId,
                    taskName,
                    stageId,
                    isBillable: isProjectIndex(eventTypeIndex, cs.eventTypeMapping),
                    nonBillableType,
                    eventType: eventTypeText,
                    eventTypeIndex,
                    eventTypeColor,
                    allDayTypeIndex,
                    durationDays: isAllDay ? duration.value : null,
                    isTemporary,
                    approvalStatusIndex,
                    isPending,
                    isApproved,
                    isRejected
                };
            }).filter(Boolean);

            setEvents(mappedEvents);
            logger.functionEnd('useMondayEvents.loadEvents', { count: mappedEvents.length });

        } catch (error) {
            logger.error('useMondayEvents.loadEvents', 'Error loading events', error);
            setError('שגיאה בטעינת האירועים');
            handleGlobalError(error, { functionName: 'useMondayEvents.loadEvents' });
        } finally {
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customSettings accessed via settingsRef to prevent re-creation on every settings change
    }, [effectiveBoardId, monday, currentFilter, buildAllRules, rulesToGraphQL]);

    // רענון אוטומטי כשהפילטר משתנה
    useEffect(() => {
        if (currentFilter !== null && viewRangeRef.current) {
            loadEvents(viewRangeRef.current.start, viewRangeRef.current.end, customFilterRulesRef.current);
        }
    }, [currentFilter, loadEvents]);

    /**
     * בניית column values ליצירה/עדכון
     */
    const buildColumnValues = useCallback((eventData, startTime, endTime, currentUser) => {
        const customSettings = settingsRef.current;
        const durationMinutes = Math.round((endTime - startTime) / 60000);
        const durationHours = durationMinutes / 60;

        // המרת הזמן המקומי ל-UTC (Monday מצפה ל-UTC)
        const dateStr = toMondayDateFormat(startTime);
        const timeStr = toMondayTimeFormat(startTime);

        const columnValues = {};

        // עמודת תאריך
        columnValues[customSettings.dateColumnId] = {
            date: dateStr,
            time: timeStr
        };

        // עמודת משך זמן - המרה לשעות עשרוניות
        columnValues[customSettings.durationColumnId] = durationHours.toFixed(2);

        // עמודת קישור לפרויקט (אם נבחר פרויקט ויש הגדרה לעמודה)
        if (eventData.itemId && customSettings.projectColumnId) {
            columnValues[customSettings.projectColumnId] = {
                item_ids: [parseInt(eventData.itemId)]
            };
        }
        
        // עמודת קישור למשימה (אם נבחרה משימה ויש הגדרה לעמודה)
        if (eventData.taskId && customSettings.taskColumnId) {
            columnValues[customSettings.taskColumnId] = {
                item_ids: [parseInt(eventData.taskId)]
            };
        }
        
        // עמודת קישור להקצאה (אם יש הקצאה ויש הגדרה לעמודה)
        if (eventData.assignmentId && customSettings.assignmentColumnId) {
            columnValues[customSettings.assignmentColumnId] = {
                item_ids: [parseInt(eventData.assignmentId)]
            };
        }
        
        // עמודת הערות (אם יש הערות ויש הגדרה לעמודה)
        if (eventData.notes && customSettings.notesColumnId) {
            columnValues[customSettings.notesColumnId] = eventData.notes;
        }
        
        // עמודת מדווח - המשתמש שיצר את הדיווח (אם יש הגדרה לעמודה)
        if (currentUser && customSettings.reporterColumnId) {
            columnValues[customSettings.reporterColumnId] = {
                personsAndTeams: [{ id: parseInt(currentUser.id), kind: "person" }]
            };
        }
        
        // קביעת סוג הדיווח (פרויקטים / שוטף) וערך הסטטוס המתאים
        if (customSettings.eventTypeStatusColumnId) {
            const isBillable = eventData.isBillable !== false; // ברירת מחדל: true
            const typeIndex = resolveTimedEventIndex({
                isBillable,
                project: eventData.project || null,
                mapping: customSettings.eventTypeMapping,
                enableDistinction: !!customSettings.enableProjectTypeDistinction
            });

            if (typeIndex != null) {
                columnValues[customSettings.eventTypeStatusColumnId] = {
                    index: parseInt(typeIndex, 10)
                };
            }

            // אם זה שוטף, נעדכן גם את עמודת הסטטוס של סוגי שוטף
            if (!isBillable && eventData.nonBillableType && customSettings.nonBillableStatusColumnId) {
                columnValues[customSettings.nonBillableStatusColumnId] = {
                    label: eventData.nonBillableType
                };
            }
        }
        
        // הוספת שלב (אם יש משימה ויש הגדרה לעמודה)
        if (eventData.stageId && customSettings.stageColumnId) {
            columnValues[customSettings.stageColumnId] = {
                label: eventData.stageId
            };
        }

        // עמודת זמן סיום (אם מוגדרת)
        if (customSettings.endTimeColumnId) {
            columnValues[customSettings.endTimeColumnId] = {
                date: toMondayDateFormat(endTime),
                time: toMondayTimeFormat(endTime)
            };
        }

        // עמודת לקוח (אם יש לקוח לפרויקט ויש עמודת יעד)
        if (eventData.project?.customerId && customSettings.customerReportColumnId) {
            columnValues[customSettings.customerReportColumnId] = {
                item_ids: [parseInt(eventData.project.customerId)]
            };
        }

        // סטטוס אישור - כתיבת "ממתין" ביצירת אירוע חדש
        if (customSettings.enableApproval && customSettings.approvalStatusColumnId) {
            const pendingIdx = getPendingIndex(customSettings.approvalStatusMapping);
            if (pendingIdx != null) {
                columnValues[customSettings.approvalStatusColumnId] = {
                    index: parseInt(pendingIdx)
                };
            }
        }

        // ביטול סימון "עתידי" — יצירה/עדכון/המרה דרך ה-UI מסמנים אירוע כקבוע
        if (customSettings.temporaryCheckboxColumnId) {
            columnValues[customSettings.temporaryCheckboxColumnId] = { checked: 'false' };
        }

        return columnValues;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customSettings accessed via settingsRef
    }, []);

    /**
     * יצירת אירוע חדש
     */
    const createEvent = useCallback(async (eventData, startTime, endTime) => {
        const customSettings = settingsRef.current;
        if (!effectiveBoardId || !customSettings?.dateColumnId || !customSettings?.durationColumnId) {
            // הרשומה היחידה לכשל הזה — ה-UI sink מציג ממנה טוסט; הקורא (handleCreateEvent)
            // רק מזהה את ה-null ולא מציג/רושם שוב (איחוד A-double, ui-sink-plan.md)
            logger.error('useMondayEvents.createEvent', 'Missing required settings', new Error('חסרות הגדרות נדרשות ליצירת אירוע'));
            setError('חסרות הגדרות נדרשות');
            return null;
        }

        const itemName = eventData.title;
        const isBillable = eventData.isBillable !== false;
        const newTypeIndex = resolveTimedEventIndex({
            isBillable,
            project: eventData.project || null,
            mapping: customSettings.eventTypeMapping,
            enableDistinction: !!customSettings.enableProjectTypeDistinction
        });

        // הוספת שלד מיידית — כדי שהמשתמש יראה את האירוע ברגע שהמודאל נסגר
        const tempId = `pending_${Date.now()}`;
        const skeletonEvent = {
            id: tempId,
            title: itemName,
            start: startTime,
            end: endTime,
            allDay: false,
            isLoading: true,
            notes: eventData.notes,
            projectId: eventData.itemId || null,
            eventType: getLabelText(newTypeIndex, customSettings.eventTypeLabelMeta) || 'שעתי',
            eventTypeIndex: newTypeIndex,
            isPending: !!customSettings.enableApproval
        };
        setEvents(prev => [...prev, skeletonEvent]);

        try {
            logger.functionStart('useMondayEvents.createEvent', { eventData, startTime, endTime });

            const currentUserId = context?.user?.id;
            const columnValues = buildColumnValues(eventData, startTime, endTime, currentUserId ? { id: currentUserId } : null);
            const columnValuesJson = JSON.stringify(columnValues);

            const createdItem = await createBoardItem(
                monday,
                effectiveBoardId,
                itemName,
                columnValuesJson
            );

            if (createdItem) {
                const newEvent = {
                    id: createdItem.id,
                    title: itemName,
                    start: startTime,
                    end: endTime,
                    mondayItemId: createdItem.id,
                    notes: eventData.notes,
                    projectId: eventData.itemId || null,
                    eventType: getLabelText(newTypeIndex, customSettings.eventTypeLabelMeta) || 'שעתי',
                    eventTypeIndex: newTypeIndex,
                    isPending: !!customSettings.enableApproval,
                    isApproved: false,
                    isRejected: false
                };

                // החלפת השלד באירוע האמיתי
                setEvents(prev => prev.map(ev => ev.id === tempId ? newEvent : ev));
                logger.functionEnd('useMondayEvents.createEvent', { eventId: newEvent.id });
                return newEvent;
            }

            // אם ה-API לא החזיר אייטם — יצירה כושלת. זורקים (לא מחזירים null בשקט
            // — הצלחה כוזבת). ה-throw נתפס ב-catch למטה, מסיר את השלד, נרשם פעם
            // אחת (dedup דרך emit), והקורא ב-MondayCalendar יציג שגיאה ולא טוסט הצלחה.
            throw new MondayApiError('יצירת האירוע נכשלה - לא הוחזר אייטם', {
                functionName: 'useMondayEvents.createEvent'
            });
        } catch (error) {
            // הסרת השלד במקרה שגיאה
            setEvents(prev => prev.filter(ev => ev.id !== tempId));
            logger.error('useMondayEvents.createEvent', 'Error creating event', error);
            setError('שגיאה ביצירת האירוע');
            throw error;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customSettings accessed via settingsRef
    }, [effectiveBoardId, context, monday, buildColumnValues]);

    /**
     * עדכון אירוע קיים
     */
    const updateEvent = useCallback(async (eventId, eventData, startTime, endTime) => {
        const customSettings = settingsRef.current;
        if (!effectiveBoardId || !customSettings?.dateColumnId || !customSettings?.durationColumnId) {
            logger.error('useMondayEvents.updateEvent', 'Missing required settings', new Error('חסרות הגדרות נדרשות לעדכון אירוע'));
            setError('חסרות הגדרות נדרשות');
            return false;
        }

        // שמירת מצב קודם ל-Rollback (דרך ref — סנכרוני ולא גורם ל-recreate של הcallback)
        const previousEvents = [...eventsRef.current];

        try {
            logger.functionStart('useMondayEvents.updateEvent', { eventId, eventData, startTime, endTime });

            const itemName = eventData.title;
            const currentUserId = context?.user?.id;

            // Optimistic update
            // קביעת eventType לפי isBillable - פרויקטים או שוטף
            const isBillable = eventData.isBillable !== false;
            const newTypeIndex = resolveTimedEventIndex({
                isBillable,
                project: eventData.project || null,
                mapping: customSettings.eventTypeMapping,
                enableDistinction: !!customSettings.enableProjectTypeDistinction
            });
            const newEventType = getLabelText(newTypeIndex, customSettings.eventTypeLabelMeta) || 'שעתי';

            setEvents(prev => prev.map(ev =>
                ev.id === eventId
                    ? {
                        ...ev,
                        title: itemName,
                        start: startTime,
                        end: endTime,
                        notes: eventData.notes,
                        projectId: eventData.itemId || ev.projectId,
                        eventType: ev.allDay ? ev.eventType : newEventType,
                        eventTypeIndex: ev.allDay ? ev.eventTypeIndex : newTypeIndex,
                        isTemporary: false // לאחר עדכון/המרה - האירוע כבר לא מתוכנן
                    }
                    : ev
            ));

            const columnValues = buildColumnValues(eventData, startTime, endTime, currentUserId ? { id: currentUserId } : null);

            await updateItemColumnValues(monday, effectiveBoardId, eventId, columnValues);

            // עדכון שם האייטם אם השתנה
            const event = eventsRef.current.find(e => e.id === eventId);
            if (event && itemName !== event.title) {
                const columnValues = { name: itemName };
                await updateItemColumnValues(monday, effectiveBoardId, eventId, columnValues);
            }

            logger.functionEnd('useMondayEvents.updateEvent', { eventId });
            return true;
        } catch (error) {
            // Rollback
            setEvents(previousEvents);
            logger.error('useMondayEvents.updateEvent', 'Error updating event', error);
            setError('שגיאה בעדכון האירוע');
            throw error;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customSettings accessed via settingsRef; events accessed via eventsRef
    }, [effectiveBoardId, context, monday, buildColumnValues]);

    /**
     * מחיקת אירוע
     */
    const deleteEvent = useCallback(async (eventId) => {
        if (!eventId) {
            logger.error('useMondayEvents.deleteEvent', 'Missing event ID', new Error('חסר מזהה אירוע למחיקה'));
            return false;
        }

        // שמירת מצב קודם ל-Rollback (דרך ref)
        const previousEvents = [...eventsRef.current];

        try {
            logger.functionStart('useMondayEvents.deleteEvent', { eventId });

            // Optimistic update
            setEvents(prev => prev.filter(ev => ev.id !== eventId));

            await deleteItem(monday, eventId);

            logger.functionEnd('useMondayEvents.deleteEvent', { eventId });
            return true;
        } catch (error) {
            // Rollback
            setEvents(previousEvents);
            logger.error('useMondayEvents.deleteEvent', 'Error deleting event', error);
            setError('שגיאה במחיקת האירוע');
            throw error;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- events accessed via eventsRef
    }, [monday]);

    /**
     * עדכון אירוע (גרירה או שינוי גודל)
     */
    const updateEventPosition = useCallback(async (event, newStart, newEnd) => {
        const customSettings = settingsRef.current;
        if (!effectiveBoardId || !customSettings?.dateColumnId || !customSettings?.durationColumnId) {
            logger.error('useMondayEvents.updateEventPosition', 'Missing settings for update', new Error('חסרות הגדרות לעדכון מיקום אירוע'));
            return false;
        }

        // שמירת מצב קודם ל-Rollback (דרך ref)
        const previousEvents = [...eventsRef.current];

        try {
            logger.functionStart('useMondayEvents.updateEventPosition', { id: event.mondayItemId, newStart, newEnd });

            // Optimistic update
            const newDurationDays = event.allDay ? calculateDaysDiff(newStart, newEnd) : null;
            setEvents(prev => {
                const filtered = prev.filter(ev => ev.id !== event.id);
                return [...filtered, { 
                    ...event, 
                    start: newStart, 
                    end: newEnd,
                    durationDays: newDurationDays 
                }];
            });

            const columnValues = {};

            if (event.allDay) {
                // אירוע יומי - עדכון תאריך ומשך בימים
                // המרה לתאריך מקומי (לא UTC) כי אירועים יומיים הם ללא שעה
                columnValues[customSettings.dateColumnId] = {
                    date: toLocalDateFormat(newStart)
                    // ללא time - אירוע יומי לא צריך שעה
                };

                // חישוב מספר הימים החדש (לתמיכה ב-Resize)
                const newDurationDays = calculateDaysDiff(newStart, newEnd);
                columnValues[customSettings.durationColumnId] = formatDurationForSave(newDurationDays, event.eventTypeIndex, customSettings.eventTypeMapping);

                // עדכון זמן סיום (אם מוגדר) - לאירועים יומיים רק תאריך
                if (customSettings.endTimeColumnId) {
                    // newEnd הוא exclusive לכן נחסיר יום אחד לתאריך הסיום בפועל
                    const actualEndDate = new Date(newEnd);
                    actualEndDate.setDate(actualEndDate.getDate() - 1);
                    columnValues[customSettings.endTimeColumnId] = {
                        date: toLocalDateFormat(actualEndDate)
                    };
                }

                // לא לשלוח eventTypeStatusColumnId - לא לשנות סוג אירוע
                // לא לחשב עלות עובד - אין משך שעות
            } else {
                // אירוע שעתי - לוגיקה מלאה
                const durationMinutes = Math.round((newEnd - newStart) / 60000);

                // המרת הזמן המקומי ל-UTC
                columnValues[customSettings.dateColumnId] = {
                    date: toMondayDateFormat(newStart),
                    time: toMondayTimeFormat(newStart)
                };

                const durationHours = durationMinutes / 60;
                columnValues[customSettings.durationColumnId] = durationHours.toFixed(2);
                
                // לא משנים את סטטוס סוג הדיווח ב-drag/resize
                // הסטטוס ישתנה רק בשמירה/המרה מפורשת של האירוע

                // עדכון זמן סיום (אם מוגדר)
                if (customSettings.endTimeColumnId) {
                    columnValues[customSettings.endTimeColumnId] = {
                        date: toMondayDateFormat(newEnd),
                        time: toMondayTimeFormat(newEnd)
                    };
                }
            }

            await updateItemColumnValues(monday, effectiveBoardId, event.mondayItemId, columnValues);

            logger.functionEnd('useMondayEvents.updateEventPosition', { id: event.mondayItemId });
            return true;
        } catch (error) {
            // Rollback
            setEvents(previousEvents);
            logger.error('useMondayEvents.updateEventPosition', 'Error updating event position', error);
            setError('שגיאה בעדכון מיקום האירוע');
            throw error;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customSettings accessed via settingsRef; events accessed via eventsRef
    }, [effectiveBoardId, context, monday]);

    /**
     * הוספת אירוע ל-state (לשימוש באירועים יומיים)
     */
    const addEvent = useCallback((event) => {
        setEvents(prev => [...prev, event]);
    }, []);

    /**
     * החלפת אירוע שלד באירוע אמיתי (לפי tempId)
     */
    const resolvePendingEvent = useCallback((tempId, realEvent) => {
        setEvents(prev => prev.map(ev => ev.id === tempId ? realEvent : ev));
    }, []);

    /**
     * הסרת אירוע שלד (במקרה שגיאה)
     */
    const removePendingEvent = useCallback((tempId) => {
        setEvents(prev => prev.filter(ev => ev.id !== tempId));
    }, []);

    // הסרת אירועים מה-state בלבד (ללא API) — מחזיר את האירועים שהוסרו
    // שימוש ב-eventsRef כדי לקרוא את הסטייט הנוכחי synchronously (updater אינו synchronous ב-React 18)
    const removeEventsFromState = useCallback((eventIds) => {
        const removedEvents = eventsRef.current.filter(ev => eventIds.includes(ev.id));
        setEvents(prev => prev.filter(ev => !eventIds.includes(ev.id)));
        return removedEvents;
    }, []);

    // החזרת אירועים ל-state
    const restoreEvents = useCallback((eventsToRestore) => {
        setEvents(prev => [...prev, ...eventsToRestore]);
    }, []);

    return {
        events,
        loading,
        error,
        loadEvents,
        createEvent,
        updateEvent,
        deleteEvent,
        updateEventPosition,
        addEvent,
        resolvePendingEvent,
        removePendingEvent,
        removeEventsFromState,
        restoreEvents
    };
};

