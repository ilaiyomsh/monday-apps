/**
 * The picker and the fill form close on a status write, and closing IS the
 * confirmation the user gets — there is no toast. So the thing that decides
 * whether to close must be the write itself having taken effect, not merely a
 * request having returned.
 *
 * Both mutations now echo the status column back, and this is the rule applied to
 * that echo. The two directions are asymmetric on purpose:
 *
 *  - A DEFINITE mismatch (monday returned a different label, or no item at all)
 *    is a failure. Closing there would drop the dialog on a status that never
 *    changed, with nothing to tell the user.
 *  - An UNREADABLE echo is not. If a future API version stops returning the
 *    fragment we read, treating that as failure would show an error on every
 *    successful write in the app. The mutation returning without errors is
 *    monday's own answer, and we keep it.
 */

import { describe, expect, it } from 'vitest';
import { assertStatusWritten, writtenStatusLabelId } from './statusWriteResult.js';

const COLUMN_ID = 'status';

const echo = (columnValues) => ({ id: '99', column_values: columnValues });

/** What monday returns for a StatusValue: `index` carries the label ID. */
const statusValue = (labelId, extra = {}) => ({
  id: COLUMN_ID,
  index: labelId,
  label: 'בוצע',
  ...extra,
});

describe('writtenStatusLabelId', () => {
  it('reads the label id the mutation echoed back', () => {
    expect(writtenStatusLabelId(echo([statusValue(2)]), COLUMN_ID)).toBe('2');
  });

  it('picks the status column out of an echo carrying several columns', () => {
    const item = echo([
      { id: 'text_1', text: 'hello' },
      statusValue(5),
      { id: 'people_1', text: 'Someone' },
    ]);
    expect(writtenStatusLabelId(item, COLUMN_ID)).toBe('5');
  });

  it('falls back to the serialized value when `index` is absent', () => {
    // Same monday quirk currentLabelIdFromValue exists for: the JSON key is
    // `index` but the number is the label ID.
    const item = echo([{ id: COLUMN_ID, value: JSON.stringify({ index: 3, post_id: null }) }]);
    expect(writtenStatusLabelId(item, COLUMN_ID)).toBe('3');
  });

  it('reads label id 0 rather than treating it as missing', () => {
    // 0 is a real label id and the first one monday assigns. A falsy check here
    // would make the most common label unconfirmable.
    expect(writtenStatusLabelId(echo([statusValue(0)]), COLUMN_ID)).toBe('0');
  });

  it('returns null when there is no status column in the echo', () => {
    expect(writtenStatusLabelId(echo([{ id: 'text_1', text: 'hello' }]), COLUMN_ID)).toBeNull();
  });

  it('returns null for an item with nothing in it', () => {
    expect(writtenStatusLabelId(null, COLUMN_ID)).toBeNull();
    expect(writtenStatusLabelId(echo([]), COLUMN_ID)).toBeNull();
  });
});

describe('assertStatusWritten', () => {
  it('accepts an echo that carries the label that was written', () => {
    expect(() => assertStatusWritten(echo([statusValue(2)]), COLUMN_ID, '2')).not.toThrow();
  });

  it('accepts label id 0', () => {
    expect(() => assertStatusWritten(echo([statusValue(0)]), COLUMN_ID, '0')).not.toThrow();
  });

  it('throws when monday echoed a DIFFERENT label — the write did not take', () => {
    expect(() => assertStatusWritten(echo([statusValue(7)]), COLUMN_ID, '2'))
      .toThrow(/הסטטוס לא עודכן/);
  });

  it('throws when the mutation returned no item at all', () => {
    // `change_column_value: null` with no GraphQL errors. The request succeeded and
    // nothing happened — the exact case a bare await cannot tell from a success.
    expect(() => assertStatusWritten(null, COLUMN_ID, '2')).toThrow(/הסטטוס לא עודכן/);
    expect(() => assertStatusWritten(undefined, COLUMN_ID, '2')).toThrow(/הסטטוס לא עודכן/);
  });

  it('accepts an echo it cannot read, instead of failing a write that worked', () => {
    // The asymmetry. No status column in the response means we have no evidence
    // either way, and the mutation itself did not error — blocking here would put
    // an error on every successful transition the day monday changes the shape.
    expect(() => assertStatusWritten(echo([{ id: 'text_1', text: 'hi' }]), COLUMN_ID, '2'))
      .not.toThrow();
    expect(() => assertStatusWritten(echo([]), COLUMN_ID, '2')).not.toThrow();
  });

  it('compares as strings, so a numeric label id from the caller still matches', () => {
    expect(() => assertStatusWritten(echo([statusValue(2)]), COLUMN_ID, 2)).not.toThrow();
  });
});
