/**
 * valueCoercions — the scalar coercions the column-field registry and the
 * write-payload sanitizer both lean on. Pure, no monday knowledge.
 */

export function trimmedString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function isBlankString(value) {
  return trimmedString(value) === '';
}

export function entryList(value) {
  return Array.isArray(value) ? value : [];
}
