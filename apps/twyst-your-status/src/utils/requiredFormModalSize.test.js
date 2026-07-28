import { describe, expect, it } from 'vitest';
import {
  CONTROL_COLUMN_WIDTH_PX,
  FIELD_ROW_HEIGHT_PX,
  FORM_ACTIONS_PX,
  FORM_COLUMN_GAP_PX,
  FORM_GAP_PX,
  FORM_HEADER_PX,
  FORM_MAX_ROWS,
  FORM_MIN_ROWS,
  FORM_PADDING_PX,
  LABEL_COLUMN_WIDTH_PX,
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

  // Expressed against FORM_MAX_ROWS rather than a literal count: the cap moved from
  // 4 to 8 once the modal was allowed to grow, and a test that spells the number out
  // asserts the old product decision instead of the rule.
  it('shows every field at once, up to the cap, without scrolling', () => {
    expect(requiredFormLayout(Array.from({ length: FORM_MAX_ROWS }, () => field('text'))))
      .toEqual({ rows: FORM_MAX_ROWS, fields: FORM_MAX_ROWS, scrolls: false });
  });

  it('caps the visible rows and scrolls the first field past the cap', () => {
    const overCap = FORM_MAX_ROWS + 1;
    expect(requiredFormLayout(Array.from({ length: overCap }, () => field('text'))))
      .toEqual({ rows: FORM_MAX_ROWS, fields: overCap, scrolls: true });
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

  it('stops growing at the cap so the modal never outgrows the screen', () => {
    const atCap = requiredFormModalSize(
      Array.from({ length: FORM_MAX_ROWS }, () => field('text')),
    );
    const beyondCap = requiredFormModalSize(Array.from({ length: 40 }, () => field('text')));
    expect(beyondCap.height).toBe(atCap.height);
    // And the row below the cap is genuinely shorter — otherwise "stops growing"
    // would also pass on a modal that never grew at all.
    const belowCap = requiredFormModalSize(
      Array.from({ length: FORM_MAX_ROWS - 1 }, () => field('text')),
    );
    expect(parseInt(belowCap.height, 10)).toBeLessThan(parseInt(atCap.height, 10));
  });

  it('never sizes below two rows, so one required column still opens as a form', () => {
    // A single field sized to a single row is a sliver: title, one field, button — barely
    // taller than the picker that opened it.
    const one = requiredFormModalSize([field('text')]);
    const two = requiredFormModalSize([field('text'), field('text')]);
    expect(one.height).toBe(two.height);
  });

  it('keeps growing normally once past the floor', () => {
    // The floor must not flatten real growth: three fields are taller than two.
    const two = parseInt(requiredFormModalSize(Array.from({ length: 2 }, () => field('text'))).height, 10);
    const three = parseInt(requiredFormModalSize(Array.from({ length: 3 }, () => field('text'))).height, 10);
    expect(three).toBeGreaterThan(two);
  });

  it('reports the real row count even when the modal is sized to the floor', () => {
    // The floor is a SIZING concern. The list still has one row, and claiming two would
    // make the form render a phantom.
    expect(requiredFormLayout([field('text')]).rows).toBe(1);
  });

  it('asks for MORE height than the form itself needs, so the common case never scrolls', () => {
    // An exact fit is what put the title and the submit button into the scroll: monday
    // draws its own modal chrome inside the box it hands us, and a row can render a
    // pixel or two over its budget, so "exactly enough" was a few pixels short in
    // practice. The CSS pins the header and footer regardless — this headroom is what
    // keeps a form that FITS from scrolling at all. Remove MODAL_CHROME_PX from the
    // height and this goes back to a dead heat.
    // From FORM_MIN_ROWS up: at one row the sizing floor would mask a missing headroom.
    [FORM_MIN_ROWS, 3, FORM_MAX_ROWS].forEach((rows) => {
      const ownContent = (FORM_PADDING_PX * 2)
        + FORM_HEADER_PX
        + FORM_ACTIONS_PX
        + (rows * FIELD_ROW_HEIGHT_PX)
        + ((rows - 1) * FORM_GAP_PX);
      const asked = parseInt(
        requiredFormModalSize(Array.from({ length: rows }, () => field('text'))).height,
        10,
      );
      expect(asked, `${rows} row(s)`).toBeGreaterThan(ownContent);
    });
  });

  it('is wide enough for a label column beside a usable control', () => {
    // A control squeezed under ~300px cannot hold a people picker's chips or a
    // timeline's two dates, which is what the 200px picker dialog could not do.
    expect(parseInt(requiredFormModalSize([field('people')]).width, 10))
      .toBeGreaterThanOrEqual(460);
  });

  /*
   * The 3.9.0 widening (owner request): the modal is 25% wider, and every added
   * pixel belongs to the column names — the field controls keep the width they had.
   *
   * Both halves are asserted because either alone passes on the wrong change: a
   * width-only test passes when the growth is handed to the control column, and a
   * column-only test passes when the modal was never widened.
   */
  const PRE_WIDENING_WIDTH_PX = 526;
  const PRE_WIDENING_LABEL_PX = 150;
  const PRE_WIDENING_CONTROL_PX = 320;

  it('is exactly 25% wider than the pre-3.9.0 layout', () => {
    expect(parseInt(requiredFormModalSize([field('text')]).width, 10))
      .toBe(Math.round(PRE_WIDENING_WIDTH_PX * 1.25));
  });

  it('leaves the control column untouched and gives the whole widening to the labels', () => {
    const width = parseInt(requiredFormModalSize([field('text')]).width, 10);
    expect(CONTROL_COLUMN_WIDTH_PX).toBe(PRE_WIDENING_CONTROL_PX);
    expect(LABEL_COLUMN_WIDTH_PX)
      .toBe(PRE_WIDENING_LABEL_PX + (width - PRE_WIDENING_WIDTH_PX));
  });

  it('spends its whole width on one padding box and the two columns', () => {
    // The row grid is laid out from these same constants (RequiredFieldsForm passes
    // LABEL_COLUMN_WIDTH_PX down as a custom property), so a modal wider or narrower
    // than their sum is either dead space or a clipped control column.
    expect(
      (FORM_PADDING_PX * 2)
      + LABEL_COLUMN_WIDTH_PX
      + FORM_COLUMN_GAP_PX
      + CONTROL_COLUMN_WIDTH_PX,
    ).toBe(parseInt(requiredFormModalSize([field('text')]).width, 10));
  });

  it('keeps the widened width at every field count', () => {
    const wide = Math.round(PRE_WIDENING_WIDTH_PX * 1.25);
    [1, FORM_MIN_ROWS, FORM_MAX_ROWS, 40].forEach((count) => {
      expect(parseInt(requiredFormModalSize(
        Array.from({ length: count }, () => field('text')),
      ).width, 10), `${count} field(s)`).toBe(wide);
    });
  });
});
