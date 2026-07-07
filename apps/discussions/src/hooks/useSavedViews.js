/*
 * useSavedViews — shared per-instance saved table views (filter/sort/group).
 *
 * Stored under `settings.preferences.savedViews`, keyed by table:
 *   { myTasks: {...}, tasksTab: {...}, previousTasks: {...} }
 * Each entry holds only the controls that were explicitly saved (e.g. `sort`
 * without `filter`). Values are JSON-safe — filters go through
 * serializeFilter/deserializeFilter (controls.js).
 *
 * The saved view is the LOAD-TIME state for every user of the instance; local
 * changes stay session-only (nothing persists per user/device anymore). Saving
 * is gated by the `saveViewDefaults` system capability (owners always; members
 * only when the owner checked the box in the permissions tab).
 */
import { useCallback } from 'react';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { usePermission } from '@generated/hooks/usePermission.js';

export function useSavedViews(tableKey, { canManageSettings = false } = {}) {
  const { settings, updateSettings } = useSettings();
  const can = usePermission({ canManageSettings });

  const savedViews = settings?.preferences?.savedViews || {};
  const view = savedViews[tableKey] || null;
  const canSave = can('saveViewDefaults');

  // Merge one control's selection into this table's entry (read-modify-write of
  // the whole savedViews map — `preferences` merges shallowly in updateSettings).
  const saveView = useCallback(
    (partial) => {
      const current = settings?.preferences?.savedViews || {};
      return updateSettings({
        preferences: {
          savedViews: { ...current, [tableKey]: { ...current[tableKey], ...partial } },
        },
      });
    },
    [settings, updateSettings, tableKey]
  );

  return { view, canSave, saveView };
}

export default useSavedViews;
