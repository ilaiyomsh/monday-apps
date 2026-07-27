/**
 * Compute openAppFeatureModal size from the viewport — monday only accepts
 * pixel strings, so we mirror discussions' CSS `min(744px, 94vw/vh)`.
 *
 * @param {{ innerWidth?: number, innerHeight?: number }|null} [viewport]
 * @returns {{ width: string, height: string }}
 */
export function settingsModalSize(viewport = typeof window !== 'undefined' ? window : null) {
  const vw = Number(viewport?.innerWidth);
  const vh = Number(viewport?.innerHeight);
  const safeW = Number.isFinite(vw) && vw > 0 ? vw : 1100;
  const safeH = Number.isFinite(vh) && vh > 0 ? vh : 820;
  const width = Math.max(320, Math.min(744, Math.floor(safeW * 0.94)));
  const height = Math.max(320, Math.min(744, Math.floor(safeH * 0.94)));
  return { width: `${width}px`, height: `${height}px` };
}
