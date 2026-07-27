/**
 * Compute openAppFeatureModal size from the viewport — monday only accepts
 * pixel strings. Settings need a large surface (≥80% of the screen) with a
 * floor so the editor never shrinks to a postcard on mid-size monitors.
 *
 * @param {{ innerWidth?: number, innerHeight?: number }|null} [viewport]
 * @returns {{ width: string, height: string }}
 */
export function settingsModalSize(viewport = typeof window !== 'undefined' ? window : null) {
  const VIEWPORT_FRACTION = 0.8;
  const MAX_FRACTION = 0.94;
  const MIN_WIDTH = 720;
  const MIN_HEIGHT = 560;
  // Fallback ≈ 80% of a common 1440×900 desktop when metrics are unavailable.
  const FALLBACK_WIDTH = 1152;
  const FALLBACK_HEIGHT = 720;

  const vw = Number(viewport?.innerWidth);
  const vh = Number(viewport?.innerHeight);
  const safeW = Number.isFinite(vw) && vw > 0 ? vw : FALLBACK_WIDTH / VIEWPORT_FRACTION;
  const safeH = Number.isFinite(vh) && vh > 0 ? vh : FALLBACK_HEIGHT / VIEWPORT_FRACTION;

  const targetW = Math.floor(safeW * VIEWPORT_FRACTION);
  const targetH = Math.floor(safeH * VIEWPORT_FRACTION);
  const maxW = Math.floor(safeW * MAX_FRACTION);
  const maxH = Math.floor(safeH * MAX_FRACTION);

  const width = Math.min(Math.max(targetW, MIN_WIDTH), maxW);
  const height = Math.min(Math.max(targetH, MIN_HEIGHT), maxH);

  return { width: `${width}px`, height: `${height}px` };
}
