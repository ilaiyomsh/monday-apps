// Pure helpers for the segmented DD/MM/YY manual date entry (the two slashes
// are ALWAYS visible; each pair of digits lives in its own box). Kept DOM-free
// so the fill/advance rules are unit-testable.

// Strip non-digits and cap at two characters.
export function sanitizeSegment(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 2);
}

// Given the segment kind ('dd' | 'mm' | 'yy') and the raw input value, return
// { value, advance }: the sanitized value to store and whether focus should
// auto-advance to the next segment. A first digit that can't start any valid
// two-digit value (day 4-9, month 2-9) is zero-padded and advances immediately.
export function acceptSegmentInput(kind, raw) {
  const digits = sanitizeSegment(raw);
  if (!digits) return { value: '', advance: false };
  if (digits.length >= 2) return { value: digits, advance: true };
  const first = Number(digits[0]);
  const maxFirst = kind === 'dd' ? 3 : kind === 'mm' ? 1 : 9;
  if (first > maxFirst) return { value: `0${digits}`, advance: true };
  return { value: digits, advance: false };
}

// Compose the typed-date string for parseTypedDate. Day+month are required;
// a missing year yields "DD/MM" (parse defaults it to the current year).
// Missing day or month → '' (nothing to parse).
export function segmentsToTyped(segs) {
  const { dd = '', mm = '', yy = '' } = segs || {};
  if (!dd || !mm) return '';
  return yy ? `${dd}/${mm}/${yy}` : `${dd}/${mm}`;
}

// Split a committed Date into { dd, mm, yy } two-digit strings ('' when empty).
export function dateToSegments(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return { dd: '', mm: '', yy: '' };
  }
  const pad = (n) => String(n).padStart(2, '0');
  return {
    dd: pad(date.getDate()),
    mm: pad(date.getMonth() + 1),
    yy: pad(date.getFullYear() % 100),
  };
}
