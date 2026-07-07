import React from 'react';
import { GanttChart } from './GanttChart';
import { GanttSkeleton } from './GanttSkeleton';
import { useGantt } from '../../hooks/useGantt';
import { FreeFallLoader, useMinimumLoadingTime } from '../ui';

// How long the branded loader stays up before handing off to the Gantt
// skeleton. After this, the skeleton fills the remaining (platform boot +
// data fetch) time so the chart "appears" instead of a lingering spinner.
const LOADER_DURATION_MS = 2000;

/**
 * GanttContent - staged loading:
 *   0–2s              → branded FreeFallLoader
 *   2s → data ready   → GanttSkeleton (chart-shaped placeholder)
 *   data ready        → real GanttChart
 * If data is ready before 2s, the loader still shows its full cycle, then the
 * real chart (no skeleton flash).
 */
export const GanttContent: React.FC = () => {
  const { groups, loading } = useGantt();

  // Data is ready when not loading and we have groups (even if empty array after initial load)
  const isDataReady = !loading && groups !== undefined;

  // Branded loader holds for its fixed duration regardless of data state.
  const loaderElapsed = useMinimumLoadingTime(true, LOADER_DURATION_MS);

  if (!loaderElapsed) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-bg-app">
        <div className="flex flex-col items-center gap-4">
          <FreeFallLoader size={80} />
          <p className="text-text-muted font-medium">Powered by Twyst</p>
        </div>
      </div>
    );
  }

  // Loader done but data still loading → chart-shaped skeleton.
  if (!isDataReady) {
    return (
      <div className="w-full h-screen p-2 bg-bg-app">
        <GanttSkeleton />
      </div>
    );
  }

  return <GanttChart />;
};
