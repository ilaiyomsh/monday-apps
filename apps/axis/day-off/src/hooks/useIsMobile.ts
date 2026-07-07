/**
 * useIsMobile — true when the app should render its dedicated mobile experience.
 *
 * `matchMedia` is the AUTHORITATIVE signal: correct on the very first paint (the
 * useState initializer reads it synchronously), no SDK dependency, no
 * flash-of-desktop. app-core's `isMobile` (derived from `context.mode ===
 * 'mobile'`) is OR'd in only as an enhancement — it is undocumented, absent from
 * the typed SDK context, and gated behind a 5000ms context watchdog that
 * resolves `false` on timeout, so it can never be the sole gate.
 *
 * Used ONLY where the DOM structure must change (bottom nav vs top tabs, the
 * FAB, the Modal variant). Pure ≤600px CSS in app.css's "MOBILE LAYER" section
 * drives everything else.
 */
import { useEffect, useState } from 'react';
import { useMondayContext } from '@axis/app-core';

/** THE phone breakpoint (px). Keep in sync with the "MOBILE LAYER (<=600px)"
 *  banner in app.css — a native @media query cannot read a CSS custom property,
 *  so the value is single-sourced here and mirrored by a comment in the CSS. */
export const MOBILE_BREAKPOINT = 600;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

function readMatch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

export function useIsMobile(): boolean {
  const [matches, setMatches] = useState(readMatch);
  const { isMobile: sdkMobile } = useMondayContext();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return matches || Boolean(sdkMobile);
}
