import { useCallback, useMemo } from 'react';
import { useStableT } from '../i18n/useStableT';
import { useSettings, FIELD_MODES, DEFAULT_FIELD_CONFIG } from '../contexts/SettingsContext';
import { createBoardItem, safeApi, assertNoGraphQLErrors } from '../utils/mondayApi';
import { calculateEndDateFromDays, formatDurationForSave } from '../utils/durationUtils';
import { toLocalDateFormat, toMondayDateFormat, toMondayTimeFormat } from '../utils/dateFormatters';
import { getEffectiveBoardId } from '../utils/boardIdResolver';
import { resolveTimedEventIndex, getLabelText, getAllDayIndexes } from '../utils/eventTypeMapping';
import { getPendingIndex } from '../utils/approvalMapping';
import logger from '../utils/logger';
import { escapeGraphQLString } from '../utils/graphqlUtils';

/**
 * Hook לניהול אירועים יומיים (חופשה/מחלה/מילואים ודיווחים מרובים)
 * @param {Object} params - פרמטרים
 * @param {Object} params.monday - Monday SDK instance
 * @param {Object} params.context - Monday context
 * @param {Object} params.modals - Modal state from useEventModals
 * @param {Function} params.showSuccess - Toast success
 * @param {Function} params.showError - Toast error
 * @param {Function} params.showWarning - Toast warning
 * @param {Function} params.loadEvents - Load events function
 * @param {Function} params.addEvent - Add event to state
 * @param {Function} params.resolvePendingEvent - Replace skeleton with real event
 * @param {Function} params.removePendingEvent - Remove skeleton on error
 * @param {Object} params.currentViewRange - Current view date range
 * @returns {Object} All-day event handlers
 */
