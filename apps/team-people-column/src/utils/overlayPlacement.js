// SOURCE: ported from apps/discussions/src/utils/overlayPlacement.js (the
// "discussions" board-view app). Used by the body-portal Popover/PersonPicker
// so floating menus flip/clamp inside the viewport instead of clipping.
const VIEWPORT_PADDING = 8;

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Returns a popover position that stays inside viewport bounds.
 * - Flips vertically when there is not enough space below/above.
 * - Clamps horizontal/vertical coordinates to prevent clipping.
 */
export function computeFloatingPosition({
  anchorRect,
  preferred = 'bottom-start',
  popupWidth = 280,
  popupHeight = 280,
  offset = 6,
  viewportPadding = VIEWPORT_PADDING,
  rtl,
}) {
  if (!anchorRect) return null;

  // 'start'/'end' are logical (inline) edges — resolve them against direction.
  // Default to the document direction when the caller doesn't pass `rtl`.
  const isRtl = typeof rtl === 'boolean'
    ? rtl
    : (typeof document !== 'undefined' && document.documentElement.getAttribute('dir') === 'rtl');

  const [preferredVertical = 'bottom', preferredHorizontal = 'start'] = String(preferred).split('-');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(popupWidth, vw - viewportPadding * 2);
  const height = Math.min(popupHeight, vh - viewportPadding * 2);

  const roomBelow = vh - anchorRect.bottom - viewportPadding;
  const roomAbove = anchorRect.top - viewportPadding;

  let vertical = preferredVertical;
  if (preferredVertical === 'bottom' && roomBelow < height && roomAbove > roomBelow) {
    vertical = 'top';
  } else if (preferredVertical === 'top' && roomAbove < height && roomBelow > roomAbove) {
    vertical = 'bottom';
  }

  const rawTop = vertical === 'bottom'
    ? anchorRect.bottom + offset
    : anchorRect.top - height - offset;

  const minLeft = viewportPadding;
  const maxLeft = Math.max(viewportPadding, vw - viewportPadding - width);

  // In RTL the inline-start edge is the anchor's RIGHT edge, so a popup wider
  // than its anchor grows toward the visual start (left) instead of overflowing
  // past the physical right. 'end' mirrors the same way.
  const startAtRightEdge = preferredHorizontal === 'start' && isRtl;
  const endAtLeftEdge = preferredHorizontal === 'end' && isRtl;

  let rawLeft = anchorRect.left;
  if (startAtRightEdge) rawLeft = anchorRect.right - width;
  if (preferredHorizontal === 'end') rawLeft = endAtLeftEdge ? anchorRect.left : anchorRect.right - width;
  if (preferredHorizontal === 'center') rawLeft = anchorRect.left + (anchorRect.width - width) / 2;

  return {
    top: clamp(rawTop, viewportPadding, Math.max(viewportPadding, vh - viewportPadding - height)),
    left: clamp(rawLeft, minLeft, maxLeft),
    width,
    height,
    vertical,
    horizontal: preferredHorizontal,
    placement: `${vertical}-${preferredHorizontal}`,
  };
}
