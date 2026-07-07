import { useState, useEffect, useCallback } from 'react';
import mondaySdk from 'monday-sdk-js';
import { useSettings } from '../contexts/SettingsContext';
import { fetchActiveAssignments, safeApi } from '../utils/mondayApi';
import logger from '../utils/logger';
import { handleGlobalError } from '../utils/globalErrorHandler';
import { isPortfolioMode } from '../utils/portfolioResolver';
import { useProjectColors } from '../contexts/ProjectColorsContext';

const monday = mondaySdk();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 דקות
const CACHE_KEY_PREFIX = 'useProjects_cache_';

// מפתח cache לפי הגדרות — מתאפס אוטומטית כשההגדרות משתנות
const getCacheKey = (settings) => {
    const sig = [
        settings.connectedBoardId,
        settings.useAssignmentsMode ? 'assign' : 'direct',
        settings.projectsSourceMode || 'board',
        (settings.peopleColumnIds || []).join(','),
        settings.projectStatusColumnId || '',
        settings.projectTypeColumnId || '',
        settings.customerColumnId || '',
    ].join('|');
    return CACHE_KEY_PREFIX + sig;
};

const readCache = (key) => {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem(key); return null; }
        return data;
    } catch (e) {
        logger.warn('useProjects', 'Failed to read projects cache', { key, error: e?.message });
        return null;
    }
};

