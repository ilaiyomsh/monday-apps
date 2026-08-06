import { describe, it, expect } from 'vitest';
import { formatNameDate, buildAutoName, syncTrailingDate } from '../autoDiscussionName.js';

/*
 * round367 §3 — the auto discussion name: "<template> - <DD.MM.YYYY>".
 * Date changes update ONLY the trailing date digits, and only while the name
 * still ends with the last auto-written date; once the user removed/changed
 * that suffix the name is never touched again.
 */
describe('round367 — autoDiscussionName', () => {
  it('formatNameDate: yyyy-mm-dd input → DD.MM.YYYY display', () => {
    expect(formatNameDate('2026-08-06')).toBe('06.08.2026');
    expect(formatNameDate('')).toBe('');
    expect(formatNameDate(null)).toBe('');
  });

  it('buildAutoName joins template name and date with a dash', () => {
    expect(buildAutoName('ישיבת צוות', '2026-08-06')).toBe('ישיבת צוות - 06.08.2026');
    // no date yet → just the clean template name
    expect(buildAutoName('ישיבת צוות', '')).toBe('ישיבת צוות');
  });

  it('syncTrailingDate replaces ONLY the trailing date when it matches', () => {
    const res = syncTrailingDate('ישיבת צוות - 06.08.2026', '06.08.2026', '2026-08-13');
    expect(res).toEqual({ name: 'ישיבת צוות - 13.08.2026', dateStr: '13.08.2026' });
  });

  it('a user-renamed prefix survives — only the digits at the end change', () => {
    const res = syncTrailingDate('סנכרון שבועי חשוב - 06.08.2026', '06.08.2026', '2026-09-01');
    expect(res.name).toBe('סנכרון שבועי חשוב - 01.09.2026');
  });

  it('returns null (leave the name alone) once the trailing date was removed or changed', () => {
    expect(syncTrailingDate('ישיבת צוות', '06.08.2026', '2026-08-13')).toBeNull();
    expect(syncTrailingDate('ישיבת צוות - אוגוסט', '06.08.2026', '2026-08-13')).toBeNull();
    expect(syncTrailingDate('ישיבת צוות - 06.08.2026', '', '2026-08-13')).toBeNull();
    // the date must be at the very END — a date the user moved elsewhere in the
    // name is their text now, not the auto suffix
    expect(syncTrailingDate('06.08.2026 - ישיבת צוות', '06.08.2026', '2026-08-13')).toBeNull();
  });
});
