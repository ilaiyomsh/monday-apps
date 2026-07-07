import { useState, useCallback } from 'react';
import mondaySdk from 'monday-sdk-js';
import { useSettings } from '../contexts/SettingsContext';
import { fetchItemsStatus, safeApi } from '../utils/mondayApi';
import logger from '../utils/logger';
import { handleGlobalError } from '../utils/globalErrorHandler';
import { escapeGraphQLString } from '../utils/graphqlUtils';
import { isPortfolioMode, resolveTasksBoardId } from '../utils/portfolioResolver';

const monday = mondaySdk();

const PORTFOLIO_PROJECT_LINK_COL = 'portfolio_project_link';

/**
 * Hook לניהול משימות מרובות - עבור מספר פרויקטים במקביל
 * תומך בסינון לפי עמודת סטטוס (אם מופעל)
 * @returns {Object} { tasks, loadingTasks, fetchForProject, createTask }
 */
export const useTasksMultiple = () => {
    const { customSettings } = useSettings();
    const [tasks, setTasks] = useState({}); // { projectId: [tasks] }
    const [loadingTasks, setLoadingTasks] = useState({}); // { projectId: boolean }

    /**
     * אחזור משימות לפי פרויקט
     * משתמש ב-tasksProjectColumnId ישירות מההגדרות
     * תומך בסינון נוסף לפי סטטוס
     */
    const fetchForProject = useCallback(async (projectId) => {
        const isPortfolio = isPortfolioMode(customSettings);
        const projectLinkColumnId = isPortfolio
            ? PORTFOLIO_PROJECT_LINK_COL
            : customSettings.tasksProjectColumnId;

        if (!projectLinkColumnId || !projectId) {
            logger.warn('useTasksMultiple', 'Missing tasksProjectColumnId or projectId for fetching tasks');
            setTasks(prev => ({ ...prev, [projectId]: [] }));
            return;
        }

        // בדיקה אם פילטר סטטוס מופעל
        const statusFilterEnabled = customSettings.taskStatusFilterEnabled &&
            customSettings.taskStatusColumnId &&
            customSettings.taskActiveStatusValues?.length > 0;

        logger.functionStart('useTasksMultiple.fetchForProject', { 
            projectId,
            statusFilterEnabled,
            statusColumnId: statusFilterEnabled ? customSettings.taskStatusColumnId : null
        });

        setLoadingTasks(prev => ({ ...prev, [projectId]: true }));

        try {
            // שאילתה ישירה - לוקחים את הפרויקט ובודקים מה יש לו בעמודת המשימות
            // (במצב Portfolio זו portfolio_project_link; שאר הצורה זהה)
            const query = `query {
                items(ids: [${projectId}]) {
                    name
                    column_values(ids: ["${projectLinkColumnId}"]) {
                        ...on BoardRelationValue {
                            linked_items {
                                id
                                name
                            }
                        }
                    }
                }
            }`;

            const res = await safeApi(monday, 'useTasksMultiple.fetchForProject', query);

            if (res.data?.items?.[0]?.column_values?.[0]?.linked_items) {
                let items = res.data.items[0].column_values[0].linked_items;
                
                // סינון לפי סטטוס (אם מופעל)
                if (statusFilterEnabled && items.length > 0) {
                    logger.debug('useTasksMultiple', 'Applying status filter', {
                        projectId,
                        itemCount: items.length,
                        statusColumnId: customSettings.taskStatusColumnId,
                        activeValues: customSettings.taskActiveStatusValues
                    });
                    
                    const itemIds = items.map(item => item.id);
                    const statusMap = await fetchItemsStatus(
                        monday,
                        itemIds,
                        customSettings.taskStatusColumnId
                    );
                    
                    // סינון לפי ערכי הסטטוס הפעילים
                    items = items.filter(item => {
                        const itemStatus = statusMap.get(item.id.toString());
                        return customSettings.taskActiveStatusValues.includes(itemStatus);
                    });
                    
                    logger.debug('useTasksMultiple', 'Status filter applied', {
                        projectId,
                        beforeCount: itemIds.length,
                        afterCount: items.length
                    });
                }
                
                setTasks(prev => ({ ...prev, [projectId]: items }));
                logger.functionEnd('useTasksMultiple.fetchForProject', { 
                    projectId, 
                    count: items.length,
                    statusFilterApplied: statusFilterEnabled
                });
            } else {
                setTasks(prev => ({ ...prev, [projectId]: [] }));
                logger.debug('useTasksMultiple', 'No tasks found for project', projectId);
            }
        } catch (err) {
            logger.apiError('useTasksMultiple.fetchForProject', err);
            logger.error('useTasksMultiple', 'Error fetching tasks for project', err);
            setTasks(prev => ({ ...prev, [projectId]: [] }));
            handleGlobalError(err, { functionName: 'useTasksMultiple.fetchForProject' });
        } finally {
            setLoadingTasks(prev => ({ ...prev, [projectId]: false }));
        }
    }, [
        customSettings.projectsSourceMode,
        customSettings.tasksProjectColumnId,
        customSettings.taskStatusFilterEnabled,
        customSettings.taskStatusColumnId,
        customSettings.taskActiveStatusValues
    ]);

    /**
     * יצירת משימה חדשה
     */
    const createTaskForProject = useCallback(async (projectId, taskName) => {
        const isPortfolio = isPortfolioMode(customSettings);
        const projectLinkColumnId = isPortfolio
            ? PORTFOLIO_PROJECT_LINK_COL
            : customSettings.tasksProjectColumnId;

        if (!customSettings.connectedBoardId || !taskName?.trim() || !projectId) {
            logger.warn('useTasksMultiple', 'Missing settings or data for creating task');
            return null;
        }
        if (!projectLinkColumnId) {
            logger.warn('useTasksMultiple', 'tasksProjectColumnId is required but not set');
            return null;
        }

        const tasksBoardId = isPortfolio
            ? await resolveTasksBoardId(monday, projectId)
            : customSettings.tasksBoardId;

        if (!tasksBoardId) {
            logger.warn('useTasksMultiple', 'Failed to resolve tasks board id', { isPortfolio, projectId });
            return null;
        }

        logger.functionStart('useTasksMultiple.createTaskForProject', { projectId, taskName, tasksBoardId, isPortfolio });

        try {
            // שלב 1: יצירת המשימה בלי קישור
            const createMutation = `mutation {
                create_item(
                    board_id: ${tasksBoardId},
                    item_name: "${escapeGraphQLString(taskName)}"
                ) {
                    id
                    name
                }
            }`;

            const createRes = await safeApi(monday, 'useTasksMultiple.createTask:createItem', createMutation);

            if (!createRes.data?.create_item) {
                logger.warn('useTasksMultiple', 'No task created in response');
                return null;
            }

            const newTask = createRes.data.create_item;
            logger.debug('useTasksMultiple', 'Task created successfully', { taskId: newTask.id });

            // שלב 2: שליפת המשימות הקיימות ישירות מ-API (לא מ-state!)
            // זה מונע דריסת קישורים קיימים אם ה-state לא מעודכן
            const fetchExistingQuery = `query {
                items(ids: [${projectId}]) {
                    column_values(ids: ["${projectLinkColumnId}"]) {
                        ...on BoardRelationValue {
                            linked_items {
                                id
                            }
                        }
                    }
                }
            }`;

            const fetchRes = await safeApi(monday, 'useTasksMultiple.createTask:fetchExisting', fetchExistingQuery);
            const existingLinkedItems = fetchRes.data?.items?.[0]?.column_values?.[0]?.linked_items || [];
            const existingTaskIds = existingLinkedItems.map(item => item.id);
            const allTaskIds = [...existingTaskIds, newTask.id];

            logger.debug('useTasksMultiple', 'Updating project with tasks', {
                projectId,
                existingCount: existingTaskIds.length,
                newTaskId: newTask.id,
                totalCount: allTaskIds.length
            });

            // שלב 3: עדכון הפרויקט עם כל המשימות (קיימות + חדשה)
            const columnValues = {
                [projectLinkColumnId]: {
                    item_ids: allTaskIds.map(id => parseInt(id))
                }
            };

            const updateMutation = `mutation {
                change_multiple_column_values(
                    item_id: ${projectId},
                    board_id: ${customSettings.connectedBoardId},
                    column_values: ${JSON.stringify(JSON.stringify(columnValues))}
                ) {
                    id
                }
            }`;

            await safeApi(monday, 'useTasksMultiple.createTask:updateProject', updateMutation);

            // עדכון state עם המשימה החדשה
            setTasks(prev => ({
                ...prev,
                [projectId]: [...(prev[projectId] || []), newTask]
            }));
            logger.functionEnd('useTasksMultiple.createTaskForProject', { task: newTask });
            return newTask;

        } catch (err) {
            logger.apiError('useTasksMultiple.createTaskForProject', err);
            logger.error('useTasksMultiple', 'Error creating task', err);
            handleGlobalError(err, { functionName: 'useTasksMultiple.createTask' });
            return null;
        }
    }, [
        customSettings.projectsSourceMode,
        customSettings.tasksBoardId,
        customSettings.connectedBoardId,
        customSettings.tasksProjectColumnId,
    ]);

    return {
        tasks,
        loadingTasks,
        fetchForProject,
        createTask: createTaskForProject
    };
};
