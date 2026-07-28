import { describe, expect, it } from 'vitest';
import { readModalHandoffParams } from './modalHandoffParams.js';

describe('readModalHandoffParams', () => {
  it('reads the four ids the picker hands to the modal', () => {
    expect(readModalHandoffParams('?boardId=123&columnId=color_x&itemId=456&labelId=2'))
      .toEqual({
        boardId: '123', columnId: 'color_x', itemId: '456', labelId: '2',
      });
  });

  it('reads label id 0, which is a real monday label', () => {
    // Truthiness checks lose label 0 — the first label of every status column.
    expect(readModalHandoffParams('?boardId=1&columnId=c&itemId=2&labelId=0').labelId)
      .toBe('0');
  });

  it('trims padding monday may add around a value', () => {
    expect(readModalHandoffParams('?boardId=%20123%20&columnId=c&itemId=2&labelId=1').boardId)
      .toBe('123');
  });

  it('reports a missing id as null rather than an empty string', () => {
    expect(readModalHandoffParams('?boardId=1&columnId=c'))
      .toEqual({
        boardId: '1', columnId: 'c', itemId: null, labelId: null,
      });
  });

  it('reports a blank or whitespace-only id as null', () => {
    expect(readModalHandoffParams('?boardId=&columnId=%20%20&itemId=2&labelId=1'))
      .toEqual({
        boardId: null, columnId: null, itemId: '2', labelId: '1',
      });
  });

  it('survives an absent, empty or malformed query string', () => {
    const allNull = {
      boardId: null, columnId: null, itemId: null, labelId: null,
    };
    expect(readModalHandoffParams('')).toEqual(allNull);
    expect(readModalHandoffParams(null)).toEqual(allNull);
    expect(readModalHandoffParams('?')).toEqual(allNull);
    expect(readModalHandoffParams('not-a-query')).toEqual(allNull);
  });

  it('ignores extra parameters monday appends to the modal URL', () => {
    expect(readModalHandoffParams('?boardId=1&columnId=c&itemId=2&labelId=3&sessionToken=abc'))
      .toEqual({
        boardId: '1', columnId: 'c', itemId: '2', labelId: '3',
      });
  });
});
