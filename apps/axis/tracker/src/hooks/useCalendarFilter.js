import { useState, useCallback, useEffect, useMemo } from 'react';
import logger from '../utils/logger';

/**
 * Hook לניהול פילטר לוח השנה
 * מאפשר סינון אירועים לפי מדווח ופרויקט
 * ברירת המחדל: מציג רק אירועים של המשתמש הנוכחי (assigned_to_me) - מטופל ב-useMondayEvents
 * @param {Object} customSettings - הגדרות מותאמות מה-context
 * @param {Object} context - Monday context
 * @returns {Object} - מצב הפילטר ופונקציות עדכון
 */
export const useCalendarFilter = (customSettings, context) => {
    // State עבור בחירת פילטרים
    // כברירת מחדל ריק - הפילטר assigned_to_me מופעל אוטומטית ב-useMondayEvents
    const [selectedReporterIds, setSelectedReporterIds] = useState([]);
    const [selectedProjectIds, setSelectedProjectIds] = useState([]);
    const [isInitialized, setIsInitialized] = useState(false);

    // אתחול - מסמן שה-hook מוכן
    useEffect(() => {
        if (!isInitialized && customSettings) {
            setIsInitialized(true);
            logger.debug('useCalendarFilter', 'Initialized (default: show current user events only)');
        }
    }, [customSettings, isInitialized]);

    /**
     * בניית חוקי פילטר ל-GraphQL
     * מחזיר מערך חוקים לשימוש ב-query_params.rules
     */
    const buildFilterRules = useCallback(() => {
        const rules = [];

        // פילטר לפי מדווחים
        if (selectedReporterIds.length > 0 && customSettings?.reporterColumnId) {
            rules.push({
                column_id: customSettings.reporterColumnId,
                // פורמט People: "person-{id}"
                compare_value: selectedReporterIds.map(id => `person-${id}`),
                operator: "any_of"
            });
            logger.debug('useCalendarFilter', 'Added reporter filter rule', {
                columnId: customSettings.reporterColumnId,
                reporterIds: selectedReporterIds
            });
        }

        // פילטר לפי פרויקטים — board_relation + any_of עם מזהים מספריים
        if (selectedProjectIds.length > 0 && customSettings?.projectColumnId) {
            rules.push({
                column_id: customSettings.projectColumnId,
                compare_value: selectedProjectIds.map(id => parseInt(id)),
                operator: "any_of"
            });
            logger.debug('useCalendarFilter', 'Added project filter rule', {
                columnId: customSettings.projectColumnId,
                projectIds: selectedProjectIds
            });
        }

        return rules;
    }, [selectedReporterIds, selectedProjectIds, customSettings]);

    // חוקי הפילטר (memoized)
    const filterRules = useMemo(() => buildFilterRules(), [buildFilterRules]);

    // בדיקה אם יש פילטר פעיל
    const hasActiveFilter = useMemo(() =>
        selectedReporterIds.length > 0 || selectedProjectIds.length > 0,
        [selectedReporterIds, selectedProjectIds]
    );

    // ניקוי כל הפילטרים
    const clearFilters = useCallback(() => {
        logger.debug('useCalendarFilter', 'Clearing all filters');
        setSelectedReporterIds([]);
        setSelectedProjectIds([]);
    }, []);

    // איפוס לברירת מחדל (מנקה פילטרים ידניים - assigned_to_me יופעל אוטומטית)
    const resetToDefaults = useCallback(() => {
        logger.debug('useCalendarFilter', 'Resetting to default (current user only)');
        clearFilters();
    }, [clearFilters]);

    return {
        // State
        selectedReporterIds,
        selectedProjectIds,

        // Setters
        setSelectedReporterIds,
        setSelectedProjectIds,

        // חוקי פילטר מוכנים ל-GraphQL
        filterRules,

        // Helpers
        hasActiveFilter,
        clearFilters,
        resetToDefaults,
        isInitialized
    };
};

