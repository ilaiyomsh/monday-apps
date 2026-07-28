/**
 * Size the required-fields modal from the fields it will show.
 *
 * The picker's own dialog is fixed at 200×250 by the Developer Center's Dialog
 * Design (see MANIFEST.md) and the SDK has NO runtime resize command — checked
 * against monday-sdk-js 0.5.9's execute types. So a form wider than a phone
 * column has to open as its own modal via `openAppFeatureModal`, which takes an
 * explicit pixel size. This module computes it.
 *
 * Layout: a 2-column grid, at most FORM_MAX_ROWS rows tall; anything beyond
 * that scrolls inside the form rather than growing the modal.
 *
 * The two controls that render TWO inputs of their own — `date` (day + hour) and
 * `timeline` (from + to) — take the full row, so nothing ends up in a half-width
 * box it cannot fit. They therefore cost two grid cells.
 *
 * Every constant below mirrors OnClickDialog.css. Changing one without the other
 * makes the modal either clip the form or float in empty space.
 */

import { fieldControlFor } from '../domain/columnFields.js';

export const FORM_COLUMNS = 2;
export const FORM_MAX_ROWS = 4;

export const FIELD_COLUMN_WIDTH_PX = 240;
export const FIELD_ROW_HEIGHT_PX = 78;
export const FORM_GAP_PX = 16;
export const FORM_PADDING_PX = 20;
export const FORM_HEADER_PX = 64;
export const FORM_ACTIONS_PX = 64;

/** Controls that render two inputs and therefore claim the whole row. */
const FULL_ROW_CONTROLS = new Set(['date', 'timeline']);

export function isFullRowControl(columnType) {
  return FULL_ROW_CONTROLS.has(fieldControlFor(columnType));
}

function cellsFor(field) {
  return isFullRowControl(field?.type) ? FORM_COLUMNS : 1;
}

/**
 * Grid geometry for a set of required fields.
 *
 * @param {{type: string}[]} fields  the required columns, in display order
 * @returns {{columns: number, rows: number, cells: number, scrolls: boolean}}
 *   `cells` counts grid cells (a full-row field counts as FORM_COLUMNS);
 *   `scrolls` is true when the content is taller than the capped height.
 */
export function requiredFormGrid(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const cells = list.reduce((total, field) => total + cellsFor(field), 0);

  if (cells === 0) {
    // No fields is not a real state for this modal, but a zero-height modal
    // would be unrecoverable, so keep one row.
    return {
      columns: 1, rows: 1, cells: 0, scrolls: false,
    };
  }

  const columns = Math.min(cells, FORM_COLUMNS);
  const neededRows = Math.ceil(cells / columns);
  return {
    columns,
    rows: Math.min(neededRows, FORM_MAX_ROWS),
    cells,
    scrolls: neededRows > FORM_MAX_ROWS,
  };
}

/**
 * Modal size for those fields. monday only accepts pixel STRINGS.
 *
 * @param {{type: string}[]} fields
 * @returns {{width: string, height: string}}
 */
export function requiredFormModalSize(fields) {
  const { columns, rows } = requiredFormGrid(fields);

  const width = FORM_PADDING_PX * 2
    + columns * FIELD_COLUMN_WIDTH_PX
    + Math.max(0, columns - 1) * FORM_GAP_PX;

  const height = FORM_PADDING_PX * 2
    + FORM_HEADER_PX
    + FORM_ACTIONS_PX
    + rows * FIELD_ROW_HEIGHT_PX
    + Math.max(0, rows - 1) * FORM_GAP_PX;

  return { width: `${width}px`, height: `${height}px` };
}
