import { format, parseISO, addDays, type Locale } from 'date-fns';
import { he as heLocale, enUS as enLocale } from 'date-fns/locale';

const LOCALE_MAP: Record<'he' | 'en', Locale> = {
  he: heLocale,
  en: enLocale,
};

/**
 * Returns the date-fns format string + locale for "short date" rendering.
 * Hebrew uses `'d בMMM'` (the literal `'ב'` is the prefix "in") — needs the
 * date-fns escape `'ב'` so the `b` isn't interpreted as a token.
 */
const shortDateFormat = (lang: 'he' | 'en'): { fmt: string; locale: Locale } =>
  lang === 'he'
    ? { fmt: "d 'ב'MMM", locale: LOCALE_MAP.he }
    : { fmt: 'd MMM', locale: LOCALE_MAP.en };

export interface FormatDateOptions {
  lang: 'he' | 'en';
}

export function formatShortDate(date: string | Date, { lang }: FormatDateOptions): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const { fmt, locale } = shortDateFormat(lang);
  return format(d, fmt, { locale });
}

/**
 * Formats a date range using the supplied UI language. Hebrew keeps the
 * "12 - 15 ביוני" same-month collapse; English uses "12 - 15 Jun".
 */
export function formatDateRange(
  startDate: string | Date,
  endDate: string | Date,
  { lang }: FormatDateOptions
): string {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;

  const { fmt, locale } = shortDateFormat(lang);
  const startFormat = format(start, fmt, { locale });
  const endFormat = format(end, fmt, { locale });

  if (
    format(start, 'MMM', { locale }) === format(end, 'MMM', { locale }) &&
    format(start, 'yyyy') === format(end, 'yyyy')
  ) {
    return `${format(start, 'd')} - ${endFormat}`;
  }

  return `${startFormat} - ${endFormat}`;
}

/**
 * Day-key helpers (Day-off integration — see `../Day-off/CONTRACT.md` §1/§6).
 *
 * A "day-key" is a local-calendar `YYYY-MM-DD` string. Day-keys compare
 * lexicographically, so plain string comparison is the membership/overlap test —
 * no Date math, no timezone involvement.
 */

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` is a well-formed `YYYY-MM-DD` day-key. */
export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && DAY_KEY_RE.test(value);
}

/**
 * Adds `delta` calendar days to a day-key and returns the resulting day-key.
 * Pure UTC string math — immune to the host timezone and DST transitions
 * (this file is exercised by the `test:tz` matrix).
 */
export function addDaysToDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + delta));
  const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * True when the inclusive day-key ranges `[aStart..aEnd]` and `[bStart..bEnd]`
 * share at least one calendar day: `aStart ≤ bEnd AND aEnd ≥ bStart`
 * (the CONTRACT.md §6 overlap test; lexicographic comparison).
 */
export function dayRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Calculates new dates based on a pixel offset and snap unit size
 * @param pixelsPerUnit - Pixels per snap unit (could be pixelsPerDay * snapDays for zoom-level snapping)
 * @param daysPerUnit - Days per snap unit (1 for day view, 7 for week, 30 for month, etc.)
 */
export function getDynamicDates(
  originalStart: string,
  originalEnd: string,
  pixelOffset: number,
  pixelsPerUnit: number,
  daysPerUnit: number = 1
): { startDate: Date; endDate: Date } {
  const unitsMoved = Math.round(pixelOffset / pixelsPerUnit);
  const daysDiff = unitsMoved * daysPerUnit;
  return {
    startDate: addDays(parseISO(originalStart), daysDiff),
    endDate: addDays(parseISO(originalEnd), daysDiff),
  };
}
