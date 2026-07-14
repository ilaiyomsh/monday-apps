import { describe, it, expect } from 'vitest';
import { parseMondayError } from '../errorHandler';

/*
 * Round 49 — surface the REAL monday ColumnValueException reason instead of the
 * generic "Graphql validation errors" / "check your input" toast. Mirrors the
 * round-32 invalidPersonAssignment precedent: detect the specific cause from the
 * message / extensions.error_data and prefer it.
 */
describe('parseMondayError — ColumnValueException reasons (round 49)', () => {
  it('maps a dropdown label-not-found to the friendly "value not in column" message', () => {
    const response = {
      errors: [
        {
          message: "The dropdown label 'טוויסט' does not exist and cannot be created",
          extensions: { code: 'ColumnValueException' },
        },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('dropdownLabelNotFound');
    expect(parsed.userMessage).toContain('אינו קיים');
    expect(parsed.canRetry).toBe(false);
  });

  it('maps board-relation itemsNotInConnectedBoards to the "linked item invalid" message', () => {
    const response = {
      errors: [
        {
          message: 'There are items that are not in the connected boards (itemsNotInConnectedBoards)',
          extensions: { code: 'ColumnValueException' },
        },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('itemsNotInConnectedBoards');
    expect(parsed.userMessage).toContain('המקושרים');
  });

  it('detects itemsNotInConnectedBoards from extensions.error_data too', () => {
    const response = {
      errors: [
        {
          message: 'Graphql validation errors',
          extensions: { code: 'ColumnValueException', error_data: { error_code: 'itemsNotInConnectedBoards' } },
        },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('itemsNotInConnectedBoards');
  });

  it('generic ColumnValueException SURFACES monday\'s raw message (no longer masked)', () => {
    const response = {
      errors: [
        { message: 'invalid number value provided', extensions: { code: 'ColumnValueException' } },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('ColumnValueException');
    expect(parsed.userMessage).toContain('invalid number value provided');
  });

  it('includes the column name from error_data when present', () => {
    const response = {
      errors: [
        {
          message: 'bad value',
          extensions: { code: 'ColumnValueException', error_data: { column_title: 'תאריך הדיון' } },
        },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.userMessage).toContain('תאריך הדיון');
    expect(parsed.userMessage).toContain('bad value');
  });

  it('does NOT clobber invalidPersonAssignment (the person rejection still wins)', () => {
    const response = {
      errors: [
        { message: 'unable to assign person with id 5', extensions: { code: 'ColumnValueException' } },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('invalidPersonAssignment');
  });
});