const writeCache = (key, data) => {
    try {
        sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {
        logger.warn('useProjects', 'Failed to write projects cache', { key, error: e?.message });
    }
};

/**
 * Hook לאחזור פרויקטים המשויכים למשתמש הנוכחי, כולל המשימות שלהם
 * תומך בסינון נוסף לפי עמודת סטטוס (אם מופעל)
 * @returns {Object} { projects, loading, error, refetch }
 */
export const useProjects = () => {
    const { customSettings } = useSettings();
    const { mergeAndPersist: mergeProjectColors } = useProjectColors();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // בדיקה אם מצב הקצאות מופעל (Assignments Mode)
    const isAssignmentsMode = !!customSettings.useAssignmentsMode;
    // בדיקה אם מצב Portfolio מופעל — אורתוגונלי ל-Assignments
    const isPortfolio = isPortfolioMode(customSettings);

    // במצב Portfolio peopleColumnIds מתאפס אוטומטית ל-`portfolio_project_owner`
    // אם המשתמש לא הגדיר עמודה אחרת (built-in column ID יציב בכל פורטפוליו).
    const effectivePeopleColumnIds =
        isPortfolio && (!customSettings.peopleColumnIds || customSettings.peopleColumnIds.length === 0)
            ? ['portfolio_project_owner']
            : customSettings.peopleColumnIds;

    const fetchProjects = useCallback(async (forceRefresh = false) => {
        const cacheKey = getCacheKey(customSettings);

        // הצג מ-cache מיידית (אם קיים ולא force refresh)
        if (!forceRefresh) {
            const cached = readCache(cacheKey);
            if (cached) {
                logger.debug('useProjects', 'Loaded projects from cache', { count: cached.length });
                setProjects(cached);
                setLoading(false);
                // רענון ברקע — ממשיך לטעון מה-API כדי לעדכן
            }
        }

        // מצב הקצאות - שימוש ב-fetchActiveAssignments
        if (isAssignmentsMode) {
            logger.functionStart('useProjects.fetchProjects (assignments mode)', {
                boardId: customSettings.assignmentsBoardId,
                personColumnId: customSettings.assignmentPersonColumnId,
                startDateColumnId: customSettings.assignmentStartDateColumnId,
                endDateColumnId: customSettings.assignmentEndDateColumnId,
                projectLinkColumnId: customSettings.assignmentProjectLinkColumnId
            });

            setLoading(true);
            setError(null);

            try {
                // במצב Portfolio סוג הפרויקט נקרא ישירות מ-projectTypeColumnId על פריט הפורטפוליו
                // (אין mirror). במצב board הקיים — המקור הוא mirror על פריט ההקצאה (projectTypeSourceColumnId)
                // עם נפילה ל-projectTypeColumnId אם לא מוגדר.
                const inlineProjectTypeColumnId = isPortfolio
                    ? (customSettings.projectTypeColumnId || null)
                    : (customSettings.projectTypeSourceColumnId || customSettings.projectTypeColumnId || null);

                const projects = await fetchActiveAssignments(
                    monday,
                    customSettings.assignmentsBoardId,
                    customSettings.assignmentPersonColumnId,
                    customSettings.assignmentStartDateColumnId,
                    customSettings.assignmentEndDateColumnId,
                    customSettings.assignmentProjectLinkColumnId,
                    {
                        customerColumnId: customSettings.customerColumnId || null,
                        projectTypeSourceColumnId: inlineProjectTypeColumnId,
                        projectTypeMapping: customSettings.projectTypeMapping || null,
                    }
                );

                setProjects(projects);
                writeCache(cacheKey, projects);
                logger.functionEnd('useProjects.fetchProjects (assignments mode)', {
                    count: projects.length
                });
            } catch (err) {
                logger.apiError('fetchProjects (assignments mode)', err);
                logger.error('useProjects', 'Error fetching projects from assignments', err);
                setError("שגיאה בטעינת הנתונים מהקצאות");
                handleGlobalError(err, { functionName: 'useProjects.fetchProjects (assignments)' });
                setProjects([]);
            } finally {
                setLoading(false);
            }
            return;
        }

        // מצב רגיל - שימוש ב-peopleColumnIds (תאימות לאחור; במצב Portfolio נופל ל-default)
        if (!customSettings.connectedBoardId || !effectivePeopleColumnIds || effectivePeopleColumnIds.length === 0) {
            logger.warn('useProjects', 'Missing settings: connectedBoardId or peopleColumnIds');
            setError("חסרות הגדרות לוח");
            return;
        }

        const statusFilterEnabled = customSettings.projectStatusFilterEnabled &&
            customSettings.projectStatusColumnId &&
            customSettings.projectActiveStatusValues?.length > 0;

        const hasProjectType = !!(customSettings.projectTypeColumnId && customSettings.projectTypeMapping);
        const hasCustomer = !!customSettings.customerColumnId;

        // איסוף מזהי עמודות לשליפה inline (ללא כפילויות)
        // כך כל הנתונים מגיעים בקריאת items_page אחת במקום 3 קריאות נפרדות
        const inlineColIds = [...new Set([
            statusFilterEnabled ? customSettings.projectStatusColumnId : null,
            hasProjectType ? customSettings.projectTypeColumnId : null,
            hasCustomer ? customSettings.customerColumnId : null,
        ].filter(Boolean))];

        const columnValuesFragment = inlineColIds.length > 0
            ? `column_values(ids: ${JSON.stringify(inlineColIds)}) {
                        id text
                        ... on StatusValue { value }
                        ... on BoardRelationValue { linked_items { id name } }
                    }`
            : '';

        logger.functionStart('useProjects.fetchProjects', {
            boardId: customSettings.connectedBoardId,
            peopleColumnIds: effectivePeopleColumnIds,
            isPortfolio,
            statusFilterEnabled,
            inlineColumns: inlineColIds,
        });

        setLoading(true);
        setError(null);

        try {
            const rules = effectivePeopleColumnIds.map(columnId => ({
                column_id: columnId,
                compare_value: ["assigned_to_me"],
                operator: "any_of"
            }));

            const rulesString = rules.map(rule =>
                `{
                    column_id: "${rule.column_id}",
                    compare_value: ${JSON.stringify(rule.compare_value)},
                    operator: ${rule.operator}
                }`
            ).join(',\n');

            // לולאת pagination — תמיכה ב->500 פרויקטים
            let allItems = [];
            let cursor = null;

            do {
                const cursorParam = cursor ? `, cursor: "${cursor}"` : '';
                const query = `query {
                    boards(ids: ${customSettings.connectedBoardId}) {
                        items_page(
                            limit: 500${cursorParam},
                            query_params: {
                                operator: or,
                                rules: [${rulesString}]
                            }
                        ) {
                            cursor
                            items {
                                id
                                name
                                ${columnValuesFragment}
                            }
                        }
                    }
                }`;

                const res = await safeApi(monday, 'useProjects.fetchProjects', query);
                const page = res.data?.boards?.[0]?.items_page;

                if (page?.items) {
                    allItems = [...allItems, ...page.items];
                }
                cursor = page?.cursor || null;
            } while (cursor);

            if (allItems.length > 0) {
                const beforeCount = allItems.length;

                // סינון סטטוס + העשרה — הכל מה-column_values שכבר הגיע inline
                const processedProjects = allItems
                    .filter(item => {
                        if (!statusFilterEnabled) return true;
                        const col = item.column_values?.find(c => c.id === customSettings.projectStatusColumnId);
                        return customSettings.projectActiveStatusValues.includes(col?.text || '');
                    })
                    .map(item => {
                        const project = { id: item.id, name: item.name };

                        if (hasProjectType) {
                            const col = item.column_values?.find(c => c.id === customSettings.projectTypeColumnId);
                            // mapping מאוכלס לפי label.id; ב-runtime Monday מחזיר value.index שזהה ל-id.
                            let labelId = '';
                            try {
                                labelId = col?.value ? String(JSON.parse(col.value)?.index ?? '') : '';
                            } catch (e) {
                                // value לא תקין — נמשיך בלי projectType
                                logger.warn('useProjects', 'Failed to parse project type value', { itemId: item.id, error: e?.message });
                            }
                            project.projectType = labelId ? (customSettings.projectTypeMapping[labelId] || null) : null;
                        }

                        if (hasCustomer) {
                            const col = item.column_values?.find(c => c.id === customSettings.customerColumnId);
                            const linked = col?.linked_items?.[0];
                            project.customerId = linked?.id || null;
                            project.customerName = linked?.name || null;
                        }

                        return project;
                    });

                setProjects(processedProjects);
                writeCache(cacheKey, processedProjects);
                logger.functionEnd('useProjects.fetchProjects', {
                    beforeFilter: beforeCount,
                    afterFilter: processedProjects.length,
                    statusFilterApplied: statusFilterEnabled,
                });
            } else {
                setProjects([]);
                logger.warn('useProjects', 'No data in response');
            }
        } catch (err) {
            logger.apiError('fetchProjects', err);
            logger.error('useProjects', 'Error fetching projects', err);
            setError("שגיאה בטעינת הנתונים");
            handleGlobalError(err, { functionName: 'useProjects.fetchProjects' });
            setProjects([]);
        } finally {
            setLoading(false);
        }
    }, [
        isAssignmentsMode,
        isPortfolio,
        customSettings.assignmentsBoardId,
        customSettings.assignmentPersonColumnId,
        customSettings.assignmentStartDateColumnId,
        customSettings.assignmentEndDateColumnId,
        customSettings.assignmentProjectLinkColumnId,
        customSettings.connectedBoardId,
        // effectivePeopleColumnIds נגזר מ-peopleColumnIds + isPortfolio, אז מספיקה התלות במקור
        customSettings.peopleColumnIds,
        customSettings.projectStatusFilterEnabled,
        customSettings.projectStatusColumnId,
        customSettings.projectActiveStatusValues,
        customSettings.projectTypeColumnId,
        customSettings.projectTypeSourceColumnId,
        customSettings.projectTypeMapping,
        customSettings.customerColumnId,
    ]);

    useEffect(() => {
        // טעינה במצב הקצאות אם כל ההגדרות קיימות
        if (isAssignmentsMode) {
            fetchProjects();
            return;
        }
        // טעינה במצב רגיל אם ההגדרות הבסיסיות קיימות (effectivePeopleColumnIds נופל ל-default ב-Portfolio)
        if (customSettings.connectedBoardId && effectivePeopleColumnIds && effectivePeopleColumnIds.length > 0) {
            fetchProjects();
        }
    }, [fetchProjects, isAssignmentsMode]);

    // Eager-merge ID-ים של פרויקטים למיפוי הצבעים — חדשים מקבלים stringToColor ונשמרים
    useEffect(() => {
        if (!projects || projects.length === 0) return;
        const ids = projects.map(p => String(p.id)).filter(Boolean);
        if (ids.length > 0) mergeProjectColors(ids);
    }, [projects, mergeProjectColors]);

    return {
        projects,
        loading,
        error,
        refetch: fetchProjects
    };
};
