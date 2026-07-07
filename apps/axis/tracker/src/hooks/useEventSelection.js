import { useState, useCallback } from 'react';
import logger from '../utils/logger';

/**
 * Hook לניהול מצב בחירה מרובה לאישור מנהל
 * נפרד מ-useMultiSelect הקיים (שמשמש לשכפול/מחיקה עם CTRL)
 */
export const useEventSelection = () => {
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedEventIds, setSelectedEventIds] = useState(new Set());

    const toggleSelection = useCallback((eventId) => {
        setSelectedEventIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(eventId)) {
                newSet.delete(eventId);
            } else {
                newSet.add(eventId);
            }
            return newSet;
        });
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedEventIds(new Set());
        setIsSelectionMode(false);
        logger.debug('useEventSelection', 'Selection cleared');
    }, []);

    const toggleSelectionMode = useCallback(() => {
        setIsSelectionMode(prev => {
            if (prev) {
                // יוצאים ממצב בחירה - מנקים
                setSelectedEventIds(new Set());
                return false;
            }
            return true;
        });
    }, []);

    const isSelected = useCallback((eventId) => {
        return selectedEventIds.has(eventId);
    }, [selectedEventIds]);

    const getSelectedArray = useCallback(() => {
        return Array.from(selectedEventIds);
    }, [selectedEventIds]);

    return {
        isSelectionMode,
        selectedEventIds,
        selectedCount: selectedEventIds.size,
        toggleSelection,
        clearSelection,
        toggleSelectionMode,
        isSelected,
        getSelectedArray
    };
};

