import { useState, useEffect } from 'react';
import { mondayService } from '../services/mondayService';
import type { PlannerSettings } from '../types/settings.types';
import { logger } from '../utils/Logger';

export interface ProjectMetricsData {
  /** Map<projectId, allocated hours> — SUM(totalHours) GROUP BY project. */
  allocatedByProject: Map<string, number>;
  /** Map<projectId, reported hours> — SUM(duration) GROUP BY project, time logs. */
  reportedByProject: Map<string, number>;
  /**
   * True only once BOTH aggregates have landed successfully. The project card
   * shows all three numbers together (planned + allocated + reported) only when
   * this is true — never a partial row.
   */
  ready: boolean;
  error: string | null;
}

const EMPTY = new Map<string, number>();

/**
 * Fetches per-project allocated + reported hour totals via two server-side
 * aggregates (mondayService.fetchAllocatedHoursByProject /
 * fetchReportedHoursByProject). Runs OFF the critical path — fired in an effect
 * after first paint, independent of the windowed allocation load — so it never
 * delays the initial Gantt render. Re-arms when the relevant board/column
 * settings change.
 *
 * `ready` flips to true only when both aggregates resolve. On error it stays
 * false (the card keeps its skeleton rather than showing wrong/partial numbers);
 * a settings change or refetch re-arms the fetch.
 */
export const useProjectMetrics = (settings: PlannerSettings | null | undefined): ProjectMetricsData => {
  const [allocatedByProject, setAllocatedByProject] = useState<Map<string, number>>(EMPTY);
  const [reportedByProject, setReportedByProject] = useState<Map<string, number>>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The set of settings the two aggregates depend on. Reported hours needs the
  // mirror (logs board + duration are derived from it) + the logs→project
  // relation (explicit override or auto-detected). Allocated hours needs the
  // allocations board + totalHours + project relation columns.
  const allocBoardId = settings?.allocationsBoardId;
  const totalHoursColumnId = settings?.totalHoursColumnId;
  const projectColumnId = settings?.projectColumnId;
  const reportedHoursColumnId = settings?.reportedHoursColumnId;
  const timeLogsAllocationColumnId = settings?.timeLogsAllocationColumnId;
  const timeLogsProjectColumnId = settings?.timeLogsProjectColumnId;

  useEffect(() => {
    if (!settings || !allocBoardId) return;
    let cancelled = false;
    setReady(false);
    setError(null);

    (async () => {
      try {
        // Reported-hours-per-project is only available when the reported-hours
        // mirror is configured (logs board + duration derive from it). When it
        // isn't, allocated + planned still render (reported defaults to 0).
        const reportedAvailable = !!reportedHoursColumnId && !!timeLogsAllocationColumnId;
        const [allocated, reported] = await Promise.all([
          mondayService.fetchAllocatedHoursByProject(settings),
          reportedAvailable
            ? mondayService.fetchReportedHoursByProject(settings)
            : Promise.resolve(new Map<string, number>()),
        ]);
        if (cancelled) return;
        setAllocatedByProject(allocated);
        setReportedByProject(reported);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[useProjectMetrics] Failed to fetch project metrics aggregates:', err);
        setError(message);
        // Leave ready=false so the card keeps its skeleton rather than showing
        // a wrong/partial number. Re-arms on the next settings change / remount.
      }
    })();

    return () => { cancelled = true; };
  }, [
    settings,
    allocBoardId,
    totalHoursColumnId,
    projectColumnId,
    reportedHoursColumnId,
    timeLogsAllocationColumnId,
    timeLogsProjectColumnId,
  ]);

  return { allocatedByProject, reportedByProject, ready, error };
};
