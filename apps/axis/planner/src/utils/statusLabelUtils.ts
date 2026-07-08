import { logger } from './Logger';

/**
 * A monday status/color label option: stable label ID + display text.
 *
 * Label IDs are the org-wide contract key for status mappings (label text is
 * display-only and may be freely renamed) — see `../Day-off/CONTRACT.md` §1.
 */
export interface StatusLabelOption {
  id: string;
  name: string;
}

interface ArrayFormLabel {
  id?: string | number;
  label?: string;
  is_deactivated?: boolean;
}

/**
 * Extract the ACTIVE labels (stable label ID + display name) from a
 * status/color column's `settings` blob (the column `settings` field — never
 * the deprecated `settings_str`).
 *
 * Handles both shapes monday returns:
 * - array form:  `{ labels: [{ id, label, is_deactivated? }, ...] }`
 *   (deactivated labels are filtered out — they cannot be matched on items)
 * - object form: `{ labels: { "<labelId>": "<text>" | { label }, ... } }`
 *
 * Returns `[]` for non-status columns, unparsable settings, or missing labels.
 *
 * Extracted from SettingsDialog (W3.6) so the W3.7 settings validator resolves
 * configured label IDs against the exact same parse the pickers offer from.
 */
export const extractStatusLabels = (
  column: { type: string; settings?: string } | undefined
): StatusLabelOption[] => {
  if (!column || (column.type !== 'status' && column.type !== 'color')) return [];
  try {
    const columnSettings: { labels?: unknown } = typeof column.settings === 'string'
      ? JSON.parse(column.settings)
      : column.settings || {};
    if (!columnSettings.labels) return [];
    if (Array.isArray(columnSettings.labels)) {
      return (columnSettings.labels as ArrayFormLabel[])
        .filter((item) => item && item.label && !item.is_deactivated)
        .map((item) => ({ id: String(item.id), name: item.label as string }));
    }
    return Object.entries(columnSettings.labels as Record<string, unknown>)
      .filter(([index]) => index !== 'empty')
      .map(([index, label]) => ({
        id: index,
        name: typeof label === 'object' && label !== null
          ? String((label as { label?: unknown }).label)
          : String(label),
      }));
  } catch (e) {
    logger.error('[statusLabelUtils] Failed to parse status settings:', e);
    return [];
  }
};
