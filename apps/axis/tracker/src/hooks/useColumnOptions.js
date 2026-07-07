import { useState, useEffect } from 'react';
import { safeApi } from '../utils/mondayApi';
import { mondayColorToHex } from '../utils/colorUtils';
import logger from '../utils/logger';
import { handleGlobalError } from '../utils/globalErrorHandler';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 דקות
const columnOptionsCache = new Map(); // key -> { data, ts, inFlightPromise }

const buildCacheKey = (boardId, columnId) => `${String(boardId)}:${String(columnId)}`;

const getCacheEntry = (cacheKey) => columnOptionsCache.get(cacheKey) || null;

const isFreshEntry = (entry) => !!(entry?.data && (Date.now() - entry.ts) < CACHE_TTL_MS);

const parseColumnOptions = (column) => {
    const parsed = [];

    // settings הוא JSON type - יכול להגיע כאובייקט או כמחרוזת
    let settings = column.settings || {};
    if (typeof settings === 'string') {
        settings = JSON.parse(settings);
    }

    if (column.type === 'status' || column.type === 'dropdown') {
        // עמודת status - labels יכולים להיות מערך או אובייקט
        const labels = settings.labels || {};
        const labelsColors = settings.labels_colors || {};

        if (Array.isArray(labels)) {
            // פורמט מערך
            labels.forEach((label) => {
                if (!label.is_deactivated && label.label && label.label.trim() !== '') {
                    const rawColor = label.hex
                        || (typeof label.color === 'string' ? label.color : null)
                        || labelsColors[String(label.color)]?.color
                        || labelsColors[String(label.id)]?.color
                        || null;
                    const idStr = label.id != null ? String(label.id) : String(label.index ?? label.label);
                    parsed.push({
                        id: idStr,
                        value: label.label,
                        label: label.label,
                        color: mondayColorToHex(rawColor) || '',
                        index: label.index ?? parseInt(idStr, 10)
                    });
                }
            });
        } else if (typeof labels === 'object') {
            // פורמט אובייקט - { "0": "Label1", "1": "Label2" }
            Object.entries(labels).forEach(([index, labelText]) => {
                if (labelText && typeof labelText === 'string' && labelText.trim() !== '') {
                    const rawColor = labelsColors[index]?.color || null;
                    parsed.push({
                        id: index,
                        value: labelText,
                        label: labelText,
                        color: mondayColorToHex(rawColor) || '',
                        index: parseInt(index, 10)
                    });
                }
            });
        }
    }

    // מיון לפי סדר התצוגה של העמודה (index = מיקום הלייבל),
    // ולא לפי id שבו ה-API מחזיר את settings.labels. מיון יציב במקום.
    parsed.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return parsed;
};

const fetchColumnOptions = async (monday, boardId, columnId, hookName, cacheKey) => {
    const query = `query {
                    boards(ids: [${boardId}]) {
                        columns(ids: ["${columnId}"]) {
                            id
                            type
                            settings
                        }
                    }
                }`;

    const inFlightPromise = (async () => {
        const res = await safeApi(monday, hookName, query);
        const column = res.data?.boards?.[0]?.columns?.[0];
        if (!column) {
            logger.warn(hookName, 'Column not found');
            const noColumnErr = new Error('עמודה לא נמצאה');
            noColumnErr.isNotFound = true;
            throw noColumnErr;
        }

        try {
            const parsed = parseColumnOptions(column);
            logger.debug(hookName, 'Column settings parsed', { type: column.type, count: parsed.length, boardId, columnId });
            columnOptionsCache.set(cacheKey, { data: parsed, ts: Date.now(), inFlightPromise: null });
            return parsed;
        } catch (parseError) {
            logger.error(hookName, 'Error parsing column settings', parseError);
            throw parseError;
        }
    })();

    columnOptionsCache.set(cacheKey, { data: null, ts: 0, inFlightPromise });

    try {
        return await inFlightPromise;
    } catch (error) {
        const prev = columnOptionsCache.get(cacheKey);
        if (prev?.inFlightPromise) {
            columnOptionsCache.delete(cacheKey);
        }
        throw error;
    }
};

export const prefetchColumnOptions = async (monday, boardId, columnId, hookName = 'prefetchColumnOptions') => {
    if (!monday || !boardId || !columnId) return [];
    const cacheKey = buildCacheKey(boardId, columnId);
    const cached = getCacheEntry(cacheKey);

    if (isFreshEntry(cached)) {
        return cached.data;
    }
    if (cached?.inFlightPromise) {
        return cached.inFlightPromise;
    }

    return fetchColumnOptions(monday, boardId, columnId, hookName, cacheKey);
};

export const invalidateColumnOptionsCache = (keys) => {
    if (!keys || keys.length === 0) {
        columnOptionsCache.clear();
        return;
    }

    keys.forEach((keyLike) => {
        if (typeof keyLike === 'string' && keyLike.includes(':')) {
            columnOptionsCache.delete(keyLike);
            return;
        }
        if (keyLike && typeof keyLike === 'object') {
            const key = buildCacheKey(keyLike.boardId, keyLike.columnId);
            columnOptionsCache.delete(key);
        }
    });
};

/**
 * Hook גנרי לטעינת ערכים מעמודת status או dropdown
 * משמש כבסיס ל-useStageOptions ו-useNonBillableOptions
 * @param {Object} monday - Monday API instance
 * @param {string} boardId - מזהה הלוח
 * @param {string} columnId - מזהה העמודה
 * @param {string} hookName - שם ה-hook לצורך לוגים
 * @returns {Object} { options, loading, error }
 */
export const useColumnOptions = (monday, boardId, columnId, hookName = 'useColumnOptions') => {
    const [options, setOptions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!monday || !boardId || !columnId) {
            setOptions([]);
            setError(null);
            setLoading(false);
            return;
        }

        let mounted = true;

        const fetchOptions = async () => {
            const cacheKey = buildCacheKey(boardId, columnId);
            const cached = getCacheEntry(cacheKey);
            const hasFreshCache = isFreshEntry(cached);

            if (hasFreshCache) {
                setOptions(cached.data);
                setError(null);
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                logger.functionStart(`${hookName}.fetchOptions`, { boardId, columnId });
                const data = cached?.inFlightPromise
                    ? await cached.inFlightPromise
                    : await fetchColumnOptions(monday, boardId, columnId, hookName, cacheKey);
                if (mounted) {
                    setOptions(data);
                    setError(null);
                }
                logger.functionEnd(`${hookName}.fetchOptions`, { count: data.length, cacheKey });
            } catch (err) {
                logger.error(hookName, 'Error fetching options', err);
                if (mounted) {
                    if (err?.isNotFound) {
                        setError('עמודה לא נמצאה');
                    } else if (err instanceof SyntaxError) {
                        setError('שגיאה בפענוח הגדרות העמודה');
                    } else {
                        setError('שגיאה בטעינת ערכי העמודה');
                    }
                    setOptions([]);
                }
                handleGlobalError(err, { functionName: hookName });
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        fetchOptions();
        return () => {
            mounted = false;
        };
    }, [monday, boardId, columnId, hookName]);

    return { options, loading, error };
};
