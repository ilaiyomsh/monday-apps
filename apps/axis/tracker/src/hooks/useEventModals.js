import { useState, useCallback } from 'react';
import logger from '../utils/logger';

/**
 * @typedef {Object} EventModalState
 * @property {boolean} isOpen - האם המודל פתוח
 * @property {Object|null} pendingSlot - סלוט ממתין לאירוע חדש
 * @property {Object|null} eventToEdit - אירוע לעריכה
 * @property {boolean} isEditMode - האם במצב עריכה
 * @property {boolean} isLoading - האם בטעינה
 */

/**
 * @typedef {Object} AllDayModalState
 * @property {boolean} isOpen - האם המודל פתוח
 * @property {Date|null} date - תאריך לאירוע יומי
 * @property {Object|null} eventToEdit - אירוע לעריכה
 * @property {boolean} isEditMode - האם במצב עריכה
 */

/**
 * Hook לניהול מצב המודלים של אירועים
 * @returns {Object} state ופונקציות לניהול המודלים
 */
export const useEventModals = () => {
    // State - Modal רגיל
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pendingSlot, setPendingSlot] = useState(null);
    const [newEventTitle, setNewEventTitle] = useState('');
    const [selectedItem, setSelectedItem] = useState(null);
    
    // State - Edit mode
    const [eventToEdit, setEventToEdit] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isLoadingEventData, setIsLoadingEventData] = useState(false);

    // State - Convert mode (for temporary/planned events)
    const [isConvertMode, setIsConvertMode] = useState(false);
    
    // State - All-day events
    const [isAllDayModalOpen, setIsAllDayModalOpen] = useState(false);
    const [pendingAllDayDate, setPendingAllDayDate] = useState(null);
    const [allDayEventToEdit, setAllDayEventToEdit] = useState(null);
    const [isAllDayEditMode, setIsAllDayEditMode] = useState(false);

    /**
     * פתיחת מודל אירוע רגיל
     */
    const openEventModal = useCallback((slot) => {
        logger.debug('useEventModals', 'Opening event modal', { slot });
        setPendingSlot(slot);
        setIsModalOpen(true);
        setIsEditMode(false);
        setEventToEdit(null);
    }, []);

    /**
     * פתיחת מודל אירוע יומי
     */
    const openAllDayModal = useCallback((date) => {
        logger.debug('useEventModals', 'Opening all-day modal', { date });
        setPendingAllDayDate(date);
        setIsAllDayModalOpen(true);
        setIsAllDayEditMode(false);
        setAllDayEventToEdit(null);
    }, []);

    /**
     * פתיחת מודל לעריכת אירוע רגיל
     */
    const openEventModalForEdit = useCallback((event) => {
        logger.debug('useEventModals', 'Opening event modal for edit', { eventId: event?.id });
        setPendingSlot({ start: event.start, end: event.end });
        setNewEventTitle(event.title || '');
        // הגדרת selectedItem מיד כדי שסקציות task/stage/notes יהיו גלויות מרגע הפתיחה
        // selectedProjectData עדיף (אובייקט מלא), אחרת בונים מ-projectId+projectName שקיימים על האירוע
        const initialProject = event?.selectedProjectData
            || (event?.projectId && event?.projectName ? { id: event.projectId, name: event.projectName } : null);
        setSelectedItem(initialProject);
        setIsModalOpen(true);
        setIsEditMode(true);
        setEventToEdit(event);
    }, []);

    /**
     * פתיחת מודל לעריכת אירוע יומי
     */
    const openAllDayModalForEdit = useCallback((event) => {
        logger.debug('useEventModals', 'Opening all-day modal for edit', { eventId: event?.id });
        setPendingAllDayDate(event.start);
        setAllDayEventToEdit(event);
        setIsAllDayEditMode(true);
        setIsAllDayModalOpen(true);
    }, []);

    /**
     * פתיחת מודל להמרת אירוע מתוכנן (Temporary) לאירוע רגיל
     * הזמנים נעולים, הכותרת נמחקת, ההערות כוללות את הכותרת המקורית
     */
    const openEventModalForConvert = useCallback((event) => {
        logger.debug('useEventModals', 'Opening event modal for convert', { eventId: event?.id, title: event?.title });
        setPendingSlot({ start: event.start, end: event.end });
        // הכותרת נמחקת - המשתמש חייב לבחור פרויקט
        setNewEventTitle('');
        setSelectedItem(null);
        setIsModalOpen(true);
        setIsEditMode(true);
        setIsConvertMode(true);
        // שמירת האירוע המקורי עם הערות שכוללות את הכותרת המקורית
        setEventToEdit({
            ...event,
            originalTitle: event.title,
            // הוספת הכותרת המקורית להערות
            notes: event.title
                ? `אירוע מקורי: ${event.title}\n\n${event.notes || ''}`
                : event.notes || ''
        });
    }, []);

    /**
     * סגירת כל המודלים
     */
    const closeAllModals = useCallback(() => {
        logger.debug('useEventModals', 'Closing all modals');
        // סגירת מודל רגיל
        setIsModalOpen(false);
        setPendingSlot(null);
        setNewEventTitle('');
        setSelectedItem(null);
        setEventToEdit(null);
        setIsEditMode(false);
        setIsConvertMode(false);
        setIsLoadingEventData(false);

        // סגירת מודל יומי
        setIsAllDayModalOpen(false);
        setPendingAllDayDate(null);
        setAllDayEventToEdit(null);
        setIsAllDayEditMode(false);
    }, []);

    /**
     * סגירת מודל רגיל בלבד
     */
    const closeEventModal = useCallback(() => {
        logger.debug('useEventModals', 'Closing event modal');
        setIsModalOpen(false);
        setPendingSlot(null);
        setNewEventTitle('');
        setSelectedItem(null);
        setEventToEdit(null);
        setIsEditMode(false);
        setIsConvertMode(false);
        setIsLoadingEventData(false);
    }, []);

    /**
     * סגירת מודל יומי בלבד
     */
    const closeAllDayModal = useCallback(() => {
        logger.debug('useEventModals', 'Closing all-day modal');
        setIsAllDayModalOpen(false);
        setPendingAllDayDate(null);
        setAllDayEventToEdit(null);
        setIsAllDayEditMode(false);
    }, []);

    return {
        // מודל רגיל - state
        eventModal: {
            isOpen: isModalOpen,
            pendingSlot,
            eventToEdit,
            isEditMode,
            isConvertMode,
            isLoading: isLoadingEventData,
            newEventTitle,
            selectedItem
        },
        // מודל יומי - state
        allDayModal: {
            isOpen: isAllDayModalOpen,
            date: pendingAllDayDate,
            eventToEdit: allDayEventToEdit,
            isEditMode: isAllDayEditMode
        },
        // פעולות
        openEventModal,
        openAllDayModal,
        openEventModalForEdit,
        openEventModalForConvert,
        openAllDayModalForEdit,
        closeAllModals,
        closeEventModal,
        closeAllDayModal,
        // setters ישירים (לשימוש במקרים מורכבים)
        setIsModalOpen,
        setPendingSlot,
        setNewEventTitle,
        setSelectedItem,
        setEventToEdit,
        setIsEditMode,
        setIsConvertMode,
        setIsLoadingEventData,
        setIsAllDayModalOpen,
        setPendingAllDayDate,
        setAllDayEventToEdit,
        setIsAllDayEditMode
    };
};

