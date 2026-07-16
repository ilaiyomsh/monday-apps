import { useEffect, useRef } from 'react';

/*
 * round135 — the ESC-clears-selection behavior that was copy-pasted (byte-for-
 * byte, comment included) in SIX list views (Tasks / Previous / Decisions /
 * MyTasks / MyDecisions / Topics) now lives here once.
 *
 * Contract (unchanged from the inline copies):
 * - Listens on document ONLY while something is selected (hasSelection).
 * - No-ops unless THIS view is actually visible (rootRef.current.offsetParent
 *   is null when a tab is hidden behind another) — so it never clears a
 *   different tab's selection.
 * - ESC still closes an open editor/overlay first: bails when the event was
 *   already handled (defaultPrevented), when the user is typing in a text
 *   field (inline rename), or when a dialog / listbox / menu is open.
 *
 * `onClear` is kept in a ref so callers may pass a fresh closure every render
 * without re-binding the document listener.
 */
export function useEscToClearSelection(rootRef, hasSelection, onClear) {
  const clearRef = useRef(onClear);
  clearRef.current = onClear;

  useEffect(() => {
    if (!hasSelection) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!rootRef.current || rootRef.current.offsetParent === null) return;
      const el = e.target;
      const tag = el && el.tagName;
      const typing = tag === 'TEXTAREA' || (el && el.isContentEditable)
        || (tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset)$/.test(el.type || ''));
      if (typing) return;
      if (document.querySelector('[role="dialog"],[role="listbox"],[role="menu"]')) return;
      clearRef.current?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSelection]);
}

export default useEscToClearSelection;
