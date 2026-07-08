/**
 * Date/time helpers that read the local wall-clock and never round-trip
 * through UTC.
 *
 * Why this exists:
 *   `format(date, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx")` tags the offset of the host
 *   TZ onto each saved string. Different hosts produce different bytes for the
 *   same wall-clock instant; round-tripping through Monday and re-parsing can
 *   skew by an hour around DST. These helpers always read `.getFullYear()`,
 *   `.getMonth()`, `.getDate()`, etc. — host-local, but offset-free, so the
 *   wall-clock value the user picked is what gets stored.
 *
 * The helpers are deliberately framework-free (no react-i18next dep) so unit
 * tests can drive them under different `TZ=...` envs via `pnpm test:tz`.
 */

import { format, parseISO, addDays as dfAddDays, isSameDay as dfIsSameDay, type Locale } from 'date-fns';

/** `yyyy-MM-dd` from a local Date — uses host-local wall-clock. */
export const toMondayDateString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * `yyyy-MM-ddTHH:mm:ss` — ISO-8601 local-time form (no offset suffix).
 * Matches what `parseISO` expects on the read side and what
 * `prepareAllocationMutationValues.split('T')[0]` consumes for date columns.
 */
export const toMondayDateTimeString = (date: Date): string => {
  const datePart = toMondayDateString(date);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${datePart}T${h}:${m}:${s}`;
};

/** Locale-aware date renderer (no TZ shift). */
export const formatDate = (
  date: Date | string,
  locale: Locale,
  pattern: string = 'PP'
): string => {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, pattern, { locale });
};

/** `HH:mm` — 24-hour, locale-stable. */
export const formatTime = (date: Date): string => {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

export const formatDateTime = (
  date: Date | string,
  locale: Locale,
  pattern: string = 'PPpp'
): string => {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, pattern, { locale });
};

/**
 * Parse a free-form time string into `{ hours, minutes }`. Accepts
 * `'9:00'`, `'09:00'`, `'9:00 AM'`, `'9:00 PM'`. Throws on unrecognized input.
 */
export const parseUserTime = (text: string): { hours: number; minutes: number } => {
  const trimmed = text.trim();
  const m = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) {
    throw new Error(`[parseUserTime] cannot parse "${text}"`);
  }
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const meridiem = m[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23) throw new Error(`[parseUserTime] hours out of range: ${hours}`);
  if (minutes < 0 || minutes > 59) throw new Error(`[parseUserTime] minutes out of range: ${minutes}`);
  return { hours, minutes };
};

/** Re-exports so callers don't have to import date-fns directly. */
export const isSameDay = dfIsSameDay;
export const addDays = dfAddDays;
