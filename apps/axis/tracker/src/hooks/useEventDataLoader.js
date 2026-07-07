import { useCallback, useMemo } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { getEffectiveBoardId } from '../utils/boardIdResolver';
import logger from '../utils/logger';

/**
 * Hook לטעינת נתוני אירוע לעריכה
 * מחלץ את כל המידע הנדרש מהאירוע שכבר נטען ב-loadEvents
 * @param {Object} params - פרמטרים
 * @param {Object} params.context - Monday context
 * @param {Object} params.modals - Modal state from useEventModals
 * @returns {Object} loadEventDataForEdit function
 */
export const useEventDataLoader = ({
    context,
    modals
}) => {
    const { customSettings } = useSettings();

    // חישוב לוח דיווחים אפקטיבי
    const effectiveBoardId = useMemo(() =>
        getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    /**
     * טעינת נתוני אירוע לעריכה
     * הנתונים כבר נטענו ב-loadEvents - שימוש ישיר ללא API call
     * @param {Object} event - האירוע לטעינה
     */
    const loadEventDataForEdit = useCallback(async (event) => {
        if (!effectiveBoardId || !event?.mondayItemId) return;

        try {
            logger.functionStart('loadEventDataForEdit', { eventId: event.mondayItemId });

            // עדכון selectedItem ו-selectedTaskData ממידע שכבר קיים על האירוע
            if (event.projectId && event.projectName) {
                modals.setSelectedItem({ id: event.projectId, name: event.projectName });
            }

            const updatedEvent = { ...event };

            if (event.taskId && event.taskName) {
                updatedEvent.selectedTaskData = { id: event.taskId, name: event.taskName };
            }

            modals.setEventToEdit(updatedEvent);
            logger.functionEnd('loadEventDataForEdit', { eventId: event.mondayItemId });
        } catch (error) {
            logger.error('loadEventDataForEdit', 'Error loading event data for edit', error);
            throw error;
        }
    }, [effectiveBoardId, modals]);

    return { loadEventDataForEdit };
};

