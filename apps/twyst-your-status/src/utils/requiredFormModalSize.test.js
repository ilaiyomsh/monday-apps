import { describe, expect, it } from 'vitest';
import {
  FORM_MAX_ROWS,
  requiredFormLayout,
  requiredFormModalSize,
} from './requiredFormModalSize.js';

const field = (type) => ({ type });

describe('requiredFormLayout', () => {
  it('gives every field its own row — the form is a list, not a grid', () => {
    expect(requiredFormLayout([field('people'), field('text')]))
      .toEqual({ rows: 2, fields: 2, scrolls: false });
  });

  it('gives a lone field one row', () => {
    expect(requiredFormLayout([field('text')])).toEqual({ rows: 1, fields: 1, scrolls: false });
  });

  it('gives a date one row, since its hour lives inside the picker', () => {
    // The hour is set in the date popover, not in a second input beside it, so a
    // date costs exactly one row like any other field.
    expect(requiredFormLayout([field('date')])).toEqual({ rows: 1, fields: 1, scrolls: false });
  });

  it('shows four rows at once without scrolling', () => {
    expect(requiredFormLayout(Array.from({ length: 4 }, () => field('text'))))
      .toEqual({ rows: 4, fields: 4, scrolls: false });
  });

  it('caps the visible rows at four and scrolls the fifth field', () => {
    expect(requiredFormLayout(Array.from({ length: 5 }, () => field('text'))))
      .toEqual({ rows: FORM_MAX_ROWS, fields: 5, scrolls: true });
  });

  it('keeps the cap no matter how many fields are required', () => {
    expect(requiredFormLayout(Array.from({ length: 40 }, () => field('text'))))
      .toEqual({ rows: FORM_MAX_ROWS, fields: 40, scrolls: true });
  });

  it('treats no fields as one empty row instead of collapsing the modal', () => {
    expect(requiredFormLayout([])).toEqual({ rows: 1, fields: 0, scrolls: false });
    expect(requiredFormLayout(null)).toEqual({ rows: 1, fields: 0, scrolls: false });
  });
});

describe('requiredFormModalSize', () => {
  it('returns the pixel strings monday requires, never numbers', () => {
    const size = requiredFormModalSize([field('text')]);
    expect(size.width).toMatch(/^\d+px$/);
    expect(size.height).toMatch(/^\d+px$/);
  });

  it('keeps one width for every field count — only the height follows the rows', () => {
    // Each row is label-then-control, so the width is the layout, not the count.
    const one = requiredFormModalSize([field('text')]);
    const four = requiredFormModalSize(Array.from({ length: 4 }, () => field('text')));
    expect(four.width).toBe(one.width);
    expect(parseInt(four.height, 10)).toBeGreaterThan(parseInt(one.height, 10));
  });

  it('grows by exactly one row between two and three fields', () => {
    const two = parseInt(requiredFormModalSize([field('text'), field('text')]).height, 10);
    const three = parseInt(requiredFormModalSize([
      field('text'), field('text'), field('text'),
    ]).height, 10);
    const four = parseInt(requiredFormModalSize([
      field('text'), field('text'), field('text'), field('text'),
    ]).height, 10);
    expect(three - two).toBe(four - three);
  });

  it('stops growing after four rows so the modal never outgrows the screen', () => {
    const atCap = requiredFormModalSize(Array.from({ length: 4 }, () => field('text')));
    const beyondCap = requiredFormModalSize(Array.from({ length: 40 }, () => field('text')));
    expect(beyondCap.height).toBe(atCap.height);
  });

  it('is wide enough for a label column beside a usable control', () => {
    // A control squeezed under ~300px cannot hold a people picker's chips or a
    // timeline's two dates, which is what the 200px picker dialog could not do.
    expect(parseInt(requiredFormModalSize([field('people')]).width, 10))
      .toBeGreaterThanOrEqual(460);
  });
});
