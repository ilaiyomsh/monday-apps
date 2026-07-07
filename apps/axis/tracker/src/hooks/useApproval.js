import { useCallback, useMemo, useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { getEffectiveBoardId } from '../utils/boardIdResolver';
import { getApprovedIndex, getRejectedIndex } from '../utils/approvalMapping';
import { updateItemColumnValues } from '../utils/mondayApi';
import logger from '../utils/logger';

// no-op כברירת-מחדל לפונקציות אופציונליות (toast/loadEvents) כשהצרכן לא העביר אותן
const noop = () => {};

/**
 * Hook מרכזי ללוגיקת אישור מנהל
 * @param {Object} params
 * @param {Object} params.monday - Monday SDK instance
 * @param {Object} params.context - Monday context
 * @param {Array} [params.events] - אירועים נוכחיים (לאישור-נבחרים / אישור-כל-הממתינים)
 * @param {Object} [params.currentViewRange] - טווח התצוגה הנוכחית `{ start, end }`
 * @param {*} [params.filterRules] - חוקי הסינון לטעינה מחדש
 * @param {Function} [params.loadEvents] - `(start, end, filterRules) => void` לטעינה מחדש
 * @param {Object} [params.approvalSelection] - `{ selectedCount, isSelected, clearSelection }`
 * @param {Object} [params.toasts] - `{ showSuccess, showError, showWarning, showErrorWithDetails }`
 * @param {Function} [params.t] - מתרגם i18n
 * @returns {Object} approval state and actions
 */
export const useApproval = ({
    monday,
    context,
    events,
    currentViewRange,
    filterRules,
    loadEvents,
    approvalSelection,
    toasts,
    t,
}) => {
    const { customSettings } = useSettings();

    const effectiveBoardId = useMemo(() =>
        getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    // מצב הפיצ'ר
    const isApprovalEnabled = !!(
        customSettings.enableApproval &&
        customSettings.approvalStatusColumnId &&
        customSettings.approvalStatusMapping &&
        Object.keys(customSettings.approvalStatusMapping).length > 0
    );

    // בדיקת הרשאה
    const currentUserId = String(context?.user?.id || '');
    const isManager = isApprovalEnabled &&
        Array.isArray(customSettings.approvedManagerIds) &&
        customSettings.approvedManagerIds.includes(currentUserId);

    // מצב עיבוד אישור (הועבר מ-MondayCalendar בגל 5.1.1a)
    const [isProcessingApproval, setIsProcessingApproval] = useState(false);

    // עדכון סטטוס אישור של אירוע בודד
    const updateApprovalStatus = useCallback(async (itemId, statusIndex) => {
        if (!effectiveBoardId || !customSettings.approvalStatusColumnId || statusIndex == null) {
            logger.warn('useApproval', 'updateApprovalStatus skipped: missing board/column/index', {
                itemId,
                hasBoard: !!effectiveBoardId,
                hasColumn: !!customSettings.approvalStatusColumnId,
                statusIndex,
            });
            return false;
        }

        try {
            const columnValues = {
                [customSettings.approvalStatusColumnId]: {
                    index: parseInt(statusIndex)
                }
            };

            await updateItemColumnValues(monday, effectiveBoardId, itemId, columnValues);
            return true;
        } catch (error) {
            logger.error('useApproval', `Failed to update approval status for item ${itemId}`, error);
            throw error;
        }
    }, [monday, effectiveBoardId, customSettings.approvalStatusColumnId]);

    // אישור אירוע בודד
    const approveEvent = useCallback(async (event) => {
        const approvedIdx = getApprovedIndex(customSettings.approvalStatusMapping);
        if (!approvedIdx) {
            logger.error('useApproval', 'No approved index configured', new Error('לא הוגדר אינדקס סטטוס "מאושר" במיפוי האישורים'));
            return false;
        }

        logger.functionStart('approveEvent', { itemId: event.mondayItemId });
        return updateApprovalStatus(event.mondayItemId, approvedIdx);
    }, [customSettings.approvalStatusMapping, updateApprovalStatus]);

    // דחיית אירוע בודד
    const rejectEvent = useCallback(async (event) => {
        const rejectedIdx = getRejectedIndex(customSettings.approvalStatusMapping);
        if (!rejectedIdx) {
            logger.error('useApproval', 'No rejected index configured', new Error('לא הוגדר אינדקס סטטוס "נדחה" במיפוי האישורים'));
            return false;
        }

        logger.functionStart('rejectEvent', { itemId: event.mondayItemId });
        return updateApprovalStatus(event.mondayItemId, rejectedIdx);
    }, [customSettings.approvalStatusMapping, updateApprovalStatus]);

    // אישור אירועים מרובים
    const approveMultiple = useCallback(async (eventList) => {
        const approvedIdx = getApprovedIndex(customSettings.approvalStatusMapping);
        if (!approvedIdx) {
            // נשמר ה-payload המקורי על err.details כדי שה-sink יוכל להציגו
            const err = new Error('אישור מרובה בוטל: לא הוגדר אינדקס סטטוס "מאושר" במיפוי האישורים');
            err.details = { count: eventList?.length };
            logger.error('useApproval', 'approveMultiple aborted: no approved index configured', err);
            return { succeeded: 0, failed: 0 };
        }

        logger.functionStart('approveMultiple', { count: eventList.length });

        let succeeded = 0;
        let failed = 0;

        // ביצוע ב-batches של 5
        for (let i = 0; i < eventList.length; i += 5) {
            const batch = eventList.slice(i, i + 5);
            const results = await Promise.allSettled(
                batch.map(event => updateApprovalStatus(event.mondayItemId, approvedIdx))
            );

            succeeded += results.filter(r => r.status === 'fulfilled' && r.value).length;
            failed += results.filter(r => r.status === 'rejected' || !r.value).length;
        }

        logger.functionEnd('approveMultiple', { succeeded, failed });
        return { succeeded, failed };
    }, [customSettings.approvalStatusMapping, updateApprovalStatus]);

    // אישור כל הממתינים מתוך רשימת אירועים
    // !e.isDayOff — היעדרויות Day-off הן read-only ולעולם לא מאושרות מה-tracker (W4.2, D10)
    const approveAllPending = useCallback(async (eventList) => {
        const pendingEvents = eventList.filter(e => e.isPending && !e.isDayOff && !e.isTemporary);
        if (pendingEvents.length === 0) return { succeeded: 0, failed: 0 };

        return approveMultiple(pendingEvents);
    }, [approveMultiple]);

    // --- Wrappers (UI side-effects) — הועברו מ-MondayCalendar בגל 5.1.1a ---
    // ברירות-מחדל ל-toast: no-op כשהצרכן לא העביר; t: ערך-ברירת-מחדל הוא המפתח עצמו.
    // עטוף ב-useMemo כדי להימנע מ-deps לא-יציבים ב-useCallbacks למטה.
    const showSuccess = useMemo(() => toasts?.showSuccess ?? noop, [toasts]);
    const showWarning = useMemo(() => toasts?.showWarning ?? noop, [toasts]);
    const showErrorWithDetails = useMemo(() => toasts?.showErrorWithDetails ?? noop, [toasts]);
    const translate = useMemo(() => t ?? ((key) => key), [t]);
    const reload = useMemo(() => loadEvents ?? noop, [loadEvents]);
    const clearSelection = useMemo(() => approvalSelection?.clearSelection ?? noop, [approvalSelection]);

    // אישור אירועים נבחרים — toast + reload + clear-selection
    const approveSelected = useCallback(async () => {
        if (!approvalSelection?.selectedCount) return;

        setIsProcessingApproval(true);
        try {
            const selectedEvents = (events ?? []).filter(e => approvalSelection.isSelected(e.id));
            const result = await approveMultiple(selectedEvents);

            if (result.succeeded > 0) {
                showSuccess(translate('toasts.bulkApprovalSucceeded', { count: result.succeeded }));
                if (currentViewRange) {
                    reload(currentViewRange.start, currentViewRange.end, filterRules);
                }
            }
            // כשלים פרטניים כבר הוצגו דרך ה-UI sink (הרשומה הקנונית של safeApi) —
            // אין סיכום-שגיאה נוסף כאן (נתיב הצגה יחיד, ui-sink-plan.md)

            clearSelection();
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'approveSelected' });
        } finally {
            setIsProcessingApproval(false);
        }
    }, [approvalSelection, events, approveMultiple, showSuccess, showErrorWithDetails, currentViewRange, reload, filterRules, translate, clearSelection]);

    // אישור כל הממתינים בתצוגה הנוכחית
    const approveAllInWeek = useCallback(async () => {
        setIsProcessingApproval(true);
        try {
            const result = await approveAllPending(events ?? []);

            if (result.succeeded > 0) {
                showSuccess(translate('toasts.bulkApprovalSucceeded', { count: result.succeeded }));
                if (currentViewRange) {
                    reload(currentViewRange.start, currentViewRange.end, filterRules);
                }
            } else {
                showWarning(translate('toasts.noPendingApprovals'));
            }
            // כשלים פרטניים כבר הוצגו דרך ה-UI sink — ראו approveSelected

            clearSelection();
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'approveAllInWeek' });
        } finally {
            setIsProcessingApproval(false);
        }
    }, [approveAllPending, events, showSuccess, showWarning, showErrorWithDetails, currentViewRange, reload, filterRules, translate, clearSelection]);

    // אישור אירוע בודד מתוך מודל — toast + reload
    const approveEventWithFeedback = useCallback(async (event) => {
        try {
            await approveEvent(event);
            showSuccess(translate('toasts.approvalApproved'));
            if (currentViewRange) {
                reload(currentViewRange.start, currentViewRange.end, filterRules);
            }
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'approveEventWithFeedback' });
        }
    }, [approveEvent, showSuccess, showErrorWithDetails, currentViewRange, reload, filterRules, translate]);

    // דחיית אירוע בודד מתוך מודל — toast + reload
    const rejectEventWithFeedback = useCallback(async (event) => {
        try {
            await rejectEvent(event);
            showSuccess(translate('toasts.approvalRejected'));
            if (currentViewRange) {
                reload(currentViewRange.start, currentViewRange.end, filterRules);
            }
        } catch (error) {
            showErrorWithDetails(error, { functionName: 'rejectEventWithFeedback' });
        }
    }, [rejectEvent, showSuccess, showErrorWithDetails, currentViewRange, reload, filterRules, translate]);

    return {
        isApprovalEnabled,
        isManager,
        approveEvent,
        rejectEvent,
        approveMultiple,
        approveAllPending,
        // נוספו בגל 5.1.1a
        isProcessingApproval,
        approveSelected,
        approveAllInWeek,
        approveEventWithFeedback,
        rejectEventWithFeedback,
    };
};

