/**
 * Size the required-fields modal from the fields it will show.
 *
 * The picker's own dialog is fixed at 200×250 by the Developer Center's Dialog
 * Design (see MANIFEST.md) and the SDK has NO runtime resize command — checked
 * against monday-sdk-js 0.5.9's execute types. So the fill form opens as its own
 * modal via `openAppFeatureModal`, which takes an explicit pixel size.
 *
 * Layout follows monday's native item form: a LIST of rows, one field per row,
 * each row a fixed label column (icon + title) beside a wide control column.
 * Width is therefore constant — it is the layout, not the field count — and only
 * the height follows the rows, capped at FORM_MAX_ROWS with the list scrolling
 * past that.
 *
 * Every constant below mirrors OnClickDialog.css. Changing one without the other
 * makes the modal either clip the form or float in empty space.
 */

export const FORM_MAX_ROWS = 4;

export const LABEL_COLUMN_WIDTH_PX = 150;
export const CONTROL_COLUMN_WIDTH_PX = 320;
export const FIELD_ROW_HEIGHT_PX = 48;
export const FORM_GAP_PX = 12;
export const FORM_COLUMN_GAP_PX = 16;
export const FORM_PADDING_PX = 20;
export const FORM_HEADER_PX = 64;
export const FORM_ACTIONS_PX = 64;

/**
 * Row geometry for a set of required fields.
 *
 * @param {{type: string}[]} fields  the required columns, in display order
 * @returns {{rows: number, fields: number, scrolls: boolean}}
 *   `rows` is how many are VISIBLE (capped); `fields` is how many exist;
 *   `scrolls` is true when the list is longer than the capped height.
 */
export function requiredFormLayout(fields) {
  const count = Array.isArray(fields) ? fields.length : 0;
  if (count === 0) {
    // No fields is not a real state for this modal, but a zero-height modal would
    // be unrecoverable, so keep one row.
    return { rows: 1, fields: 0, scrolls: false };
  }
  return {
    rows: Math.min(count, FORM_MAX_ROWS),
    fields: count,
    scrolls: count > FORM_MAX_ROWS,
  };
}

/**
 * Modal size for those fields. monday only accepts pixel STRINGS.
 *
 * @param {{type: string}[]} fields
 * @returns {{width: string, height: string}}
 */
export function requiredFormModalSize(fields) {
  const { rows } = requiredFormLayout(fields);

  const width = (FORM_PADDING_PX * 2)
    + LABEL_COLUMN_WIDTH_PX
    + FORM_COLUMN_GAP_PX
    + CONTROL_COLUMN_WIDTH_PX;

  const height = (FORM_PADDING_PX * 2)
    + FORM_HEADER_PX
    + FORM_ACTIONS_PX
    + (rows * FIELD_ROW_HEIGHT_PX)
    + (Math.max(0, rows - 1) * FORM_GAP_PX);

  return { width: `${width}px`, height: `${height}px` };
}
