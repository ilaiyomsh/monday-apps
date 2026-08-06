/**
 * columnValueSanitize — the write-payload sanitizer for monday column values.
 * Re-exported from columnFields.js, which is where the app imports it from.
 */

import { entryList, isBlankString } from './valueCoercions.js';

function sanitizeArrayField(value, key, mapEntry, keepEntry) {
  const raw = entryList(value[key]);
  const cleaned = raw.map(mapEntry).filter(keepEntry);
  // Had entries but none survived ⇒ the caller meant to write real data and all
  // of it was junk; omit the column rather than clear it by accident.
  if (raw.length > 0 && cleaned.length === 0) return undefined;
  return { ...value, [key]: cleaned };
}

/**
 * Sanitize ONE monday column value. Returns the value (possibly cleaned), or
 * `undefined` meaning "omit this column". Pure.
 *
 * This is the guard that turns a malformed payload into a skipped column
 * instead of a whole-mutation ColumnValueException — one bad people id would
 * otherwise fail the status transition too.
 */
export function sanitizeColumnValue(value) {
  // null (checkbox uncheck) and plain scalars (text/numbers) are intentional.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  if ('personsAndTeams' in value) {
    return sanitizeArrayField(
      value,
      'personsAndTeams',
      (entry) => entry,
      (entry) => entry !== null
        && entry !== undefined
        && Number.isFinite(Number(entry.id))
        && Number(entry.id) !== 0,
    );
  }

  if ('ids' in value) {
    return sanitizeArrayField(
      value,
      'ids',
      (id) => id,
      (id) => !isBlankString(id),
    );
  }

  // board_relation. A NaN from Number(<bad id>) becomes `null` once stringified, and
  // monday answers ColumnValueException/itemsNotInConnectedBoards for the whole
  // mutation — so one unreadable linked item would otherwise block the transition.
  // An intentionally empty array survives: it is how a relation is cleared.
  if ('item_ids' in value) {
    return sanitizeArrayField(
      value,
      'item_ids',
      (id) => Number(id),
      (id) => Number.isFinite(id) && id !== 0,
    );
  }

  if ('labels' in value) {
    return sanitizeArrayField(
      value,
      'labels',
      (label) => label,
      (label) => !isBlankString(label),
    );
  }

  // { index: N } — a NaN index serializes to null and monday rejects it. Label
  // id 0 is valid and kept.
  if ('index' in value) {
    return Number.isFinite(Number(value.index)) ? value : undefined;
  }

  if ('label' in value) {
    return isBlankString(value.label) ? undefined : value;
  }

  // date { date[, time] }, timeline { from, to }, checkbox { checked },
  // rating { rating }, and the empty {} used to clear all pass through.
  return value;
}

/** Sanitize a whole columnId → value map, omitting the columns that emptied. */
export function sanitizeColumnValues(columnValues) {
  const out = {};
  Object.entries(columnValues || {}).forEach(([columnId, value]) => {
    const cleaned = sanitizeColumnValue(value);
    if (cleaned !== undefined) out[columnId] = cleaned;
  });
  return out;
}
