import { useEffect, useMemo, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useMondayContext } from '../contexts/MondayContext';
import { getEffectiveBoardId } from '../utils/boardIdResolver';
import { prefetchColumnOptions, invalidateColumnOptionsCache } from './useColumnOptions';
import logger from '../utils/logger';

/**
 * Preload של רשימות options לעמודות status/dropdown כדי למנוע השהיה במודלים.
 * מבצע prefetch פעם אחת לכל מפתח boardId:columnId ומנקה cache של מפתחות ישנים
 * כשההגדרות משתנות (board/column הוחלפו).
 */
export const usePrefetchColumnOptions = (monday) => {
    const isTestEnv = !!import.meta.vitest || import.meta.env.MODE === 'test';
    const { customSettings } = useSettings();
    const { context } = useMondayContext();

    const boardId = useMemo(
        () => getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    const prefetchedKeysRef = useRef(new Set());
    const previousKeysRef = useRef([]);

    const targetColumns = useMemo(() => {
        if (!boardId) return [];
        return [
            customSettings.stageColumnId,
            customSettings.nonBillableStatusColumnId,
            customSettings.allDayTypeStatusColumnId,
        ].filter(Boolean).map((columnId) => ({ boardId, columnId }));
    }, [
        boardId,
        customSettings.stageColumnId,
        customSettings.nonBillableStatusColumnId,
        customSettings.allDayTypeStatusColumnId
    ]);

    useEffect(() => {
        if (isTestEnv) return;
        const nextKeys = targetColumns.map(({ boardId: bId, columnId }) => `${String(bId)}:${String(columnId)}`);
        const prevKeys = previousKeysRef.current;
        const staleKeys = prevKeys.filter(key => !nextKeys.includes(key));
        if (staleKeys.length > 0) {
            invalidateColumnOptionsCache(staleKeys);
            staleKeys.forEach((key) => prefetchedKeysRef.current.delete(key));
        }
        previousKeysRef.current = nextKeys;
    }, [targetColumns, isTestEnv]);

    useEffect(() => {
        if (isTestEnv) return;
        if (!monday || targetColumns.length === 0) return;

        targetColumns.forEach(({ boardId: bId, columnId }) => {
            const key = `${String(bId)}:${String(columnId)}`;
            if (prefetchedKeysRef.current.has(key)) return;
            prefetchedKeysRef.current.add(key);
            prefetchColumnOptions(monday, bId, columnId, 'usePrefetchColumnOptions')
                .catch((error) => {
                    // כשל prefetch לא צריך לשבור את ה-UI; הצרכן יבצע fetch רגיל בעת שימוש.
                    logger.warn('usePrefetchColumnOptions', 'Prefetch failed', { boardId: bId, columnId, error });
                    prefetchedKeysRef.current.delete(key);
                });
        });
    }, [monday, targetColumns, isTestEnv]);
};

export default usePrefetchColumnOptions;
