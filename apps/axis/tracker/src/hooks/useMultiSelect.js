import { useState, useCallback, useEffect, useRef } from 'react';
import logger from '../utils/logger';

/**
 * Hook לניהול בחירה מרובה של אירועים בלוח השנה
 * כולל מעקב אחר מקשי CTRL/CMD ופעולות bulk
 * @returns {Object} state ופונקציות לניהול בחירה מרובה
 */
export const useMultiSelect = () => {
    // State - בחירה מרובה של אירועים
    const [selectedEventIds, setSelectedEventIds] = useState(new Set());
    const [isCtrlPressed, setIsCtrlPressed] = useState(false);
    const [isProcessingBulk, setIsProcessingBulk] = useState(false);
    // ref לגישה ל-selection בתוך listener ללא re-register
    const selectionRef = useRef(selectedEventIds);
    selectionRef.current = selectedEventIds;

    // מעקב גלובלי אחר מקש CTRL/CMD לבחירה מרובה + ESC לביטול בחירה
    useEffect(() => {
        const handleKeyDown = (e) => {
            try {
                if (e.ctrlKey || e.metaKey) {
                    setIsCtrlPressed(true);
                }
                // ESC לביטול בחירה מרובה (שימוש ב-ref למניעת re-register של listeners)
                if (e.key === 'Escape' && selectionRef.current.size > 0) {
                    setSelectedEventIds(new Set());
                    logger.debug('useMultiSelect', 'ESC pressed - selection cleared');
                }
            } catch (error) {
                logger.error('useMultiSelect', 'keydown handler failed', error);
            }
        };

        const handleKeyUp = (e) => {
            try {
                if (!e.ctrlKey && !e.metaKey) {
                    setIsCtrlPressed(false);
                }
            } catch (error) {
                logger.error('useMultiSelect', 'keyup handler failed', error);
            }
        };

        // גם כאשר החלון מאבד פוקוס - לאפס את המצב
        const handleBlur = () => {
            try {
                setIsCtrlPressed(false);
            } catch (error) {
                logger.error('useMultiSelect', 'blur handler failed', error);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- selectionRef is stable

    /**
     * הוספה/הסרה של אירוע מהבחירה
     * @param {string} eventId - מזהה האירוע
     */
    const toggleSelection = useCallback((eventId) => {
        setSelectedEventIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(eventId)) {
                newSet.delete(eventId);
                logger.debug('useMultiSelect', 'Event removed from selection', { eventId });
            } else {
                newSet.add(eventId);
                logger.debug('useMultiSelect', 'Event added to selection', { eventId });
            }
            return newSet;
        });
    }, []);

    /**
     * בחירת אירוע יחיד (החלפת כל הבחירה)
     * @param {string} eventId - מזהה האירוע
     */
    const selectSingle = useCallback((eventId) => {
        setSelectedEventIds(new Set([eventId]));
        logger.debug('useMultiSelect', 'Single event selected', { eventId });
    }, []);

    /**
     * בחירת מספר אירועים
     * @param {string[]} eventIds - רשימת מזהי אירועים
     */
    const selectMultiple = useCallback((eventIds) => {
        setSelectedEventIds(new Set(eventIds));
        logger.debug('useMultiSelect', 'Multiple events selected', { count: eventIds.length });
    }, []);

    /**
     * ניקוי כל הבחירה
     */
    const clearSelection = useCallback(() => {
        setSelectedEventIds(new Set());
        logger.debug('useMultiSelect', 'Selection cleared');
    }, []);

    /**
     * בדיקה האם אירוע נבחר
     * @param {string} eventId - מזהה האירוע
     * @returns {boolean}
     */
    const isSelected = useCallback((eventId) => {
        return selectedEventIds.has(eventId);
    }, [selectedEventIds]);

    /**
     * קבלת מערך של האירועים הנבחרים
     * @returns {string[]}
     */
    const getSelectedArray = useCallback(() => {
        return Array.from(selectedEventIds);
    }, [selectedEventIds]);

    return {
        // State
        selectedEventIds,
        isCtrlPressed,
        isProcessingBulk,
        selectedCount: selectedEventIds.size,
        hasSelection: selectedEventIds.size > 0,
        
        // Actions
        toggleSelection,
        selectSingle,
        selectMultiple,
        clearSelection,
        isSelected,
        getSelectedArray,
        setIsProcessingBulk
    };
};

