// Parsers for monday's `Column.settings` JSON scalar (API 2026-04). Shape
// varies by column type; each parser dispatches on column.type and tolerates
// a missing/malformed blob by returning an empty result.
//
// All identifiers exposed here are STABLE label/option ids (numeric). They
// don't change when the user reorders labels in monday — only the display
// label/name changes, which we keep solely for UI rendering.

import type { Column } from '../types';

export interface StatusLabelOption {
  id: number;
  label: string;
  color?: string;
}

export interface DropdownLabelOption {
  id: number;
  name: string;
}

function getSettings(column: Column | null | undefined): Record<string, unknown> | null {
  const s = column?.settings;
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  return null;
}

// Status `settings` shape (API 2026): `{ labels: [{ id, label, index,
// color, hex, is_done, is_deactivated }, ...] }`. `id` is the stable label
// id we write back to the API; `index` is just the position (changes on
// reorder) and we never persist it.
export function parseStatusLabels(column: Column | null | undefined): StatusLabelOption[] {
  if (column && column.type !== 'status') return [];
  const s = getSettings(column);
  const labels = s?.labels as
    | { id?: string | number; index?: number; label?: string; color?: string; hex?: string; is_deactivated?: boolean }[]
    | undefined;
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => {
      const id = Number(l.id);
      if (!Number.isFinite(id) || !l.label) return null;
      if (l.is_deactivated) return null;
      return { id, label: l.label, color: l.hex || l.color };
    })
    .filter((x): x is StatusLabelOption => x !== null)
    .sort((a, b) => a.id - b.id);
}

// board_relation `settings` shape: `{ boardIds: [123, 456], ... }`.
export function parseBoardRelationBoards(column: Column | null | undefined): string[] {
  if (column && column.type !== 'board_relation') return [];
  const s = getSettings(column);
  const boardIds = s?.boardIds as (string | number)[] | undefined;
  if (!Array.isArray(boardIds)) return [];
  return boardIds.map((x) => String(x)).filter(Boolean);
}

// Dropdown `settings` shape: `{ labels: [{ id, label, is_deactivated }, ...] }`.
// `id` is the stable id we write back to the API (no separate `index` field
// like Status has).
export function parseDropdownLabels(column: Column | null | undefined): DropdownLabelOption[] {
  if (column && column.type !== 'dropdown') return [];
  const s = getSettings(column);
  const labels = s?.labels as { id?: number | string; label?: string; is_deactivated?: boolean }[] | undefined;
  if (!Array.isArray(labels)) return [];
  return labels
    .map((o) => {
      const id = Number(o.id);
      if (!Number.isFinite(id) || !o.label) return null;
      if (o.is_deactivated) return null;
      return { id, name: o.label };
    })
    .filter((x): x is DropdownLabelOption => x !== null);
}
