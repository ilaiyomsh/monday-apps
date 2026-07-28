import { describe, expect, it } from 'vitest';
import {
  FORM_MAX_ROWS,
  requiredFormGrid,
  requiredFormModalSize,
} from './requiredFormModalSize.js';

describe('requiredFormGrid', () => {
  it('puts a single field in one column so the modal is not half empty', () => {
    expect(requiredFormGrid([{ type: 'text' }]))
      .toEqual({ columns: 1, rows: 1, cells: 1, scrolls: false });
  });

  it('puts two single-cell fields side by side in one row', () => {
    expect(requiredFormGrid([{ type: 'people' }, { type: 'text' }]))
      .toEqual({ columns: 2, rows: 1, cells: 2, scrolls: false });
  });

  it('wraps three single-cell fields onto a second row', () => {
    expect(requiredFormGrid([{ type: 'text' }, { type: 'people' }, { type: 'rating' }]))
      .toEqual({ columns: 2, rows: 2, cells: 3, scrolls: false });
  });

  it('counts a timeline as a full row because it renders two date inputs', () => {
    expect(requiredFormGrid([{ type: 'timeline' }]))
      .toEqual({ columns: 2, rows: 1, cells: 2, scrolls: false });
  });

  it('counts a date as a full row because it renders a day and an hour input', () => {
    expect(requiredFormGrid([{ type: 'date' }]))
      .toEqual({ columns: 2, rows: 1, cells: 2, scrolls: false });
  });

  it('gives a wide field its own row rather than pairing it with a narrow one', () => {
    // text takes one cell, timeline takes both ⇒ 3 cells ⇒ 2 rows.
    expect(requiredFormGrid([{ type: 'text' }, { type: 'timeline' }]))
      .toEqual({ columns: 2, rows: 2, cells: 3, scrolls: false });
  });

  it('fills exactly four rows with eight narrow fields and does not scroll', () => {
    const fields = Array.from({ length: 8 }, () => ({ type: 'text' }));
    expect(requiredFormGrid(fields))
      .toEqual({ columns: 2, rows: 4, cells: 8, scrolls: false });
  });

  it('caps the height at four rows and scrolls the ninth field', () => {
    const fields = Array.from({ length: 9 }, () => ({ type: 'text' }));
    expect(requiredFormGrid(fields))
      .toEqual({ columns: 2, rows: FORM_MAX_ROWS, cells: 9, scrolls: true });
  });

  it('caps a wide-field overflow the same way', () => {
    const fields = Array.from({ length: 5 }, () => ({ type: 'timeline' }));
    expect(requiredFormGrid(fields))
      .toEqual({ columns: 2, rows: FORM_MAX_ROWS, cells: 10, scrolls: true });
  });

  it('treats no fields as one empty row instead of collapsing the modal', () => {
    expect(requiredFormGrid([])).toEqual({ columns: 1, rows: 1, cells: 0, scrolls: false });
    expect(requiredFormGrid(null)).toEqual({ columns: 1, rows: 1, cells: 0, scrolls: false });
  });

  it('treats an unknown column type as a single cell', () => {
    expect(requiredFormGrid([{ type: 'not_a_type' }, { type: 'text' }]))
      .toEqual({ columns: 2, rows: 1, cells: 2, scrolls: false });
  });
});

describe('requiredFormModalSize', () => {
  it('returns the pixel strings monday requires, never numbers', () => {
    const size = requiredFormModalSize([{ type: 'text' }]);
    expect(size.width).toMatch(/^\d+px$/);
    expect(size.height).toMatch(/^\d+px$/);
  });

  it('is narrower for one field than for two', () => {
    const one = requiredFormModalSize([{ type: 'text' }]);
    const two = requiredFormModalSize([{ type: 'text' }, { type: 'text' }]);
    expect(parseInt(one.width, 10)).toBeLessThan(parseInt(two.width, 10));
  });

  it('grows one row taller between two and three fields', () => {
    const twoRows = parseInt(requiredFormModalSize([
      { type: 'text' }, { type: 'text' }, { type: 'text' },
    ]).height, 10);
    const oneRow = parseInt(requiredFormModalSize([
      { type: 'text' }, { type: 'text' },
    ]).height, 10);
    expect(twoRows).toBeGreaterThan(oneRow);
  });

  it('stops growing after four rows so the modal never outgrows the screen', () => {
    const atCap = requiredFormModalSize(Array.from({ length: 8 }, () => ({ type: 'text' })));
    const beyondCap = requiredFormModalSize(Array.from({ length: 40 }, () => ({ type: 'text' })));
    expect(beyondCap.height).toBe(atCap.height);
  });

  it('sizes two fields to exactly one row of height', () => {
    const oneField = requiredFormModalSize([{ type: 'text' }]);
    const twoFields = requiredFormModalSize([{ type: 'text' }, { type: 'text' }]);
    // Same row count ⇒ same height; only the width differs.
    expect(twoFields.height).toBe(oneField.height);
  });

  it('sizes a lone timeline as one full-width row', () => {
    const timeline = requiredFormModalSize([{ type: 'timeline' }]);
    const twoNarrow = requiredFormModalSize([{ type: 'text' }, { type: 'text' }]);
    expect(timeline).toEqual(twoNarrow);
  });
});
