import { useEffect, useRef } from 'react';

export function useDebouncedEffect(fn: () => void, deps: unknown[], delayMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const handle = window.setTimeout(() => { fnRef.current(); }, delayMs);
    return () => { window.clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delayMs]);
}
