/*
 * Date/time helpers shared by the create/edit modal, the discussions list and
 * the calendar. All functions work in LOCAL time — never via toISOString(),
 * which shifts the date in non-UTC timezones.
 *
 * Time-of-day convention: parseValue('date') returns a Date augmented with a
 * plain `hasTime` boolean (true only when monday stored a time part). The flag
 * is LOST on any `new Date(d)` clone — always read it off the original parsed
 * value, and use composeLocalDate() to build values that carry it.
 */

export const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** Date -> local "yyyy-mm-dd". */
export function localYmd(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Build a Date from native-input strings: dateStr "yyyy-mm-dd" (required) and
 * timeStr "HH:MM" (optional). Constructed from LOCAL parts; `hasTime` is set so
 * formatValue('date') knows whether to write a time part to monday.
 */
export function composeLocalDate(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, day] = String(dateStr).split('-').map(Number);
  if (!y || !m || !day) return null;
  let hh = 0;
  let mm = 0;
  const hasTime = !!timeStr;
  if (hasTime) {
    const parts = String(timeStr).split(':').map(Number);
    hh = parts[0] || 0;
    mm = parts[1] || 0;
  }
  const d = new Date(y, m - 1, day, hh, mm);
  if (Number.isNaN(d.getTime())) return null;
  d.hasTime = hasTime;
  return d;
}

/** Date -> "yyyy-mm-dd" for the native date input (local time, no UTC shift). */
export function toDateInput(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return localYmd(x);
}

/** Date -> "HH:MM" for the native time input — only when it carries a real
 *  time (hasTime); date-only values yield ''. Reads the flag off the ORIGINAL
 *  object (must run before any clone). */
export function toTimeInput(d) {
  if (!d || d.hasTime !== true || Number.isNaN(d.getTime?.())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "HH:MM" label for display, only for values that carry a time. */
export function fmtTimeLabel(d) {
  if (!d || d.hasTime !== true) return '';
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}
