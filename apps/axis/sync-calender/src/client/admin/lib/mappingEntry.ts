import type { ColumnMapping, ColumnMappingEntry } from '../types';

export type EntryBucket = ColumnMappingEntry['type'];

// Map a monday column type → which discriminated-union branch represents it.
// `null` means "not mappable in this UI" (NotMappableEditor).
export function bucketFor(colType: string): EntryBucket | null {
  switch (colType) {
    case 'text': return 'text';
    case 'long_text': return 'long_text';
    case 'email': return 'email_simple';
    case 'phone': return 'phone_simple';
    case 'status': return 'status';
    case 'dropdown': return 'dropdown';
    case 'numbers': return 'numbers';
    case 'date': return 'date';
    case 'checkbox': return 'checkbox';
    default: return null;
  }
}

// Initial entry when the user first interacts with an unmapped row.
// Returns null for types where there's no sensible blank state — the editor
// renders an empty picker and only emits an entry once the user picks.
export function defaultEntryFor(colType: string): ColumnMappingEntry | null {
  const bucket = bucketFor(colType);
  if (!bucket) return null;
  switch (bucket) {
    case 'text':
    case 'long_text':
    case 'email_simple':
    case 'phone_simple':
      return { type: bucket, tokens: [] };
    case 'numbers':
      return { type: 'numbers', kind: 'literal', value: '' };
    case 'date':
      return { type: 'date', source: 'startDate' };
    case 'checkbox':
      return { type: 'checkbox', value: false };
    case 'status':
    case 'dropdown':
      return null;
  }
}

// Whether an entry counts as "configured" for the Mapped/Unmapped split and
// the setup-progress count. Empty templates and empty multi-pickers don't.
// Legacy string / untyped-object entries fall through the switch and return
// false — they render as StaleMappingRow via entryMatchesColumn anyway.
export function isMeaningful(entry: ColumnMappingEntry | null | undefined): boolean {
  if (!entry || typeof entry !== 'object' || !('type' in entry)) return false;
  switch (entry.type) {
    case 'text':
    case 'long_text':
    case 'email_simple':
    case 'phone_simple':
      return entry.tokens.some((t) =>
        t.kind === 'var' || (t.kind === 'text' && t.value.trim() !== '')
      );
    case 'status':
      return Number.isInteger(entry.value?.id) && entry.value.id >= 0;
    case 'dropdown':
      return Array.isArray(entry.value?.ids) && entry.value.ids.length > 0;
    case 'numbers':
      if (entry.kind === 'literal') {
        const v = entry.value;
        return v !== '' && v !== null && v !== undefined;
      }
      return Boolean(entry.source);
    case 'date':
      return Boolean(entry.source);
    case 'checkbox':
      return true;
    default:
      return false;
  }
}

// Drop any non-new-shape values from an incoming columnMapping object so the
// client only works with the typed ColumnMappingEntry union. The server's
// renderer still handles legacy strings inside stored policies — the UI just
// can't display/edit them, so the user must re-map affected columns.
//
// Also rewrites legacy status entries that store the stable label id under
// `value.index` to the current `value.id`. The numeric value is the same
// (monday's settings_str dict keys ARE the stable label ids), only the field
// name changed in the new shape — so this is a pure rename, no data loss.
export function normalizeColumnMapping(raw: unknown): ColumnMapping {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ColumnMapping = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || !('type' in v)) continue;
    const entry = v as ColumnMappingEntry & { value?: { index?: number; id?: number } };
    if (entry.type === 'status' && entry.value && entry.value.id == null && Number.isInteger(entry.value.index)) {
      out[k] = { ...entry, value: { id: entry.value.index as number } };
    } else {
      out[k] = entry;
    }
  }
  return out;
}

// Whether an entry's discriminator still matches the current column type.
// When false, the user changed the column's type after mapping → show
// StaleMappingRow with a reset button.
export function entryMatchesColumn(
  entry: ColumnMappingEntry | null | undefined,
  colType: string
): boolean {
  if (!entry) return true;
  return entry.type === bucketFor(colType);
}
