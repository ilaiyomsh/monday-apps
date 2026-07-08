import { describe, it, expect } from 'vitest';
import { formatDateRange, formatShortDate } from '../dateUtils';

const isoToDate = (s: string): Date => {
  // Parse y-m-d as a *local* date so the test isn't TZ-sensitive: avoids the
  // pre-existing dateUtils failure mode where parseISO interprets 'yyyy-MM-dd'
  // as UTC midnight and `format(...)` then renders the day before.
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

describe('formatShortDate (bilingual)', () => {
  const date = isoToDate('2025-06-12');

  it('he: produces a "12 ביוני" form', () => {
    const result = formatShortDate(date, { lang: 'he' });
    // Hebrew month names from date-fns vary in form; we only assert that
    // the day number and Hebrew prefix `ב` are present.
    expect(result).toContain('12');
    expect(result).toContain('ב');
  });

  it('en: produces a "12 Jun" form (no Hebrew prefix)', () => {
    const result = formatShortDate(date, { lang: 'en' });
    expect(result).toBe('12 Jun');
    expect(result).not.toContain('ב');
  });

  it('he and en formats are different for the same date', () => {
    expect(formatShortDate(date, { lang: 'he' })).not.toBe(formatShortDate(date, { lang: 'en' }));
  });
});

describe('formatDateRange (bilingual)', () => {
  it('he: same-month range collapses with Hebrew prefix', () => {
    const result = formatDateRange(isoToDate('2025-06-12'), isoToDate('2025-06-15'), { lang: 'he' });
    expect(result).toContain('12 - ');
    expect(result).toContain('15');
    expect(result).toContain('ב');
  });

  it('en: same-month range collapses without Hebrew prefix', () => {
    const result = formatDateRange(isoToDate('2025-06-12'), isoToDate('2025-06-15'), { lang: 'en' });
    expect(result).toBe('12 - 15 Jun');
  });

  it('en cross-month range shows both months', () => {
    const result = formatDateRange(isoToDate('2025-06-28'), isoToDate('2025-07-05'), { lang: 'en' });
    // Format: "28 Jun - 5 Jul"
    expect(result).toMatch(/^28 Jun - 5 Jul$/);
  });
});
