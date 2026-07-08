import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import mondaySdk from 'monday-sdk-js';
import { useMondayContext } from './MondayContext';
import { loadProjectColors, saveProjectColors } from '../utils/projectColorsStorage';
import { stringToColor } from '../utils/colorUtils';
import logger from '../utils/logger';

const monday = mondaySdk();
const ProjectColorsContext = createContext(null);

const MERGE_DEBOUNCE_MS = 300;

/**
 * Provider לניהול מיפוי projectId → hex של צבעי פרויקטים.
 * אחסון נפרד ב-monday.storage הגלובלי תחת המפתח projectColors_{instanceId}.
 */
export function ProjectColorsProvider({ children }) {
    const { context } = useMondayContext();
    const instanceId = context?.instanceId || context?.boardId || null;

    const [colorMap, setColorMap] = useState({});
    const [loading, setLoading] = useState(true);
    const colorMapRef = useRef(colorMap);
    const mergeTimerRef = useRef(null);
    const pendingMergeIdsRef = useRef(new Set());
    const loadedInstanceIdRef = useRef(null);

    useEffect(() => {
        colorMapRef.current = colorMap;
    }, [colorMap]);

    // טעינה ראשונית מ-storage כשמופע ידוע
    useEffect(() => {
        if (!instanceId) return;
        if (loadedInstanceIdRef.current === instanceId) return;

        let cancelled = false;
        setLoading(true);
        loadProjectColors(monday, instanceId).then((loaded) => {
            if (cancelled) return;
            loadedInstanceIdRef.current = instanceId;
            setColorMap(loaded);
            setLoading(false);
            logger.debug('ProjectColorsContext', 'Loaded project colors', { count: Object.keys(loaded).length });
        });
        return () => { cancelled = true; };
    }, [instanceId]);

    // שמירה ל-storage (לא ממתינה — fire and forget)
    const persist = useCallback((nextMap) => {
        if (!instanceId) return;
        saveProjectColors(monday, instanceId, nextMap);
    }, [instanceId]);

    /**
     * מגדיר צבע מותאם לפרויקט.
     */
    const setProjectColor = useCallback((projectId, hex) => {
        logger.debug('ProjectColorsContext', 'setProjectColor called', { projectId, hex });
        if (!projectId || !hex) return;
        setColorMap((prev) => {
            if (prev[projectId] === hex) return prev;
            const next = { ...prev, [projectId]: hex };
            persist(next);
            return next;
        });
    }, [persist]);

    /**
     * מאפס פרויקט לצבע אוטומטי (stringToColor).
     */
    const resetProjectColor = useCallback((projectId) => {
        if (!projectId) return;
        setColorMap((prev) => {
            if (!(projectId in prev)) return prev;
            // איפוס = הגדרה לצבע ה-hash הדטרמיניסטי כדי שהמיפוי יישאר מלא
            const autoColor = stringToColor(projectId.toString());
            if (prev[projectId] === autoColor) return prev;
            const next = { ...prev, [projectId]: autoColor };
            persist(next);
            return next;
        });
    }, [persist]);

    /**
     * ממזג ID-ים חדשים למפה (debounced). פרויקטים שכבר במפה לא נוגעים בהם.
     * Idempotent — בטוח לקריאות חוזרות.
     */
    const mergeAndPersist = useCallback((projectIds) => {
        if (!Array.isArray(projectIds) || projectIds.length === 0) return;
        if (!loadedInstanceIdRef.current) {
            // עדיין לא נטען — נחכה
            projectIds.forEach((id) => pendingMergeIdsRef.current.add(String(id)));
            return;
        }
        projectIds.forEach((id) => pendingMergeIdsRef.current.add(String(id)));

        if (mergeTimerRef.current) clearTimeout(mergeTimerRef.current);
        mergeTimerRef.current = setTimeout(() => {
            const ids = Array.from(pendingMergeIdsRef.current);
            pendingMergeIdsRef.current.clear();
            mergeTimerRef.current = null;

            setColorMap((prev) => {
                let changed = false;
                const next = { ...prev };
                for (const id of ids) {
                    if (!(id in next)) {
                        next[id] = stringToColor(id);
                        changed = true;
                    }
                }
                if (!changed) return prev;
                persist(next);
                return next;
            });
        }, MERGE_DEBOUNCE_MS);
    }, [persist]);

    // flush pending merges אחרי שהמפה נטענה
    useEffect(() => {
        if (loading) return;
        if (pendingMergeIdsRef.current.size === 0) return;
        const ids = Array.from(pendingMergeIdsRef.current);
        pendingMergeIdsRef.current.clear();
        mergeAndPersist(ids);
    }, [loading, mergeAndPersist]);

    const value = useMemo(() => ({
        colorMap,
        loading,
        setProjectColor,
        resetProjectColor,
        mergeAndPersist
    }), [colorMap, loading, setProjectColor, resetProjectColor, mergeAndPersist]);

    return (
        <ProjectColorsContext.Provider value={value}>
            {children}
        </ProjectColorsContext.Provider>
    );
}

/**
 * Hook לגישה למיפוי צבעי פרויקטים.
 * מחוץ ל-Provider מחזיר ערכים בטוחים — לא זורק כדי לא לשבור ייבוא בקבצי בדיקה.
 */
export function useProjectColors() {
    const value = useContext(ProjectColorsContext);
    if (!value) {
        return {
            colorMap: {},
            loading: false,
            setProjectColor: () => {},
            resetProjectColor: () => {},
            mergeAndPersist: () => {}
        };
    }
    return value;
}
