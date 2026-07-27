import { describe, expect, it } from 'vitest';
import {
  buildMultiColumnWritePayload,
  isSupportedFormColumnType,
  prefillFormValue,
  serializeFormColumnValue,
} from './columnValueFormats.js';

describe('serializeFormColumnValue', () => {
  it('uses monday column-format payloads for supported types', () => {
    expect(serializeFormColumnValue('text', 'hello')).toBe('hello');
    expect(serializeFormColumnValue('long_text', 'hello')).toEqual({ text: 'hello' });
    expect(serializeFormColumnValue('numbers', 12)).toBe('12');
    expect(serializeFormColumnValue('date', '2026-07-27')).toEqual({ date: '2026-07-27' });
    expect(serializeFormColumnValue('email', 'a@b.com')).toEqual({ email: 'a@b.com', text: 'a@b.com' });
  });
});

describe('prefillFormValue', () => {
  it('prefills from text and typed JSON values', () => {
    expect(prefillFormValue('text', { text: 'x', value: '"x"' })).toBe('x');
    expect(prefillFormValue('date', { text: 'Jul 27', value: '{"date":"2026-07-27"}' })).toBe('2026-07-27');
  });
});

describe('buildMultiColumnWritePayload', () => {
  it('writes status by label id and merges required form fields', () => {
    const columnsById = new Map([
      ['notes', { id: 'notes', type: 'text' }],
      ['when', { id: 'when', type: 'date' }],
    ]);
    expect(
      buildMultiColumnWritePayload({
        statusColumnId: 'status',
        statusLabelId: '2',
        formFields: [
          { columnId: 'notes' },
          { columnId: 'when' },
        ],
        formValues: { notes: 'סיבה', when: '2026-07-27' },
        columnsById,
      }),
    ).toEqual({
      status: { index: 2 },
      notes: 'סיבה',
      when: { date: '2026-07-27' },
    });
  });

  it('reports which form column types are supported in v1', () => {
    expect(isSupportedFormColumnType('text')).toBe(true);
    expect(isSupportedFormColumnType('people')).toBe(false);
  });
});
