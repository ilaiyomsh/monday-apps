import { useContext } from 'react';
import { useMediaQuery } from '@vibe/core';
import { MondayContext } from '../contexts/MondayContext.jsx';

/*
 * The single responsive seam for the mobile-adaptation work. Combines two signals:
 *
 *   1. Viewport width — Vibe's own breakpoint line (phone <= 767px, tablet
 *      768-1023px), read via @vibe/core's useMediaQuery (a thin window.matchMedia
 *      wrapper). We use the SAME 767/1023 boundaries Vibe's internals assume so the
 *      app's CSS @media rules and this hook agree.
 *   2. monday SDK mode — the monday mobile app sets context.mode === 'mobile',
 *      surfaced by MondayContext as `isMobile`. Read SOFTLY here (useContext on the
 *      raw context, tolerating a null provider) so the hook also works in unit tests
 *      and anywhere outside MondayProvider.
 *
 * `isMobile` is the signal for STRUCTURAL layout swaps (full-view modals, hover->tap,
 * bottom-anchored nav, table behaviour): true ONLY when running inside the monday
 * mobile app (context.mode==='mobile'). It deliberately does NOT key off viewport
 * width: monday narrows the board-view iframe (well below the phone breakpoint) when
 * it opens an item card / updates panel beside it, and collapsing the app into its
 * mobile layout for that transient split is jarring. Genuinely small screens are the
 * monday mobile app, which sets the SDK flag. `isPhoneViewport` is still exposed for
 * any purely-visual tweak that legitimately wants the raw width signal.
 *
 * Most test-resilient usage: a container component calls this hook and passes
 * `isMobile` DOWN as a prop to a dumb presentational component — so tests render the
 * presentational component with isMobile true/false and never have to mock matchMedia.
 */
const PHONE_QUERY = '(max-width: 767px)';
const TABLET_OR_BELOW_QUERY = '(max-width: 1023px)';

export function useViewport() {
  const [isPhoneViewport, isTabletOrBelowViewport] = useMediaQuery([
    PHONE_QUERY,
    TABLET_OR_BELOW_QUERY,
  ]);

  // Soft read: MondayContext may be absent (unit tests, local dev). Default to false.
  const ctx = useContext(MondayContext);
  const sdkMobile = ctx?.isMobile === true;

  // Structural mobile = the real monday mobile app ONLY (width is intentionally
  // ignored — see the note above about the item-card split narrowing the iframe).
  const isMobile = sdkMobile;
  const isDesktop = !isMobile;
  // Width signals are still surfaced (raw) for any purely-visual consumer, but no
  // longer feed isMobile/isDesktop. isTablet is kept for API stability.
  const isTablet = Boolean(isTabletOrBelowViewport) && !isPhoneViewport && !sdkMobile;

  return {
    isMobile,
    isTablet,
    isDesktop,
    isPhoneViewport: Boolean(isPhoneViewport),
    sdkMobile,
  };
}

export function useIsMobile() {
  return useViewport().isMobile;
}
