/**
 * columnMap — pure parse/format helpers for monday column_values.
 *
 * `parse*` functions consume the raw `value` (or `text`) of a column_value as
 * returned by the monday items query (the stored JSON, NOT the write format).
 * `format*` functions produce the value to embed in `change_multiple_column_values`
 * / `create_item` `column_values` (the write format from the monday-api skill).
 *
 * All helpers are robust to null / empty / malformed input. Day-keys are 'YYYY-MM-DD'.
 * No i18n, no logging, no SDK — pure functions only.
 */

import type { Attachment, DayKey } from '../domain/types';

/** Safely JSON.parse a stored column `value`. Returns undefined on null/empty/malformed. */
function safeParse(value?: string | null): unknown {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'null') return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
    // Malformed/non-JSON column value is expected for some column types — treat as empty.
    // eslint-disable-next-line no-restricted-syntax
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Parse a people column `value` → array of person ids (as strings).
 * Stored shape: { personsAndTeams: [{ id, kind }] }. Teams are ignored.
 */
export function parsePeople(value?: string | null): string[] {
  const parsed = safeParse(value);
  if (!isRecord(parsed)) return [];
  const list = parsed.personsAndTeams;
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    if (entry.kind != null && entry.kind !== 'person') continue;
    const id = entry.id;
    if (id == null) continue;
    ids.push(String(id));
  }
  return ids;
}

/** Format person ids → people write value: { personsAndTeams: [{ id, kind: 'person' }] }. */
export function formatPeople(ids: string[]): unknown {
  return {
    personsAndTeams: ids.map((id) => ({ id: Number(id), kind: 'person' })),
  };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Parse a status column → its label text. The column's `text` already holds the
 * label, so pass it through (trimmed). Empty/null → ''.
 */
export function parseStatusText(text?: string | null): string {
  if (text == null) return '';
  return text.trim();
}

/** Parse a status column raw `value` JSON and return the label id (stored under key `index`). */
export function parseStatusIndex(value?: string | null): number | null {
  const parsed = safeParse(value);
  if (!isRecord(parsed)) return null;
  const rawIndex = parsed.index;
  if (typeof rawIndex === 'number' && Number.isFinite(rawIndex)) return rawIndex;
  if (typeof rawIndex === 'string' && rawIndex.trim() !== '') {
    const n = Number(rawIndex);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Format a status label → write value: { label }. */
export function formatStatusLabel(label: string): unknown {
  return { label };
}

/** Format a status label id → write value: { index: id }. monday names the field `index` but expects the label id. */
export function formatStatusIndex(labelId: number): unknown {
  return { index: labelId };
}

// ---------------------------------------------------------------------------
// Long text
// ---------------------------------------------------------------------------

/** Format a long-text column → write value: { text }. (monday long_text write format.) */
export function formatLongText(text: string): unknown {
  return { text };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * Parse a timeline column `value` → { from, to } day-keys.
 * Stored shape: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', ... }. null on empty/malformed.
 */
export function parseTimeline(value?: string | null): { from: DayKey; to: DayKey } | null {
  const parsed = safeParse(value);
  if (!isRecord(parsed)) return null;
  const { from, to } = parsed;
  if (typeof from !== 'string' || typeof to !== 'string' || from === '' || to === '') {
    return null;
  }
  return { from, to };
}

/** Format a date range → timeline write value: { from, to }. */
export function formatTimeline(from: DayKey, to: DayKey): unknown {
  return { from, to };
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

/**
 * Parse a date column → its day-key. The column's `text` holds the display date;
 * prefer it but normalize. Accepts 'YYYY-MM-DD' (monday text is already this form).
 * null on empty/missing.
 */
export function parseDateText(text?: string | null): DayKey | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return trimmed;
}

/** Format a day-key → date write value: { date: 'YYYY-MM-DD' }. */
export function formatDate(key: DayKey): unknown {
  return { date: key };
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

/**
 * Parse a checkbox column `value` → boolean.
 * Stored shape when checked: { checked: 'true' } (or true). Empty/null → false.
 */
export function parseCheckbox(value?: string | null): boolean {
  const parsed = safeParse(value);
  if (!isRecord(parsed)) return false;
  const { checked } = parsed;
  return checked === true || checked === 'true';
}

/**
 * Format a checkbox → write value. { checked: 'true' } to check; {} to uncheck.
 * (monday treats { checked: 'false' } as still-checked; empty object clears it.)
 */
export function formatCheckbox(checked: boolean): unknown {
  return checked ? { checked: 'true' } : {};
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Format a number → numbers-column write value (monday expects a string). */
export function formatNumber(n: number): unknown {
  return String(n);
}

/**
 * Parse a numbers column → number (the column's `text` holds the value).
 * null on empty/non-numeric.
 */
export function parseNumberText(text?: string | null): number | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// File (Assets)
// ---------------------------------------------------------------------------

/**
 * Parse a file column `value` → the first asset as an Attachment.
 * Stored shape: { files: [{ name, assetId, ... }] }. Asset url is not in the
 * column value (needs an assets query), so url is left undefined here.
 * undefined when there is no file.
 */
export function parseFile(value?: string | null): Attachment | undefined {
  const parsed = safeParse(value);
  if (!isRecord(parsed)) return undefined;
  const files = parsed.files;
  if (!Array.isArray(files) || files.length === 0) return undefined;
  const first = files[0];
  if (!isRecord(first)) return undefined;
  const rawName = first.name;
  const name = typeof rawName === 'string' && rawName !== '' ? rawName : String(first.assetId ?? '');
  if (name === '') return undefined;
  const url = typeof first.url === 'string' ? first.url : undefined;
  return { name, url };
}