export const useAllDayEvents = ({
    monday,
    context,
    modals,
    showSuccess,
    showError,
    showWarning,
    loadEvents,
    addEvent,
    resolvePendingEvent,
    removePendingEvent,
    currentViewRange
}) => {
    const t = useStableT();
    const { customSettings } = useSettings();

    // חישוב לוח דיווחים אפקטיבי
    const effectiveBoardId = useMemo(() =>
        getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    /**
     * יצירת אירוע יומי (מחלה/חופשה/מילואים) או דיווחים מרובים
     */
    const handleCreateAllDayEvent = useCallback(async (allDayData) => {
        logger.functionStart('handleCreateAllDayEvent', { type: allDayData.type, date: allDayData.date });

        if (!effectiveBoardId || !customSettings.dateColumnId) {
            logger.error('handleCreateAllDayEvent', 'Missing board ID or date column ID', new Error('חסר מזהה לוח או עמודת תאריך לדיווח יומי'));
            return;
        }

        try {
            const dateStr = toLocalDateFormat(allDayData.date);

            const reporterName = context?.user?.name || 'לא ידוע';
            const reporterId = context?.user?.id || null;

            if (allDayData.type === 'reports') {
                await createMultipleReports({
                    allDayData,
                    reporterName,
                    reporterId,
                    customSettings,
                    monday,
                    effectiveBoardId,
                    addEvent,
                    resolvePendingEvent,
                    removePendingEvent,
                    showWarning
                });
            } else {
                await createSingleAllDayEvent({
                    allDayData,
                    dateStr,
                    reporterName,
                    reporterId,
                    customSettings,
                    monday,
                    effectiveBoardId,
                    addEvent,
                    resolvePendingEvent,
                    removePendingEvent
                });
            }


        } catch (error) {
            logger.error('handleCreateAllDayEvent', 'Error creating all-day event', error);
            throw error;
        }
    }, [effectiveBoardId, context, customSettings, monday, addEvent, resolvePendingEvent, removePendingEvent, showWarning]);

    /**
     * עדכון אירוע יומי (שינוי תת-סוג)
     * newType: אובייקט { index, label, color } לפי הלייבל הנבחר ב-allDayTypeStatusColumnId
     */
    const handleUpdateAllDayEvent = useCallback(async (newType) => {
        // אינטגרציית Day-off (W4.4, החלטה D5): כשמקור ההיעדרויות הוא לוח החופשות,
        // עדכון תת-סוג של אירוע יומי בלוח הדיווחים חסום — ההזנה עוברת לרכיב Day-off.
        // הגנת עומק: תפריט הסוגים במודל ממילא מוסתר במצב זה.
        if (customSettings.absenceSource === 'dayoff') {
            logger.warn('handleUpdateAllDayEvent', 'Blocked: absenceSource is dayoff - all-day type updates are managed in the Day-off component (D5)');
            return;
        }
        const allDayEventToEdit = modals.allDayModal.eventToEdit;
        if (!allDayEventToEdit || !allDayEventToEdit.mondayItemId) {
            // רשומה אחת שנושאת את הודעת המשתמש — ה-UI sink מציג ממנה את הטוסט (איחוד A-double)
            logger.error('handleUpdateAllDayEvent', 'Missing event ID for update', new Error(t('toasts.updateEventNotFound')));
            return;
        }

        try {
            const allDayTypeIndex = newType?.index ?? newType;
            const typeName = newType?.label || '';
            if (allDayTypeIndex == null || !typeName) {
                showError(t('toasts.invalidEventType'));
                return;
            }

            const reporterName = context?.user?.name || 'לא ידוע';
            const itemName = `${typeName} - ${reporterName}`;

            // עדכון שם האייטם ותת-סוג בלבד - ללא שינוי תאריך או שעות
            const columnValues = {};

            if (customSettings.allDayTypeStatusColumnId && allDayTypeIndex != null) {
                columnValues[customSettings.allDayTypeStatusColumnId] = {
                    index: parseInt(allDayTypeIndex, 10)
                };
            }

            // עדכון שם האייטם בנפרד (escape למניעת שבירת GraphQL)
            const updateMutation = `mutation {
                change_simple_column_value(
                    item_id: ${allDayEventToEdit.mondayItemId},
                    board_id: ${effectiveBoardId},
                    column_id: "name",
                    value: "${escapeGraphQLString(itemName)}"
                ) {
                    id
                }
            }`;

            const nameRes = await safeApi(monday, 'handleUpdateAllDayEvent:updateName', updateMutation);
            // GraphQL soft-error (status 200 עם res.errors) ≠ הצלחה — זורק MondayApiError
            // כדי שלא יוצג טוסט "עודכן בהצלחה" כוזב. ה-soft-error כבר נרשם ב-safeApi.
            assertNoGraphQLErrors(nameRes, { functionName: 'handleUpdateAllDayEvent:updateName', query: updateMutation });

            // עדכון עמודות נוספות (סטטוס) אם יש
            if (Object.keys(columnValues).length > 0) {
                const updateColumnsMutation = `mutation {
                    change_multiple_column_values(
                        item_id: ${allDayEventToEdit.mondayItemId},
                        board_id: ${effectiveBoardId},
                        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
                    ) {
                        id
                    }
                }`;
                const colsRes = await safeApi(monday, 'handleUpdateAllDayEvent:updateColumns', updateColumnsMutation);
                assertNoGraphQLErrors(colsRes, { functionName: 'handleUpdateAllDayEvent:updateColumns', query: updateColumnsMutation });
            }

            // רענון האירועים מהשרת כדי לעדכן את ה-state
            if (currentViewRange) {
                loadEvents(currentViewRange.start, currentViewRange.end);
            }

            showSuccess(t('toasts.eventUpdated'));
            modals.closeAllDayModal();
        } catch (error) {
            logger.error('useAllDayEvents', 'Error in handleUpdateAllDayEvent', error);
            throw error;
        }
    }, [effectiveBoardId, customSettings, monday, modals, showSuccess, showError, loadEvents, currentViewRange, context?.user?.name, t]);

    return {
        handleCreateAllDayEvent,
        handleUpdateAllDayEvent
    };
};

// --- Helper functions ---

/**
 * יצירת דיווחים מרובים (reports)
 */
async function createMultipleReports({
    allDayData,
    reporterName,
    reporterId,
    customSettings,
    monday,
    effectiveBoardId,
    addEvent,
    resolvePendingEvent,
    removePendingEvent,
    showWarning
}) {
    // שלב 1: חישוב מראש של start/end לכל דיווח + יצירת שלדים מיידית
    let currentStart = new Date(allDayData.date);
    currentStart.setHours(8, 0, 0, 0);

    const reportPlans = []; // { report, eventStart, eventEnd, tempId, itemName, skipped }
    const now = new Date();

    for (const report of allDayData.reports) {
        let eventStart = new Date(currentStart);
        let eventEnd;

        if (report.startTime && report.endTime) {
            const [startHours, startMinutes] = report.startTime.split(':').map(Number);
            const [endHours, endMinutes] = report.endTime.split(':').map(Number);

            eventStart.setHours(startHours, startMinutes, 0, 0);
            eventEnd = new Date(eventStart);
            eventEnd.setHours(endHours, endMinutes, 0, 0);

            if (eventEnd <= eventStart) {
                eventEnd.setDate(eventEnd.getDate() + 1);
            }
        } else {
            const durationMinutes = (parseFloat(report.hours) || 0) * 60;
            eventEnd = new Date(eventStart.getTime() + durationMinutes * 60000);
        }

        // בדיקת זמן עתידי
        if (eventStart > now) {
            showWarning(`לא ניתן לדווח שעות על זמן עתידי (${report.projectName || 'ללא פרויקט'})`);
            logger.debug('createMultipleReports', 'Skipped future report', { eventStart, now, projectName: report.projectName });
            currentStart = eventEnd;
            reportPlans.push({ report, eventStart, eventEnd, tempId: null, itemName: null, skipped: true });
            continue;
        }

        const itemName = buildItemName({ report, reporterName, customSettings }) || 'ללא שם';
        const isBillable = report.isBillable !== false;
        const typeIndex = resolveTimedEventIndex({
            isBillable,
            project: report.project || null,
            mapping: customSettings.eventTypeMapping,
            enableDistinction: !!customSettings.enableProjectTypeDistinction
        });
        const tempId = `pending_report_${Date.now()}_${reportPlans.length}`;

        // הוספת שלד מיידית
        addEvent({
            id: tempId,
            title: itemName,
            start: new Date(eventStart),
            end: new Date(eventEnd),
            allDay: false,
            isLoading: true,
            notes: report.notes,
            projectId: report.projectId || null,
            eventType: getLabelText(typeIndex, customSettings.eventTypeLabelMeta),
            eventTypeIndex: typeIndex,
            isPending: !!customSettings.enableApproval
        });

        reportPlans.push({ report, eventStart, eventEnd, tempId, itemName, skipped: false });
        currentStart = eventEnd;
    }

    // שלב 2: קריאות API ברצף — החלפת שלדים באירועים אמיתיים
    for (const plan of reportPlans) {
        if (plan.skipped) continue;

        const { report, eventStart, eventEnd, tempId, itemName } = plan;

        try {
            // בתוך ה-try: buildReportColumnValues עלול לזרוק (למשל תאריך לא תקין —
            // toMonday* זורקים מאז Phase 7), וכך השלד האופטימי מוסר ב-catch ולא דולף.
            const columnValues = buildReportColumnValues({
                eventStart,
                eventEnd,
                report,
                reporterId,
                isSpecialEventType: false,
                customSettings
            });

            const columnValuesJson = JSON.stringify(columnValues);

            const createdItem = await createBoardItem(
                monday,
                effectiveBoardId,
                itemName,
                columnValuesJson
            );

            if (createdItem) {
                const isBillable = report.isBillable !== false;
                const typeIndex = resolveTimedEventIndex({
                    isBillable,
                    project: report.project || null,
                    mapping: customSettings.eventTypeMapping,
                    enableDistinction: !!customSettings.enableProjectTypeDistinction
                });
                const newEvent = {
                    id: createdItem.id,
                    title: itemName,
                    start: eventStart,
                    end: eventEnd,
                    allDay: false,
                    notes: report.notes,
                    mondayItemId: createdItem.id,
                    projectId: report.projectId || null,
                    eventType: getLabelText(typeIndex, customSettings.eventTypeLabelMeta),
                    eventTypeIndex: typeIndex,
                    isPending: !!customSettings.enableApproval,
                    isApproved: false,
                    isRejected: false
                };
                resolvePendingEvent(tempId, newEvent);
            } else {
                removePendingEvent(tempId);
            }
        } catch (error) {
            removePendingEvent(tempId);
            // מעבירים את ה-error עצמו — log-once מטביע עליו __loggedId, כך שהרישום אצל
            // הקורא (אחרי ה-throw) לא ייצור רשומה/טוסט כפולים
            logger.error('createMultipleReports', `Error creating report item "${itemName}"`, error);
            throw error;
        }
    }

    logger.functionEnd('createMultipleReports', { type: 'reports', count: allDayData.reports.length });
}

/**
 * יצירת אירוע יומי בודד (מחלה/חופשה/מילואים)
 */
async function createSingleAllDayEvent({
    allDayData,
    dateStr,
    reporterName,
    reporterId,
    customSettings,
    monday,
    effectiveBoardId,
    addEvent,
    resolvePendingEvent,
    removePendingEvent
}) {
    // אינטגרציית Day-off (W4.4, החלטה D5): כשמקור ההיעדרויות הוא לוח החופשות,
    // יצירת אירועי יומי (חופשה/מחלה/...) בלוח הדיווחים חסומה — ההזנה עוברת
    // לרכיב Day-off. דיווחים מרובים (createMultipleReports) נשארים פעילים.
    // הגנת עומק: תפריט הסוגים במודל ממילא מוסתר במצב זה.
    if (customSettings.absenceSource === 'dayoff') {
        logger.warn('createSingleAllDayEvent', 'Blocked: absenceSource is dayoff - all-day absence entry is managed in the Day-off component (D5)');
        return;
    }

    // allDayData.type מגיע כאינדקס בעמודת התת-סוג (allDayTypeStatusColumnId)
    // המודל גם מעביר את הלייבל בפועל ב-allDayData.typeLabel
    const allDayTypeIndex = allDayData.type;
    const eventName = allDayData.typeLabel || '';
    if (!eventName || allDayTypeIndex == null) {
        const labelErr = new Error('חסר לייבל או אינדקס תת-סוג לדיווח יומי');
        labelErr.details = { allDayData };
        logger.error('createSingleAllDayEvent', 'Missing all-day sub-type label or index', labelErr);
        return;
    }
    const itemName = `${eventName} - ${reporterName}`;

    // האינדקס היחיד של "יומי" בעמודת eventTypeStatus (לפי המיפוי)
    const allDayMainIndex = (getAllDayIndexes(customSettings.eventTypeMapping) || [])[0] || null;

    // מספר הימים (ברירת מחדל: 1)
    const durationDays = allDayData.durationDays || 1;

    // שלב 1: הוספת שלדים מיידית לכל הימים
    const tempIds = [];
    for (let i = 0; i < durationDays; i++) {
        const dayDate = new Date(allDayData.date);
        dayDate.setDate(dayDate.getDate() + i);
        dayDate.setHours(0, 0, 0, 0);
        const endDate = calculateEndDateFromDays(dayDate, 1);
        const tempId = `pending_allday_${Date.now()}_${i}`;
        tempIds.push(tempId);

        addEvent({
            id: tempId,
            title: itemName,
            start: new Date(dayDate),
            end: endDate,
            allDay: true,
            isLoading: true,
            eventType: eventName,
            eventTypeIndex: allDayMainIndex,
            allDayTypeIndex: String(allDayTypeIndex),
            durationDays: 1,
            isPending: !!customSettings.enableApproval
        });
    }

    // שלב 2: יצירת אייטם נפרד לכל יום — החלפת השלד באירוע אמיתי
    for (let i = 0; i < durationDays; i++) {
        const dayDate = new Date(allDayData.date);
        dayDate.setDate(dayDate.getDate() + i);
        dayDate.setHours(0, 0, 0, 0);
        const dayDateStr = toLocalDateFormat(dayDate);

        const columnValues = {};
        // לאירועים יומיים - תאריך בלבד ללא שעה
        columnValues[customSettings.dateColumnId] = {
            date: dayDateStr
        };

        // משך תמיד 1 יום לכל אייטם
        if (customSettings.durationColumnId) {
            columnValues[customSettings.durationColumnId] = formatDurationForSave(1, allDayMainIndex, customSettings.eventTypeMapping);
        }

        if (customSettings.reporterColumnId && reporterId) {
            columnValues[customSettings.reporterColumnId] = {
                personsAndTeams: [
                    { id: parseInt(reporterId), kind: "person" }
                ]
            };
        }

        // עמודת ה-event type מקבלת את הלייבל היחיד "יומי"
        if (customSettings.eventTypeStatusColumnId && allDayMainIndex != null) {
            columnValues[customSettings.eventTypeStatusColumnId] = {
                index: parseInt(allDayMainIndex, 10)
            };
        }

        // עמודת התת-סוג מקבלת את הלייבל הנבחר ע"י המשתמש
        if (customSettings.allDayTypeStatusColumnId && allDayTypeIndex != null) {
            columnValues[customSettings.allDayTypeStatusColumnId] = {
                index: parseInt(allDayTypeIndex, 10)
            };
        }

        // ביטול סימון "עתידי" (אירוע יומי שנוצר ידנית הוא לא מתוכנן)
        if (customSettings.temporaryCheckboxColumnId) {
            columnValues[customSettings.temporaryCheckboxColumnId] = { checked: 'false' };
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

        const columnValuesJson = JSON.stringify(columnValues);

        try {
            const createdItem = await createBoardItem(
                monday,
                effectiveBoardId,
                itemName,
                columnValuesJson
            );

            if (createdItem) {
                const endDate = calculateEndDateFromDays(dayDate, 1);

                const newEvent = {
                    id: createdItem.id,
                    title: itemName,
                    start: new Date(dayDate),
                    end: endDate,
                    allDay: true,
                    mondayItemId: createdItem.id,
                    eventType: eventName,
                    eventTypeIndex: allDayMainIndex,
                    allDayTypeIndex: String(allDayTypeIndex),
                    durationDays: 1,
                    isPending: !!customSettings.enableApproval,
                    isApproved: false,
                    isRejected: false
                };
                resolvePendingEvent(tempIds[i], newEvent);
            } else {
                removePendingEvent(tempIds[i]);
            }
        } catch (error) {
            removePendingEvent(tempIds[i]);
            // מעבירים את ה-error עצמו — ראו הערה ב-createMultipleReports
            logger.error('createSingleAllDayEvent', `Error creating day item ${i}`, error);
            throw error;
        }
    }

    logger.functionEnd('createSingleAllDayEvent', { type: allDayData.type, durationDays, itemsCreated: durationDays });
}

/**
 * בניית column values לדיווח
 */
function buildReportColumnValues({
    eventStart,
    eventEnd,
    report,
    reporterId,
    isSpecialEventType,
    customSettings
}) {
    const columnValues = {};

    columnValues[customSettings.dateColumnId] = {
        date: toMondayDateFormat(eventStart),
        time: toMondayTimeFormat(eventStart)
    };

    // עמודת זמן סיום (אם מוגדרת)
    if (customSettings.endTimeColumnId) {
        columnValues[customSettings.endTimeColumnId] = {
            date: toMondayDateFormat(eventEnd),
            time: toMondayTimeFormat(eventEnd)
        };
    }

    // חישוב משך זמן בדקות
    if (!isSpecialEventType) {
        const durationMinutes = (eventEnd.getTime() - eventStart.getTime()) / 60000;
        const durationHours = durationMinutes / 60;
        columnValues[customSettings.durationColumnId] = durationHours.toFixed(2);
    }

    // הוספת פרויקט
    if (report.projectId && customSettings.projectColumnId) {
        columnValues[customSettings.projectColumnId] = {
            item_ids: [parseInt(report.projectId)]
        };
    }

    // הוספת קישור להקצאה
    if (report.assignmentId && customSettings.assignmentColumnId) {
        columnValues[customSettings.assignmentColumnId] = {
            item_ids: [parseInt(report.assignmentId)]
        };
    }

    // הוספת הערות
    if (report.notes && customSettings.notesColumnId) {
        columnValues[customSettings.notesColumnId] = report.notes;
    }

    // הוספת משימה
    if (report.taskId && customSettings.taskColumnId) {
        columnValues[customSettings.taskColumnId] = {
            item_ids: [parseInt(report.taskId)]
        };
    }

    // הוספת מדווח
    if (customSettings.reporterColumnId && reporterId) {
        columnValues[customSettings.reporterColumnId] = {
            personsAndTeams: [
                { id: parseInt(reporterId), kind: "person" }
            ]
        };
    }

    // הוספת סטטוס לפי אינדקס
    if (customSettings.eventTypeStatusColumnId) {
        const isBillable = report.isBillable !== false;
        const typeIndex = resolveTimedEventIndex({
            isBillable,
            project: report.project || null,
            mapping: customSettings.eventTypeMapping,
            enableDistinction: !!customSettings.enableProjectTypeDistinction
        });

        if (typeIndex != null) {
            columnValues[customSettings.eventTypeStatusColumnId] = {
                index: parseInt(typeIndex, 10)
            };
        }

        // אם זה שוטף
        if (!isBillable && report.nonBillableType && customSettings.nonBillableStatusColumnId) {
            columnValues[customSettings.nonBillableStatusColumnId] = {
                label: report.nonBillableType
            };
        }
    }

    // הוספת שלב
    if (report.stageId && customSettings.stageColumnId) {
        columnValues[customSettings.stageColumnId] = {
            label: report.stageId
        };
    }

    // עמודת לקוח (אם יש לקוח לפרויקט ויש עמודת יעד)
    if (report.project?.customerId && customSettings.customerReportColumnId) {
        columnValues[customSettings.customerReportColumnId] = {
            item_ids: [parseInt(report.project.customerId)]
        };
    }

    // סטטוס אישור - כתיבת "ממתין" ביצירת דיווח חדש
    if (customSettings.enableApproval && customSettings.approvalStatusColumnId) {
        const pendingIdx = getPendingIndex(customSettings.approvalStatusMapping);
        if (pendingIdx != null) {
            columnValues[customSettings.approvalStatusColumnId] = {
                index: parseInt(pendingIdx)
            };
        }
    }

    // ביטול סימון "עתידי" — דיווחי שעות נוצרים תמיד כקבועים
    if (customSettings.temporaryCheckboxColumnId) {
        columnValues[customSettings.temporaryCheckboxColumnId] = { checked: 'false' };
    }

    return columnValues;
}

/**
 * בניית שם האייטם לפי מבנה הדיווח
 */
function buildItemName({ report, reporterName, customSettings }) {
    const projectName = report.projectName;
    const isBillableReport = report.isBillable !== false;
    const fieldConfig = customSettings.fieldConfig || DEFAULT_FIELD_CONFIG;

    if (isBillableReport) {
        // בניית שם לפי שדות פעילים ב-fieldConfig
        if (fieldConfig.task !== FIELD_MODES.HIDDEN && report.taskName) {
            const taskName = report.taskName || 'ללא משימה';
            return projectName ? `${projectName} - ${taskName}` : taskName;
        } else if (fieldConfig.stage !== FIELD_MODES.HIDDEN && report.stageId) {
            const projectDisplay = projectName || 'ללא פרויקט';
            const stageLabel = report.stageId || '';
            return stageLabel ? `${projectDisplay} - ${stageLabel}` : projectDisplay;
        } else {
            return projectName || 'ללא פרויקט';
        }
    } else {
        const nonBillableLabel = report.nonBillableType || 'שוטף';
        return `${nonBillableLabel} - ${reporterName}`;
    }
}

