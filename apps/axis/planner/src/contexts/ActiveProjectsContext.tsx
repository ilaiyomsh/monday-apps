import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import { mondayService } from '../services/mondayService';
import { logger } from '../utils/Logger';

interface ActiveProjectsContextType {
  activeProjects: Array<{id: string, name: string, [key: string]: any}> | null;
  activeProjectIds: Set<string>;
  projectDataMap: Map<string, any>; // kept for backward compat — empty until lazy fetch
  allProjects: Array<{id: string, name: string, [key: string]: any}> | null;
  loading: boolean;
  fetchAllProjectsLazy: () => Promise<void>; // call when user opens "+" dropdown
  refresh: () => Promise<void>;              // force re-fetch (clears cache first)
}

const ActiveProjectsContext = createContext<ActiveProjectsContextType | undefined>(undefined);

export const ActiveProjectsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { settings, isConfigured } = useSettings();
  const [activeProjects, setActiveProjects] = useState<Array<{id: string, name: string, [key: string]: any}> | null>(null);
  const [allProjects, setAllProjects] = useState<Array<{id: string, name: string, [key: string]: any}> | null>(null);
  const [loading, setLoading] = useState(false);

  const activeProjectIds = useMemo(() => {
    return new Set(activeProjects?.map(p => p.id.toString()) || []);
  }, [activeProjects]);

  // Starts empty, filled once fetchAllProjectsLazy is called
  const projectDataMap = useMemo(() => {
    const source = allProjects ?? activeProjects;
    if (!source) return new Map<string, any>();
    return new Map(source.map(p => [p.id, p]));
  }, [allProjects, activeProjects]);

  // Coalesce concurrent callers (eager-load effect + fetchAllProjectsLazy +
  // focus handler + StrictMode double-invoke) into a single in-flight fetch.
  // allProjects stays null until the fetch resolves, so the allProjects-based
  // guards can't prevent a parallel duplicate on first paint on their own.
  const doFetchInFlightRef = useRef(false);

  const doFetch = useCallback(async () => {
    if (!isConfigured || !settings?.projectsBoardId) return;
    if (doFetchInFlightRef.current) return;
    doFetchInFlightRef.current = true;

    setLoading(true);
    try {
      const additionalColumnIds = [
        settings.projectManagerColumnId,
        settings.projectTypeColumnId,
        settings.clientColumnId,
        settings.projectClassificationColumnId,
        settings.projectPlannedHoursColumnId,
      ].filter(Boolean) as string[];

      if (settings.filterActiveProjects && settings.projectStatusColumnId) {
        const [activeProjs, allProjs] = await Promise.all([
          mondayService.fetchActiveProjectIds(
            settings.projectsBoardId,
            settings.projectStatusColumnId,
            settings.activeProjectStatusValues || [],
            additionalColumnIds.length > 0 ? additionalColumnIds : undefined
          ),
          mondayService.fetchAllProjectsWithColumns(
            settings.projectsBoardId,
            additionalColumnIds.length > 0 ? additionalColumnIds : undefined
          ),
        ]);
        logger.debug('[ActiveProjects] Lazy fetch: active:', activeProjs.length, '/ all:', allProjs.length);
        setActiveProjects(activeProjs);
        setAllProjects(allProjs);
      } else {
        const projects = await mondayService.fetchAllProjectsWithColumns(
          settings.projectsBoardId,
          additionalColumnIds.length > 0 ? additionalColumnIds : undefined
        );
        logger.debug('[ActiveProjects] Lazy fetch: all projects:', projects.length);
        setActiveProjects(projects);
        setAllProjects(projects);
      }
    } catch (err) {
      logger.error('[ActiveProjects] Failed to fetch projects:', err);
    } finally {
      setLoading(false);
      doFetchInFlightRef.current = false;
    }
  }, [settings, isConfigured]);

  // Idempotent: skips if already loaded
  const fetchAllProjectsLazy = useCallback(async () => {
    if (allProjects !== null) return;
    await doFetch();
  }, [allProjects, doFetch]);

  // Rule 5: eager BACKGROUND load — the merged projectDataMap (GanttProvider)
  // needs all active projects with columns up front for classification / dimming
  // / filter options. Non-blocking: first paint tolerates missing metadata under
  // the Rule 6 skeleton. fetchAllProjectsLazy's guard prevents a double fetch.
  useEffect(() => {
    if (isConfigured && settings?.projectsBoardId && allProjects === null) {
      doFetch();
    }
  }, [isConfigured, settings?.projectsBoardId, allProjects, doFetch]);

  // Force re-fetch regardless of cached state
  const refresh = useCallback(async () => {
    setAllProjects(null);
    setActiveProjects(null);
    await doFetch();
  }, [doFetch]);

  // Refresh-on-focus: when the user returns to the Monday tab, re-fetch projects
  // so newly created projects in Monday become visible without a full reload.
  // Throttled to 30s to avoid hammering the API on quick alt-tabs.
  const lastFetchRef = useRef<number>(0);
  useEffect(() => {
    // Only attach listener once allProjects has been loaded at least once —
    // before that, fetchAllProjectsLazy is the source of truth.
    if (allProjects === null) return;

    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFetchRef.current < 30_000) return;
      lastFetchRef.current = now;
      doFetch();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [allProjects, doFetch]);

  return (
    <ActiveProjectsContext.Provider value={{
      activeProjects,
      activeProjectIds,
      projectDataMap,
      allProjects,
      loading,
      fetchAllProjectsLazy,
      refresh,
    }}>
      {children}
    </ActiveProjectsContext.Provider>
  );
};

export const useActiveProjects = () => {
  const context = useContext(ActiveProjectsContext);
  if (context === undefined) {
    throw new Error('useActiveProjects must be used within an ActiveProjectsProvider');
  }
  return context;
};
