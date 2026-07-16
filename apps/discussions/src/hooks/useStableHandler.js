import { useCallback, useRef } from 'react';

/*
 * round136 (perf audit stage 3) — a stable-identity event handler ("useEvent"
 * pattern). Returns a function whose identity NEVER changes across renders but
 * always invokes the LATEST closure passed in. This is what lets the row
 * components stay React.memo-frozen while the tab-level apply* handlers keep
 * reading fresh state (selection Sets, loaded items) every call.
 *
 * Only for EVENT handlers — never call the returned function during render
 * (the ref is updated during render, so mid-render calls could see a torn value).
 */
export function useStableHandler(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current?.(...args), []);
}

export default useStableHandler;
