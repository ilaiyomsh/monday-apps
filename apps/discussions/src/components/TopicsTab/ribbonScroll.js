/*
 * round302 — scroll math for the agenda's topic ribbon.
 *
 * The ribbon lays out RIGHT-TO-LEFT, and RTL `scrollLeft` is negative-going in
 * Chromium/Firefox but positive-going in older engines. Guessing the sign once up
 * front is exactly how this broke during the mockup: the probe ran while the strip
 * did not overflow yet, read 0, picked the wrong sign, and every scroll silently
 * clamped to 0 — nothing moved. So every write here ASSIGNS AND VERIFIES, which
 * self-corrects on whichever engine is running and cannot be fooled by a
 * non-overflowing strip.
 *
 * Throughout, `pos` is a direction-free distance: 0 = the START of the agenda (the
 * FIRST topic, rightmost in RTL), max = the last topic scrolled fully into view.
 */

/** Furthest scrollable distance. 0 when everything fits. */
export function maxPos(el) {
  if (!el) return 0;
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

/** Current distance from the start, sign-independent. */
export function readPos(el) {
  if (!el) return 0;
  return Math.abs(el.scrollLeft);
}

/**
 * Scroll to `p` (clamped), then return where we actually landed. Writes the
 * negative form first and retries positive if the engine ignored it.
 */
export function writePos(el, p) {
  if (!el) return 0;
  const m = maxPos(el);
  const target = Math.max(0, Math.min(m, p));
  el.scrollLeft = -target;
  if (Math.abs(el.scrollLeft) < target - 1) el.scrollLeft = target;
  return Math.abs(el.scrollLeft);
}

/**
 * Which scroll affordances apply. `hasOverflow` false ⇒ show nothing at all, so a
 * short agenda stays visually clean.
 */
export function computeEdges(pos, max) {
  const hasOverflow = max > 2;
  return {
    hasOverflow,
    atStart: !hasOverflow || pos <= 1,
    atEnd: !hasOverflow || pos >= max - 1,
  };
}

/**
 * Geometry for the slim drag bar. Returns null when there is nothing to scroll.
 * `offset` is measured from the bar's START edge (the RIGHT edge in RTL), so
 * pos 0 puts the thumb against the first topic's side.
 */
export function computeThumb({ clientWidth, scrollWidth, pos, barWidth, minThumb = 24 }) {
  const max = Math.max(0, scrollWidth - clientWidth);
  if (max <= 2 || barWidth <= 0 || scrollWidth <= 0) return null;
  const width = Math.min(barWidth, Math.max(minThumb, Math.round(barWidth * (clientWidth / scrollWidth))));
  const span = barWidth - width;
  const offset = span <= 0 ? 0 : Math.round(span * Math.max(0, Math.min(1, pos / max)));
  return { width, offset };
}

/**
 * Where the strip should sit after dragging the thumb from `startX` to `x`.
 * Dragging toward the physical LEFT advances the RTL ribbon, hence startX - x.
 */
export function posFromThumbDrag({ startPos, startX, x, max, span }) {
  if (!span || span <= 0) return startPos;
  const moved = (startX - x) * (max / span);
  return Math.max(0, Math.min(max, startPos + moved));
}

/** One chevron press moves a bit more than a tile, so context always overlaps. */
export function stepFrom(pos, tileWidth, dir) {
  const step = Math.max(80, (tileWidth || 110) * 1.4);
  return dir === 'end' ? pos + step : pos - step;
}
