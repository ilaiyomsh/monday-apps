// round168 — reveal the vertical scrollbar ONLY while the pointer is within the
// rightmost fraction of the viewport (owner request: "reveal only when the mouse
// is in the right third of the screen"). Pure CSS can't detect the pointer's
// x-position inside an element, so a scroll view opts in via `useRightEdgeReveal`
// and toggles a reveal class; the container's CSS paints the thumb only then.
import { useEffect, useRef, useState } from 'react';

// Default: the rightmost third of the screen.
export const RIGHT_REVEAL_FRACTION = 1 / 3;

// True when `clientX` falls inside the rightmost `fraction` of a viewport that is
// `viewportWidth` px wide. Guards against a non-positive width (SSR / unmeasured).
export function isInRightFraction(clientX, viewportWidth, fraction = RIGHT_REVEAL_FRACTION) {
  if (!(viewportWidth > 0)) return false;
  return clientX >= viewportWidth * (1 - fraction);
}

// Attach the returned ref to a scroll container; `revealed` is true while the
// pointer is over that container AND within the rightmost `fraction` of the
// viewport. State only flips when the boolean actually changes, so a stream of
// pointermove events does not thrash React.
export function useRightEdgeReveal(fraction = RIGHT_REVEAL_FRACTION) {
  const ref = useRef(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return undefined;
    const onMove = (e) => {
      const next = isInRightFraction(e.clientX, window.innerWidth, fraction);
      setRevealed((prev) => (prev === next ? prev : next));
    };
    const onLeave = () => setRevealed(false);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [fraction]);
  return [ref, revealed];
}
