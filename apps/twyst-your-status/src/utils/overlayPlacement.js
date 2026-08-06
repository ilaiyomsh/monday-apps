// SOURCE: ported from apps/discussions/src/utils/overlayPlacement.js (the
// "discussions" board-view app). Used by the body-portal Popover/PersonPicker
// so floating menus flip/clamp inside the viewport instead of clipping.
const VIEWPORT_PADDING = 8;

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Horizontal clamp for a fixed-position overlay anchored under its trigger:
 * never closer than VIEWPORT_PADDING to either edge, and never pushed past the
 * left edge when the popup is wider than the viewport.
 */
export function clampOverlayLeft(anchorLeft, popupWidth, viewportWidth) {
  return Math.min(
    Math.max(VIEWPORT_PADDING, anchorLeft),
    Math.max(VIEWPORT_PADDING, viewportWidth - popupWidth - VIEWPORT_PADDING),
  );
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
}) {
  if (!anchorRect) return null;

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

  let rawLeft = anchorRect.left;
  if (preferredHorizontal === 'end') rawLeft = anchorRect.right - width;
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

