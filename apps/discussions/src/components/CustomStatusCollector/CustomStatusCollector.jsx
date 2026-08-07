import { useEffect } from 'react';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';

/*
 * round372 — ONE label-options loader per custom STATUS column, shared by every
 * surface that needs those labels: the task tables (to render the coloured chip
 * and offer the picker) and the filter panels (to show label TEXT instead of the
 * raw label id a status value actually carries).
 *
 * Why a component and not a hook at the call site: the number of custom status
 * columns is variable, and a hook cannot run in a variable-length loop. Mounting
 * one of these per column keeps it per-COLUMN — never per row, which is the
 * round136 performance rule. It renders nothing.
 *
 * Mounting the same alias on several surfaces costs nothing: useStatusOptions
 * keeps a module-level cache + inflight map, so they share a single fetch. The
 * value it reports is its state object as-is, i.e. referentially stable — round370
 * is the incident that made that requirement explicit (a rebuilt-per-render view
 * turned the report-up effect into an infinite render loop and froze the tab).
 */
export function CustomStatusCollector({ boardKey = 'tasks', alias, onOptions }) {
  const opts = useStatusOptions(boardKey, alias);
  useEffect(() => { onOptions(alias, opts); }, [alias, opts, onOptions]);
  return null;
}

export default CustomStatusCollector;
