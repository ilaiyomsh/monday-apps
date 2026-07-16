import { describe, it, expect } from 'vitest';
import { resolveMultiColView } from '../SettingsModal.jsx';

// Round-76: the multi-column people mapping (יכולת צפייה / יכולת עריכה) chips
// must show the column NAME, not the raw id, and the "add another" dropdown must
// exclude already-picked columns. getTypedColumnOptions yields { id, name } —
// the previous code read { value, label }, so both broke.
const OPTS = [
  { id: 'multiple_person_mkz41s63', name: 'מנהל' },
  { id: 'multiple_person_mkz4172', name: 'מרכז' },
  { id: 'multiple_person_mkz9', name: 'צופה נוסף' },
];

describe('resolveMultiColView', () => {
  it('chipName resolves a picked column id to its display NAME (not the id)', () => {
    const { chipName } = resolveMultiColView(OPTS, ['multiple_person_mkz41s63', 'multiple_person_mkz4172']);
    expect(chipName('multiple_person_mkz41s63')).toBe('מנהל');
    expect(chipName('multiple_person_mkz4172')).toBe('מרכז');
  });

  it('remaining EXCLUDES already-picked columns (dropdown offers only the rest)', () => {
    const { remaining } = resolveMultiColView(OPTS, ['multiple_person_mkz41s63']);
    expect(remaining.map((o) => o.id)).toEqual(['multiple_person_mkz4172', 'multiple_person_mkz9']);
  });

  it('falls back to the pick-time title, then the id, when the live option is absent', () => {
    // Column not in the live list yet (options still loading) but a title was
    // captured at pick time — show that; otherwise the id as a last resort.
    const { chipName } = resolveMultiColView([], ['gone_col', 'unknown_col'], { gone_col: 'שם שנשמר' });
    expect(chipName('gone_col')).toBe('שם שנשמר');
    expect(chipName('unknown_col')).toBe('unknown_col');
  });
});
