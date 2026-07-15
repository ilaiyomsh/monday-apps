/*
 * round103 — "chrome narrow" detector.
 *
 * monday's item-card (updates) side panel DOCKS and shrinks the app's iframe;
 * there is NO SDK open/close event, so the only reliable signal that the panel
 * is open is a large drop in the viewport width relative to the widest we've
 * seen. When that happens we set `body[data-chrome-narrow="1"]`, and each view's
 * CSS hides the non-essential chrome (discussion header details, the quick-filter
 * battery, and the whole search/filter/sort toolbar) so nothing "slides left" —
 * it simply disappears while the panel is open and returns when it closes.
 */

// Pure decision: is the current width narrow enough (relative to the widest seen)
// to be treated as "panel open"? Exported for testing. The panel roughly halves
// the width, so a 0.8 ratio triggers on the panel but not on a mild manual resize.
export function isChromeNarrow(current, max, ratio = 0.8) {
  if (!(max > 0) || !(current > 0)) return false;
  return current < max * ratio;
}

/**
 * Observe the viewport width and toggle `body[data-chrome-narrow]`. Returns a
 * cleanup function. `getWidth` is injectable for testing (defaults to the live
 * viewport width).
 */
export function installChromeNarrowWatcher({
  body = document.body,
  getWidth = () => window.innerWidth || document.documentElement.clientWidth || 0,
  ratio = 0.8,
} = {}) {
  let maxW = 0;
  const compute = () => {
    const w = getWidth();
    if (w > maxW) maxW = w;
    if (isChromeNarrow(w, maxW, ratio)) body.setAttribute('data-chrome-narrow', '1');
    else body.removeAttribute('data-chrome-narrow');
  };
  compute();
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(compute);
    ro.observe(body);
  }
  window.addEventListener('resize', compute);
  return () => {
    if (ro) ro.disconnect();
    window.removeEventListener('resize', compute);
    body.removeAttribute('data-chrome-narrow');
  };
}
