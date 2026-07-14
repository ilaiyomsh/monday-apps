import { describe, it, expect } from 'vitest';
import {
  sanitizeColumnValue,
  sanitizeColumnValues,
  formatValue,
} from '../monday-client.js';

/*
 * Round 49 — central column-value sanitizer. Strips the invalid/empty entries
 * that monday rejects with a ColumnValueException (a null inside a
 * board_relation's item_ids, a person with no id, an empty dropdown label) so a
 * single bad entry no longer fails the whole write — WITHOUT changing any valid
 * payload. Hooked in BoardSDK._buildColumnValues so it covers every write.
 */

describe('sanitizeColumnValues — board_relation (item_ids)', () => {
  it('OMITS the column when item_ids is junk-only ([null]) — the reproduced bug', () => {
    expect(sanitizeColumnValues({ rel: { item_ids: [null] } })).toEqual({});
    // formatValue({}) -> Number(undefined) -> NaN, which JSON-serializes to [null]
    expect(sanitizeColumnValues({ rel: formatValue('board_relation', { linkedItems: [{}] }) })).toEqual({});
  });

  it('keeps only the valid ids when some entries are junk', () => {
    expect(sanitizeColumnValues({ rel: { item_ids: [null, 123, NaN] } })).toEqual({ rel: { item_ids: [123] } });
  });

  it('coerces string ids to numbers', () => {
    expect(sanitizeColumnValues({ rel: { item_ids: ['5', '6'] } })).toEqual({ rel: { item_ids: [5, 6] } });
  });

  it('PRESERVES an already-empty item_ids (explicit clear, e.g. "no previous discussion" on edit)', () => {
    expect(sanitizeColumnValues({ rel: { item_ids: [] } })).toEqual({ rel: { item_ids: [] } });
  });

  it('leaves a valid relation untouched', () => {
    expect(sanitizeColumnValues({ rel: { item_ids: [1, 2] } })).toEqual({ rel: { item_ids: [1, 2] } });
  });
});

describe('sanitizeColumnValues — people (personsAndTeams)', () => {
  it('drops entries with no valid id and OMITS the column when none remain', () => {
    expect(sanitizeColumnValues({ p: { personsAndTeams: [{ id: 0, kind: 'person' }] } })).toEqual({});
    // formatValue([{ id: null }]) -> Number(null) -> 0 -> treated as "no id"
    expect(sanitizeColumnValues({ p: formatValue('people', [{ id: null }]) })).toEqual({});
  });

  it('keeps the valid people and drops the invalid ones', () => {
    expect(
      sanitizeColumnValues({ p: { personsAndTeams: [{ id: 5, kind: 'person' }, { id: 0, kind: 'person' }] } }),
    ).toEqual({ p: { personsAndTeams: [{ id: 5, kind: 'person' }] } });
  });

  it('leaves a valid people value untouched', () => {
    expect(sanitizeColumnValues({ p: { personsAndTeams: [{ id: 42, kind: 'person' }] } }))
      .toEqual({ p: { personsAndTeams: [{ id: 42, kind: 'person' }] } });
  });
});

describe('sanitizeColumnValues — dropdown / status', () => {
  it('OMITS a dropdown whose labels are all empty/blank', () => {
    expect(sanitizeColumnValues({ d: { labels: [''] } })).toEqual({});
    expect(sanitizeColumnValues({ d: { labels: [null] } })).toEqual({});
  });

  it('keeps valid dropdown labels and drops the blanks', () => {
    expect(sanitizeColumnValues({ d: { labels: ['', 'כספים'] } })).toEqual({ d: { labels: ['כספים'] } });
  });

  it('OMITS a status with a NaN index but keeps a valid index 0', () => {
    expect(sanitizeColumnValues({ s: { index: NaN } })).toEqual({});
    expect(sanitizeColumnValues({ s: { index: 0 } })).toEqual({ s: { index: 0 } });
  });

  it('OMITS a status written by empty label text but keeps a real one', () => {
    expect(sanitizeColumnValues({ s: { label: '' } })).toEqual({});
    expect(sanitizeColumnValues({ s: { label: 'כספים' } })).toEqual({ s: { label: 'כספים' } });
  });
});

describe('sanitizeColumnValues — intentional values pass through unchanged', () => {
  it('preserves null (checkbox uncheck), {} (clear), dates, text and numbers', () => {
    const cols = {
      cb: null, // checkbox uncheck
      cleared: {}, // date/status clear / no-op
      date: { date: '2026-01-15' },
      dt: { date: '2026-01-15', time: '10:00:00' },
      checked: { checked: 'true' },
      txt: 'hello',
      long: { text: 'note' },
    };
    expect(sanitizeColumnValues(cols)).toEqual(cols);
  });

  it('does not touch a fully-valid mixed payload', () => {
    const cols = {
      people: { personsAndTeams: [{ id: 1, kind: 'person' }] },
      rel: { item_ids: [10] },
      dd: { labels: ['הנהלה'] },
      d: { date: '2026-07-12' },
    };
    expect(sanitizeColumnValues(cols)).toEqual(cols);
  });
});

describe('sanitizeColumnValue — single value', () => {
  it('returns undefined (omit) for junk-only item_ids and an empty label', () => {
    expect(sanitizeColumnValue({ item_ids: [null] })).toBeUndefined();
    expect(sanitizeColumnValue({ labels: [''] })).toBeUndefined();
  });

  it('returns null for a checkbox uncheck (never dropped)', () => {
    expect(sanitizeColumnValue(null)).toBeNull();
  });
});
