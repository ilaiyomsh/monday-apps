import { useEffect } from 'react';

/**
 * Dismiss a body-portal overlay on an outside mousedown or on Escape.
 *
 * The keydown listener is registered on the CAPTURE phase, exactly as the two
 * settings overlays did inline before they shared this hook.
 *
 * @param {boolean} open      while false nothing is listening
 * @param {Array<{ current: Node|null }>} refs  the nodes that count as "inside"
 * @param {() => void} onClose
 */
export function useDismissOnOutside(open, refs, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (refs.some((ref) => ref.current?.contains(event.target))) {
        return;
      }
      onClose();
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);
}
