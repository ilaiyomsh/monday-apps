import { describe, it, expect } from 'vitest';
import { parseMondayError } from '../errorHandler';

/*
 * Round 32 — person-assignment error surfacing (#5b). monday rejects assigning a
 * non-member of a board with a ColumnValueException whose message/error_data names
 * the person ("invalidPersonAssignment" / "unable to assign person with id …" /
 * "not a subscriber of the board"). The generic ColumnValueException code used to
 * mask this as "check your input"; parseMondayError now surfaces the real reason.
 */
describe('parseMondayError — invalidPersonAssignment (#5b)', () => {
  it('maps a ColumnValueException person rejection (message) to the board-membership message', () => {
    const response = {
      errors: [
        {
          message: 'unable to assign person with id 58649006',
          extensions: { code: 'ColumnValueException' },
        },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('invalidPersonAssignment');
    expect(parsed.userMessage).toContain('אינו חבר בלוח');
    expect(parsed.canRetry).toBe(false);
  });

  it('detects the rejection from extensions.error_data too', () => {
    const response = {
      errors: [
        {
          message: 'Graphql validation errors',
          extensions: { code: 'ColumnValueException', error_data: { error_code: 'invalidPersonAssignment' } },
        },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('invalidPersonAssignment');
  });

  it('keeps the generic ColumnValueException message for non-person value errors', () => {
    const response = {
      errors: [
        { message: 'invalid date value provided', extensions: { code: 'ColumnValueException' } },
      ],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('ColumnValueException');
    expect(parsed.userMessage).not.toContain('אינו חבר בלוח');
  });

  it('matches the plain "not a subscriber of" wording', () => {
    const response = {
      errors: [{ message: "User 58649006 is not a subscriber of the board" }],
    };
    const parsed = parseMondayError(null, response, null);
    expect(parsed.errorCode).toBe('invalidPersonAssignment');
  });
});
