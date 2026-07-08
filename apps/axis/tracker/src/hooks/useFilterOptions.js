import { useState, useCallback, useEffect, useRef } from 'react';
import { safeApi } from '../utils/mondayApi';
import logger from '../utils/logger';
import { handleGlobalError } from '../utils/globalErrorHandler';

/**
 * Hook לשליפת אפשרויות פילטר (מדווחים ופרויקטים)
 * @param {Object} monday - Monday SDK instance
 * @param {string} effectiveBoardId - לוח הדיווחים האפקטיבי
 * @param {Object} customSettings - הגדרות מותאמות
 * @param {boolean} enabled - האם לטעון (false = דחייה עד שהאפליקציה מוכנה)
 * @returns {Object} - מדווחים זמינים ופונקציות רענון
 */
export const useFilterOptions = (monday, effectiveBoardId, customSettings, enabled = true) => {
    const [reporters, setReporters] = useState([]);
    const [loadingReporters, setLoadingReporters] = useState(false);
    const [reportersError, setReportersError] = useState(null);

    // שמירת המצב האחרון למניעת קריאות כפולות
    const lastFetchParams = useRef({ boardId: null, columnId: null });

    /**
     * שליפת מדווחים ייחודיים
     * אם מוגדר לוח עובדים ייעודי - ישתמש בו
     * אחרת - ישתמש בלוח הדיווחים
     */
    const fetchReporters = useCallback(async () => {
        // בדיקה אם יש הגדרת לוח עובדים ייעודי
        const useEmployeesBoard = customSettings?.filterEmployeesBoardId && customSettings?.filterEmployeesColumnId;

        // קביעת לוח ועמודה לפי ההגדרות
        const targetBoardId = useEmployeesBoard
            ? customSettings.filterEmployeesBoardId
            : effectiveBoardId;
        const targetColumnId = useEmployeesBoard
            ? customSettings.filterEmployeesColumnId
            : customSettings?.reporterColumnId;

        if (!targetBoardId || !targetColumnId || !monday) {
            logger.debug('useFilterOptions', 'Missing required params for fetching reporters', {
                targetBoardId,
                targetColumnId,
                useEmployeesBoard
            });
            return;
        }

        // מניעת קריאות כפולות עם אותם פרמטרים
        const currentParams = {
            boardId: targetBoardId,
            columnId: targetColumnId
        };
        if (JSON.stringify(currentParams) === JSON.stringify(lastFetchParams.current)) {
            return;
        }
        lastFetchParams.current = currentParams;

        setLoadingReporters(true);
        setReportersError(null);

        try {
            logger.functionStart('useFilterOptions.fetchReporters', {
                targetBoardId,
                targetColumnId,
                useEmployeesBoard
            });

            // שליפה מלוח העובדים עם pagination — תמיכה ב->500 פריטים
            let allItems = [];
            let cursor = null;

            do {
                const cursorParam = cursor ? `, cursor: "${cursor}"` : '';
                const query = `query {
                    boards(ids: [${targetBoardId}]) {
                        items_page(limit: 500${cursorParam}) {
                            cursor
                            items {
                                id
                                name
                                column_values(ids: ["${targetColumnId}"]) {
                                    ... on PeopleValue {
                                        persons_and_teams {
                                            id
                                            kind
                                        }
                                    }
                                }
                            }
                        }
                    }
                }`;

                const response = await safeApi(monday, 'useFilterOptions:loadReporters', query);
                const page = response.data?.boards?.[0]?.items_page;

                if (page?.items) {
                    allItems = [...allItems, ...page.items];
                }
                cursor = page?.cursor || null;
            } while (cursor);

            const items = allItems;

            // מיפוי עובדים - שם הפריט כשם התצוגה, ID מעמודת People
            const reportersMap = new Map();
            items.forEach(item => {
                const personColumn = item.column_values?.[0];
                const persons = personColumn?.persons_and_teams || [];
                persons.forEach(person => {
                    if (person.kind === 'person' && !reportersMap.has(person.id)) {
                        reportersMap.set(person.id, {
                            id: person.id,
                            name: item.name, // שם הפריט = שם העובד
                            photo: null
                        });
                    }
                });
            });

            if (reportersMap.size === 0) {
                logger.debug('useFilterOptions', 'No reporters found in board');
                setReporters([]);
                return;
            }

            const reportersList = Array.from(reportersMap.values());
            setReporters(reportersList);
            logger.functionEnd('useFilterOptions.fetchReporters', { count: reportersList.length });

        } catch (error) {
            logger.error('useFilterOptions', 'Error fetching reporters', error);
            setReportersError('שגיאה בטעינת מדווחים');
            handleGlobalError(error, { functionName: 'useFilterOptions.fetchReporters' });
        } finally {
            setLoadingReporters(false);
        }
    }, [monday, effectiveBoardId, customSettings?.reporterColumnId, customSettings?.filterEmployeesBoardId, customSettings?.filterEmployeesColumnId]);

    // טעינה ראשונית — רק אחרי שהאפליקציה מוכנה (enabled)
    useEffect(() => {
        if (!enabled) return;
        fetchReporters();
    }, [fetchReporters, enabled]);

    /**
     * רענון ידני של המדווחים
     */
    const refetchReporters = useCallback(() => {
        lastFetchParams.current = { boardId: null, columnId: null };
        fetchReporters();
    }, [fetchReporters]);

    return {
        reporters,
        loadingReporters,
        reportersError,
        refetchReporters,
    };
};

