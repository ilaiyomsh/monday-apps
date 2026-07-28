/**
 * Compute openAppFeatureModal size — monday only accepts pixel strings.
 *
 * The Column Settings shell runs inside a tiny monday iframe. Measuring that
 * iframe's `window.innerWidth` (as 3.2.0–3.2.4 did) shrinks the nested modal
 * to a postcard. Prefer an explicit *large* viewport, else the physical
 * screen, else the known-good fixed 1100×820 that worked before.
 *
 * @param {{ innerWidth?: number, innerHeight?: number }|null} [viewport]
 * @returns {{ width: string, height: string }}
 */
export function settingsModalSize(viewport = null) {
  const FIXED = { width: '1100px', height: '820px' };
  const VIEWPORT_FRACTION = 0.8;
  const MAX_FRACTION = 0.94;
  const MIN_WIDTH = 1100;
  const MIN_HEIGHT = 820;

  const picked = pickUsefulViewport(viewport);
  if (!picked) return FIXED;

  const width = Math.min(
    Math.floor(picked.w * MAX_FRACTION),
    Math.max(MIN_WIDTH, Math.floor(picked.w * VIEWPORT_FRACTION)),
  );
  const height = Math.min(
    Math.floor(picked.h * MAX_FRACTION),
    Math.max(MIN_HEIGHT, Math.floor(picked.h * VIEWPORT_FRACTION)),
  );

  return { width: `${width}px`, height: `${height}px` };
}

/** Reject iframe-sized shells; only real desktop-ish metrics count. */
function asUseful(rawW, rawH) {
  const w = Number(rawW);
  const h = Number(rawH);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < 1000 || h < 700) return null;
  return { w, h };
}

function pickUsefulViewport(viewport) {
  const fromArg = asUseful(viewport?.innerWidth, viewport?.innerHeight);
  if (fromArg) return fromArg;

  if (typeof window === 'undefined') return null;

  const screen = window.screen;
  return asUseful(
    screen?.availWidth || screen?.width,
    screen?.availHeight || screen?.height,
  );
}
