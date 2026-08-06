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
export function computeBoundedAnchorStyle({
  anchor, bounds, cardWidth = 280, widthScale = 1.2, gap = 8, pad = 8, estHeight = 260, viewportWidth,
}) {
  if (!anchor || !bounds) return null;
  /*
   * round368 §3 (owner spec) — the card is `widthScale`× wider and every added
   * pixel goes LEFT: its RIGHT edge stays exactly where round243/266 put it.
   * The scale is the owner's dial: 1.5 (round368) → 1.8 (round369) → **1.2**
   * (round370, "אני לא רוצה ב80% אלא ב20%"). Only this number moves.
   * So the base placement is computed first (a cardWidth-wide card centered
   * under the "+", clamped inside the agenda box), its right edge is frozen,
   * and the card then grows leftward from there. Growing left may take it past
   * the agenda box's left edge — deliberate; the viewport is the only hard stop,
   * and even that clamp keeps the right edge fixed (the width absorbs it).
   */
  const baseWidth = Math.max(0, Math.min(cardWidth, bounds.width - 2 * pad));
  const centerX = anchor.left + anchor.width / 2;
  const minLeft = bounds.left + pad;
  const maxLeft = bounds.right - baseWidth - pad;
  const baseLeft = clamp(centerX - baseWidth / 2, minLeft, Math.max(minLeft, maxLeft));
  const rightEdge = baseLeft + baseWidth;

  const maxWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth - 2 * pad)
    : Infinity;
  let width = Math.min(baseWidth * widthScale, maxWidth);
  let left = rightEdge - width;
  if (left < pad) {
    left = pad;
    width = Math.max(0, rightEdge - pad);
  }
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
