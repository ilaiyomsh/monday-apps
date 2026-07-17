import { useCallback, useMemo } from 'react';
import { useSettings } from '../contexts/SettingsContext.jsx';

/*
 * round140 — useColumnLabels: shared per-instance column display-name
 * overrides for the item tables, stored under
 * `settings.preferences.columnLabels`, keyed by table:
 *   { tasks: { status: 'שלב', ... }, myTasks: {...}, decisions: {...}, myDecisions: {...} }
 *
 * `tasks` covers TaskTable (the TasksTab + PreviousTasksTab shared table), the
 * other keys map one-to-one to their views. The stored name is the LOAD-TIME
 * display title for EVERY user of the instance (same contract as
 * useSavedViews); renaming is owner-only (canManageSettings) — the three-dot
 * header menu is simply not rendered for anyone else.
 *
 * Storage discipline (same as useSavedViews): updateSettings merges
 * `preferences` shallowly per key, so renameColumn read-modify-writes the
 * WHOLE columnLabels map — a partial write would wipe the other tables'
 * overrides. An empty/whitespace name, or one equal to the default, CLEARS
 * the override (back to the built-in title) instead of storing a copy.
 */
export function useColumnLabels(tableKey, defaults, { canManageSettings = false } = {}) {
  const { settings, updateSettings } = useSettings();

  const stored = settings?.preferences?.columnLabels?.[tableKey];
  const titles = useMemo(() => (stored ? { ...defaults, ...stored } : defaults),
    // defaults is a per-view constant map (or rebuilt with identical content);
    // key by content so a fresh-but-equal object doesn't churn the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stored, JSON.stringify(defaults)]);

  const renameColumn = useCallback((colKey, name) => {
    const trimmed = (name || '').trim();
    const all = settings?.preferences?.columnLabels || {};
    const table = { ...(all[tableKey] || {}) };
    if (!trimmed || trimmed === defaults?.[colKey]) delete table[colKey];
    else table[colKey] = trimmed;
    const nextAll = { ...all };
    if (Object.keys(table).length > 0) nextAll[tableKey] = table;
    else delete nextAll[tableKey];
    return updateSettings({ preferences: { columnLabels: nextAll } });
  }, [settings, updateSettings, tableKey, defaults]);

  return { titles, canRename: !!canManageSettings, renameColumn };
}

export default useColumnLabels;
