import { useEffect, useRef, useState } from 'react';

/*
 * Presentational min-display gate for the branded loading splash (BrandLoader).
 *
 * Purely a DISPLAY timer — it reads the real loading flag and never touches any
 * data-fetching, hook, or view logic. Given `active` (the view's real loading
 * state), it returns `true` while loading AND keeps returning `true` for at
 * least `ms` after loading STARTED, so a cached/instant load still shows the
 * splash briefly instead of flashing for a single frame.
 *
 * The window (re)arms whenever `active` rises false -> true. `prevActive` starts
 * `false`, so an `active` that is already `true` on the first render arms on
 * mount too — i.e., entering a view whose data begins loading shows the splash
 * for at least `ms`. When `active` is `false` from mount and never rises (e.g.
 * cached data already in memory / a test that mocks loading:false), the window
 * never arms and this returns `false`, revealing content immediately.
 *
 * The splash hides only once BOTH conditions hold: `active` is false AND `ms`
 * has elapsed since the last arm. Reduced-motion is handled by the component's
 * own CSS. No storage, no artificial delays beyond the short `ms` window.
 */
export function useMinSplash(active, ms = 800) {
  const [windowDone, setWindowDone] = useState(true); // closed until armed
  const [armToken, setArmToken] = useState(0);
  const prevActive = useRef(false);

  // Arm / re-arm the min window on each false -> true rise of `active`.
  useEffect(() => {
    if (active && !prevActive.current) {
      setArmToken((n) => n + 1);
      setWindowDone(false);
    }
    prevActive.current = active;
  }, [active]);

  // Once armed, close the window after `ms`. Re-arming resets the timer.
  useEffect(() => {
    if (armToken === 0) return undefined; // never armed → no timer
    setWindowDone(false);
    const id = setTimeout(() => setWindowDone(true), ms);
    return () => clearTimeout(id);
  }, [armToken, ms]);

  return active || !windowDone;
}

export default useMinSplash;
