import { useState, useEffect, useCallback } from 'react';
import mondaySdk from 'monday-sdk-js';
import { useSettings } from '../contexts/SettingsContext';
import { useMondayContext } from '../contexts/MondayContext';
import { safeApi } from '../utils/mondayApi';
import logger from '../utils/logger';

const monday = mondaySdk();
const STORAGE_KEY_PREFIX = 'projectsListCache_';
const STORAGE_TIMEOUT_MS = 5000;

const buildSignature = (settings) => [
    settings.useAssignmentsMode ? 'assign' : 'direct',
    settings.connectedBoardId || '',
    settings.assignmentsBoardId || '',
    settings.assignmentProjectLinkColumnId || '',
    settings.projectStatusColumnId || '',
    (settings.projectActiveStatusValues || []).join(','),
].join('|');

const withTimeout = (p, ms, label) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms))]);

const loadFromStorage = async (instanceId) => {
    if (!instanceId) return null;
    const key = `${STORAGE_KEY_PREFIX}${instanceId}`;
    try {
        const res = await withTimeout(monday.storage.getItem(key), STORAGE_TIMEOUT_MS, 'projectsListCache.getItem');
        if (res?.data?.success === false || !res?.data?.value) return null;
        const parsed = JSON.parse(res.data.value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
        logger.warn('useAllBoardProjects', 'storage load failed', { error: err?.message });
        return null;
    }
};

const saveToStorage = async (instanceId, payload) => {
    if (!instanceId) return;
    const key = `${STORAGE_KEY_PREFIX}${instanceId}`;
    try {
        await withTimeout(monday.storage.setItem(key, JSON.stringify(payload)), STORAGE_TIMEOUT_MS, 'projectsListCache.setItem');
        logger.debug('useAllBoardProjects', 'saved cache to monday.storage');
    } catch (err) {
        logger.warn('useAllBoardProjects', 'storage save failed', { error: err?.message });
    }
};

/**
 * Hook לאחזור כל הפרויקטים מהלוח המקושר — ללא סינון לפי משתמש מחובר.
 * מיועד למסכים כמו "צבעי פרויקטים" שבהם רוצים לראות את כל הפרויקטים בלוח.
 * מכבד את הסינון הסטטוסי של "פרויקטים פעילים" כפי שמוגדר בהגדרות.
 */
export const useAllBoardProjects = () => {
    const { customSettings } = useSettings();
    const { context } = useMondayContext();
    const instanceId = context?.instanceId || context?.boardId || null;
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const connectedBoardId = customSettings.connectedBoardId;
    const useAssignmentsMode = !!customSettings.useAssignmentsMode;
    const assignmentsBoardId = customSettings.assignmentsBoardId;
    const assignmentProjectLinkColumnId = customSettings.assignmentProjectLinkColumnId;
    const statusFilterEnabled = !!(customSettings.projectStatusFilterEnabled &&
        customSettings.projectStatusColumnId &&
        customSettings.projectActiveStatusValues?.length > 0);
    const statusColumnId = customSettings.projectStatusColumnId;
    const activeStatusValues = customSettings.projectActiveStatusValues || [];

    const fetchAll = useCallback(async () => {
        const signature = buildSignature(customSettings);
        // טעינה מ-monday.storage (cache עמיד בין סשנים)
        const cachedPayload = await loadFromStorage(instanceId);
        const hasValidCache = cachedPayload
            && cachedPayload.signature === signature
            && Array.isArray(cachedPayload.projects)
            && cachedPayload.projects.length > 0;
        if (hasValidCache) {
            logger.debug('useAllBoardProjects', 'Loaded from monday.storage cache (silent refresh)', { count: cachedPayload.projects.length });
            setProjects(cachedPayload.projects);
            // ממשיכים לרענן ברקע, בלי loading
        }
        const hasCache = hasValidCache;

        logger.debug('useAllBoardProjects', 'fetchAll invoked', {
            connectedBoardId,
            useAssignmentsMode,
            assignmentsBoardId,
            assignmentProjectLinkColumnId,
            statusFilterEnabled,
            statusColumnId,
            activeStatusValues,
            projectsSourceMode: customSettings.projectsSourceMode
        });

        // מצב הקצאות — שולפים פרויקטים ייחודיים מכל ההקצאות (ללא סינון לפי משתמש)
        if (useAssignmentsMode) {
            if (!assignmentsBoardId || !assignmentProjectLinkColumnId) {
                logger.warn('useAllBoardProjects', 'Assignments mode but missing board/column');
                setProjects([]);
                return;
            }
            if (!hasCache) setLoading(true);
            setError(null);
            try {
                let allItems = [];
                let cursor = null;
                do {
                    const cursorParam = cursor ? `, cursor: "${cursor}"` : '';
                    const query = `query {
                        boards(ids: [${assignmentsBoardId}]) {
                            items_page(limit: 500${cursorParam}) {
                                cursor
                                items {
                                    id
                                    column_values(ids: ["${assignmentProjectLinkColumnId}"]) {
                                        id
                                        ... on BoardRelationValue {
                                            linked_items { id name }
                                        }
                                    }
                                }
                            }
                        }
                    }`;
                    const res = await safeApi(monday, 'useAllBoardProjects.fetchAll(assignments)', query);
                    const page = res.data?.boards?.[0]?.items_page;
                    if (page?.items) allItems = [...allItems, ...page.items];
                    cursor = page?.cursor || null;
                } while (cursor);

                const projectsMap = new Map();
                allItems.forEach(item => {
                    const col = item.column_values?.find(c => c.id === assignmentProjectLinkColumnId);
                    (col?.linked_items || []).forEach(p => {
                        if (p?.id && !projectsMap.has(p.id)) {
                            projectsMap.set(p.id, { id: String(p.id), name: p.name });
                        }
                    });
                });
                const result = Array.from(projectsMap.values());
                setProjects(result);
                saveToStorage(instanceId, { signature, projects: result, ts: Date.now() });
                logger.debug('useAllBoardProjects', 'Assignments fetch complete', {
                    assignmentsCount: allItems.length,
                    uniqueProjects: result.length,
                    firstFew: result.slice(0, 3)
                });
            } catch (err) {
                logger.error('useAllBoardProjects', 'Error fetching assignments', err);
                setError(err?.message || 'Failed to fetch projects');
                setProjects([]);
            } finally {
                setLoading(false);
            }
            return;
        }

        if (!connectedBoardId) {
            logger.warn('useAllBoardProjects', 'No connectedBoardId — skipping fetch');
            setProjects([]);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            logger.debug('useAllBoardProjects', 'Starting fetch', {
                boardId: connectedBoardId,
                statusFilterEnabled
            });

            const columnValuesFragment = statusFilterEnabled
                ? `column_values(ids: ${JSON.stringify([statusColumnId])}) { id text ... on StatusValue { value } }`
                : '';

            let allItems = [];
            let cursor = null;

            do {
                const cursorParam = cursor ? `, cursor: "${cursor}"` : '';
                const query = `query {
                    boards(ids: ${connectedBoardId}) {
                        items_page(limit: 500${cursorParam}) {
                            cursor
                            items {
                                id
                                name
                                ${columnValuesFragment}
                            }
                        }
                    }
                }`;

                const res = await safeApi(monday, 'useAllBoardProjects.fetchAll', query);
                const page = res.data?.boards?.[0]?.items_page;
                if (page?.items) {
                    allItems = [...allItems, ...page.items];
                }
                cursor = page?.cursor || null;
            } while (cursor);

            const filtered = statusFilterEnabled
                ? allItems.filter(item => {
                    const col = item.column_values?.find(c => c.id === statusColumnId);
                    return activeStatusValues.includes(col?.text || '');
                })
                : allItems;

            const result = filtered.map(item => ({ id: String(item.id), name: item.name }));
            setProjects(result);
            saveToStorage(instanceId, { signature, projects: result, ts: Date.now() });
            logger.debug('useAllBoardProjects', 'Fetch complete', {
                totalBeforeFilter: allItems.length,
                afterFilter: result.length,
                firstFew: result.slice(0, 3)
            });
        } catch (err) {
            logger.error('useAllBoardProjects', 'Error fetching board projects', err);
            setError(err?.message || 'Failed to fetch projects');
            setProjects([]);
        } finally {
            setLoading(false);
        }
    }, [instanceId, connectedBoardId, useAssignmentsMode, assignmentsBoardId, assignmentProjectLinkColumnId, statusFilterEnabled, statusColumnId, JSON.stringify(activeStatusValues)]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    return { projects, loading, error, refetch: fetchAll };
};
