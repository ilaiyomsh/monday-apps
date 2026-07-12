// SOURCE: ported from apps/Axis/Day-off — src/components/ui/Rng.tsx (the
// display wrapper) + fmtRange from src/domain/dates.ts, converted to JS and fed
// ISO "YYYY-MM-DD" strings (monday date/timeline column format).
// WHY: in an RTL document a plain "13.7 - 15.7" renders in reversed reading
// order (bidi reorders the neutral "-" between numbers). The proven fix is a
// dedicated dir="ltr" span so the earlier date always reads first, identically
// in Hebrew and English. Do NOT try to fix this with RLM/LRM characters inside
// the string — that broke on copy-paste; the dir attribute is the stable fix.
import React from 'react';

function fromISO(iso) {
  // Parse as LOCAL date (new Date('YYYY-MM-DD') is UTC and shifts a day in
  // positive-offset timezones like Asia/Jerusalem).
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Compact numeric range, always read left-to-right.
 * No leading zeros; the 2-digit year only appears when the range crosses years.
 *   same day  → "5.7"      same month → "13-15.7"
 *   same year → "2.6-10.6" cross-year → "28.12.25-2.1.26"
 */
export function formatDateRange(startISO, endISO) {
  const a = fromISO(startISO);
  const b = fromISO(endISO || startISO);
  const d = (x) => x.getDate();
  const m = (x) => x.getMonth() + 1;
  const yy = (x) => String(x.getFullYear()).slice(2);
  const sameYear = a.getFullYear() === b.getFullYear();
  if (!sameYear) return `${d(a)}.${m(a)}.${yy(a)}-${d(b)}.${m(b)}.${yy(b)}`;
  if (!endISO || startISO === endISO) return `${d(a)}.${m(a)}`;
  if (a.getMonth() === b.getMonth()) return `${d(a)}-${d(b)}.${m(a)}`;
  return `${d(a)}.${m(a)}-${d(b)}.${m(b)}`;
}

/**
 * RTL-safe date-range display: renders the formatted range inside a dir="ltr"
 * span so it reads earlier-date-first regardless of the ambient direction.
 * Props: { start: 'YYYY-MM-DD', end?: 'YYYY-MM-DD', className? }
 */
export function DateRangeDisplay({ start, end, className = '' }) {
  if (!start) return null;
  return (
    <span className={className} dir="ltr" style={{ unicodeBidi: 'isolate', whiteSpace: 'nowrap' }}>
      {formatDateRange(start, end)}
    </span>
  );
}

export default DateRangeDisplay;
