import { useEffect, useRef, useState } from 'react';

/*
 * Presentational min-display gate for the branded loading splash (BrandLoader).
 *
 * Purely a DISPLAY timer — it reads the real loading flag and never touches any
 * data-fetching, hook, or view logic. Returns `true` while the splash should be
 * visible and `false` once the content may be revealed.
 *
 * The splash is visible while EITHER:
 *   - `active` (the real loading flag) is true, OR
 *   - the min-display window is still open (armed and < `ms` elapsed).
 * So it hides only once BOTH `active` is false AND `ms` has elapsed since the
 * last arm — a cached/instant load still shows the splash briefly instead of
 * flashing for a single frame.
 *
 * The window (re)arms on:
 *   - each false → true rise of `active` (e.g. app boot, while context is null),
 *   - AND each change of the optional `armKey` — pass a top-level view id (e.g.
 *     the current appView) so the splash REPLAYS on every view transition,
 *     independent of whether the destination view's data is cached/instant
 *     (round-37 stale-while-revalidate can keep `active` false the whole time,
 *     so a rise of `active` alone would never fire the splash on a warm switch).
 *
 * When `active` is false from mount, never rises, and `armKey` never changes,
 * the window never arms and this returns `false` — content shows immediately
 * (no behavior change for callers that don't pass `armKey`).
 *
 * Reduced-motion is handled by the component's own CSS. No storage, no
 * artificial delays beyond the short `ms` window.
 */
export function useMinSplash(active, ms = 900, armKey) {
  const [windowDone, setWindowDone] = useState(true); // closed until armed
  const [armToken, setArmToken] = useState(0);
  const prevActive = useRef(false);
  const prevKey = useRef(armKey);

  // Arm / re-arm on each false → true rise of `active` (boot) OR whenever
  // `armKey` changes (a top-level view switch). prevKey is seeded with the
  // initial armKey so mount is NOT counted as a key change — boot is armed by
  // the active rise instead.
  useEffect(() => {
    const activeRose = active && !prevActive.current;
    const keyChanged = !Object.is(armKey, prevKey.current);
    prevActive.current = active;
    prevKey.current = armKey;
    if (activeRose || keyChanged) {
      setArmToken((n) => n + 1);
      setWindowDone(false);
    }
  }, [active, armKey]);

  // Once armed, close the window after `ms`. Re-arming (armToken bump) clears the
  // pending timer and restarts the full `ms`, so a transition mid-window replays.
  useEffect(() => {
    if (armToken === 0) return undefined; // never armed → no timer
    setWindowDone(false);
    const id = setTimeout(() => setWindowDone(true), ms);
    return () => clearTimeout(id);
  }, [armToken, ms]);

  return active || !windowDone;
}

export default useMinSplash;
