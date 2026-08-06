import { useEffect } from 'react';
import { dismissBootLoader } from '../utils/bootLoader';

/**
 * Release the boot overlay (index.html) as soon as the caller stops holding it.
 * Each surface keeps its OWN predicate and its own reason for holding — see the
 * comment at every call site; this hook only owns the dismissal.
 *
 * @param {boolean} held true while this surface still has nothing real to show
 */
export function useBootLoaderRelease(held) {
  useEffect(() => {
    if (!held) dismissBootLoader();
  }, [held]);
}
