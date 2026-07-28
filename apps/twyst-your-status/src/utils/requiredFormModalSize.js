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
 * past that. Only the LIST scrolls: the title and the actions are pinned by
 * .twyst-form's `auto 1fr auto` grid inside a viewport-height, overflow-hidden
 * modal, so a ninth field never pushes the submit button off screen.
 *
 * Every constant below mirrors OnClickDialog.css. Changing one without the other
 * makes the modal either clip the form or float in empty space.
 */

export const FORM_MAX_ROWS = 8;

/**
 * Floor for SIZING only.
 *
 * One required column sized to exactly one row opens as a sliver — a title, a single
 * field and a button, barely taller than the picker that launched it, which does not read
 * as a form. The modal is therefore never sized below two rows.
 *
 * This is deliberately NOT applied in `requiredFormLayout`: that function describes the
 * actual list, and a one-field form genuinely has one row. The extra height simply falls
 * below the last field.
 */
export const FORM_MIN_ROWS = 2;

export const LABEL_COLUMN_WIDTH_PX = 150;
export const CONTROL_COLUMN_WIDTH_PX = 320;
// 36px is the real row height (.twyst-form-row min-height, and the min-block-size of
// every option bar); the extra 4 is breathing room for a control that renders a pixel
// or two taller. It was 48, which showed up as visible dead space above the footer —
// 12px per row, and at the 8-row cap that would have been a 96px hole.
export const FIELD_ROW_HEIGHT_PX = 40;
export const FORM_GAP_PX = 12;
export const FORM_COLUMN_GAP_PX = 16;
export const FORM_PADDING_PX = 20;
// One h2 (15px, 10px bottom margin) plus the form's own 12px grid gap. It was 64 when
// the header also carried an eyebrow and a status-name heading.
export const FORM_HEADER_PX = 40;
export const FORM_ACTIONS_PX = 64;

/**
 * Headroom, because the height we ASK for is not the height we GET.
 *
 * monday draws its own modal chrome (the close button, its own padding) in the box it
 * gives us, and rows can render a pixel or two over their budget. Sizing the form to
 * fit the request EXACTLY meant a few pixels of overflow in practice, and those few
 * pixels are what pushed the title and the submit button into the scroll.
 *
 * The CSS is what GUARANTEES the header and footer stay put (see the
 * `grid-template-rows: minmax(0, 1fr)` note on .twyst-required-fields-modal) — this
 * constant only keeps the common case from needing to scroll at all. It is one flat
 * allowance, not per-row, so it costs nothing in visible dead space.
 */
export const MODAL_CHROME_PX = 24;

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
  const { rows: listRows } = requiredFormLayout(fields);
  // Sized rows, not list rows — see FORM_MIN_ROWS.
  const rows = Math.max(listRows, FORM_MIN_ROWS);

  const width = (FORM_PADDING_PX * 2)
    + LABEL_COLUMN_WIDTH_PX
    + FORM_COLUMN_GAP_PX
    + CONTROL_COLUMN_WIDTH_PX;

  const height = (FORM_PADDING_PX * 2)
    + FORM_HEADER_PX
    + FORM_ACTIONS_PX
    + (rows * FIELD_ROW_HEIGHT_PX)
    + (Math.max(0, rows - 1) * FORM_GAP_PX)
    + MODAL_CHROME_PX;

  return { width: `${width}px`, height: `${height}px` };
}
