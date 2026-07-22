/*
 * round237 point 1 (delivered round243) — confine the point-anchored quick-create
 * card INSIDE the אג'נדה box instead of clamping it to the whole viewport, so a
 * "+" create never spills outside the topics card ("שהכרטיס יהיה כולו בתוך כרטיס
 * הנושאים").
 *
 * Pure geometry so it can be unit-tested — jsdom has no layout, so the modal's
 * own getBoundingClientRect-driven placement can't be. All rects are plain
 * { left, top, right, bottom, width, height } in viewport px.
 */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}

/**
 * Position of the anchored card, clamped to sit fully inside `bounds` (the
 * agenda box). The card opens centered under the "+" (`anchor`) and just below
 * it; if it would spill past the box it slides in (or up) and, when the box is
 * too short, caps its height so the content scrolls inside.
 *
 * Returns { left, top, width, maxHeight } (px) or null when either rect is
 * missing (caller then falls back to the viewport placement).
 */
export function computeBoundedAnchorStyle({ anchor, bounds, cardWidth = 320, gap = 8, pad = 8, estHeight = 300 }) {
  if (!anchor || !bounds) return null;
  // Width never exceeds the box's inner width.
  const width = Math.max(0, Math.min(cardWidth, bounds.width - 2 * pad));
  // Horizontal: center on the "+", clamped between the box's padded edges.
  const centerX = anchor.left + anchor.width / 2;
  const minLeft = bounds.left + pad;
  const maxLeft = bounds.right - width - pad;
  const left = clamp(centerX - width / 2, minLeft, Math.max(minLeft, maxLeft));
  // Vertical: open just under the "+", but keep the whole card inside the box —
  // slide up when needed, and never above the box's padded top.
  const maxHeight = Math.max(0, bounds.height - 2 * pad);
  const h = Math.min(estHeight, maxHeight);
  const minTop = bounds.top + pad;
  const maxTop = bounds.bottom - pad - h;
  const top = clamp(anchor.bottom + gap, minTop, Math.max(minTop, maxTop));
  return { left, top, width, maxHeight };
}

export default computeBoundedAnchorStyle;
