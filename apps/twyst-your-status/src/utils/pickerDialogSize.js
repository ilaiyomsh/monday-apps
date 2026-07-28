/**
 * Dialog Design iframe height so N status pills fit without scrolling.
 * Matches OnClickDialog.css: option 34px, gap 6px, menu padding 8px.
 */
export const PICKER_OPTION_HEIGHT_PX = 34;
export const PICKER_OPTION_GAP_PX = 6;
export const PICKER_MENU_PADDING_PX = 8;
export const PICKER_VISIBLE_LABELS = 6;

/**
 * @param {number} [labelCount=PICKER_VISIBLE_LABELS]
 * @returns {number} pixel height for the monday Dialog Design custom height
 */
export function pickerDialogHeightPx(labelCount = PICKER_VISIBLE_LABELS) {
  const count = Number(labelCount);
  const n = Number.isInteger(count) && count > 0 ? count : PICKER_VISIBLE_LABELS;
  return (
    PICKER_MENU_PADDING_PX * 2
    + n * PICKER_OPTION_HEIGHT_PX
    + Math.max(0, n - 1) * PICKER_OPTION_GAP_PX
  );
}
