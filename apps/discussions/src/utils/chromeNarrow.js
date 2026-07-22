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
 *
 * round227 — RECOVERY (owner bug: the toolbar sometimes vanished "for no
 * reason" and only came back after a refresh). The old detector kept a
 * monotonically-growing `maxW`, so a single transient WIDE reading (a reflow, a
 * zoom/dpr change, a brief monday relayout) inflated the baseline forever: the
 * real full width then sat below `maxW * ratio` and the chrome stayed hidden
 * until a reload reset `maxW`. Two guards fix it WITHOUT breaking the genuine
 * panel-open hide:
 *   1. A "real" item-card panel roughly HALVES the width, so only a DEEP narrow
 *      (< maxW * deepRatio) is treated as a panel and is NEVER re-baselined.
 *   2. A merely SHALLOW narrow (in [deepRatio, ratio) of maxW) almost always
 *      means the baseline is stale; once it holds steady across two checks we
 *      adopt the current width as the new `maxW` and clear the attribute, so the
 *      chrome self-heals. A low-frequency poll guarantees that second check even
 *      if the browser drops the panel-close resize event.
 */
export function installChromeNarrowWatcher({
  body = document.body,
  getWidth = () => window.innerWidth || document.documentElement.clientWidth || 0,
  ratio = 0.8,
  deepRatio = 0.6,
  poll = true,
  pollMs = 1500,
} = {}) {
  let maxW = 0;
  let lastShallowW = 0; // the last width seen in the SHALLOW-narrow band
  const compute = () => {
    const w = getWidth();
    if (w > maxW) maxW = w;
    if (isChromeNarrow(w, maxW, ratio)) {
      const shallow = w >= maxW * deepRatio;
      if (shallow && w === lastShallowW) {
        // Stable shallow-narrow ⇒ the baseline was inflated: adopt the current
        // width as the true full width and clear (the chrome reappears).
        maxW = w;
        lastShallowW = 0;
        body.removeAttribute('data-chrome-narrow');
        return;
      }
      lastShallowW = shallow ? w : 0;
      body.setAttribute('data-chrome-narrow', '1');
    } else {
      lastShallowW = 0;
      body.removeAttribute('data-chrome-narrow');
    }
  };
  compute();
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(compute);
    ro.observe(body);
  }
  window.addEventListener('resize', compute);
  let pollId = null;
  if (poll && typeof setInterval !== 'undefined') pollId = setInterval(compute, pollMs);
  return () => {
    if (pollId) clearInterval(pollId);
    if (ro) ro.disconnect();
    window.removeEventListener('resize', compute);
    body.removeAttribute('data-chrome-narrow');
  };
}
