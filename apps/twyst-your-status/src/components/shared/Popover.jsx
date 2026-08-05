// SOURCE: generalized from the body-portal popover pattern in
// apps/discussions/src/components/PersonPicker/PersonPicker.jsx (the pattern
// that replaced Vibe Dialog/Combobox after they clipped, double-rendered, and
// dropped clicks inside board-view tables). Portaling to document.body means
// position:fixed coordinates are computed against the real viewport ג€” safe even
// when an ancestor has transform/filter/overflow:hidden, which would otherwise
// re-anchor fixed positioning (see references/rtl-css-checklist.md).
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { computeFloatingPosition } from '../../utils/overlayPlacement';
import styles from './Popover.module.css';

/**
 * Generic body-portal popover anchored to a trigger element.
 *
 * Usage:
 *   const anchorRef = useRef(null);
 *   <button ref={anchorRef} onClick={() => setOpen(true)}>...</button>
 *   <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
 *     ...menu content...
 *   </Popover>
 *
 * Props:
 * - anchorRef: ref to the trigger element (used for positioning + click-outside)
 * - open / onClose: controlled visibility
 * - preferred: 'bottom-start' | 'bottom-end' | 'bottom-center' | 'top-*' (default 'bottom-start')
 * - width / height: max popup size hints for the placement math
 * - matchAnchorWidth: stretch min-width to the anchor width (menus under fields)
 */
export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  preferred = 'bottom-start',
  width = 280,
  height = 320,
  matchAnchorWidth = false,
}) {
  const popoverRef = useRef(null);
  const [pos, setPos] = useState(null);

  const reposition = useCallback(() => {
    const rect = anchorRef?.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred,
      popupWidth: matchAnchorWidth ? Math.max(rect.width, width) : width,
      popupHeight: height,
      offset: 4,
    });
    if (!next) return;
    setPos({
      top: next.top,
      left: next.left,
      minWidth: matchAnchorWidth ? Math.max(rect.width, 0) : undefined,
    });
  }, [anchorRef, preferred, width, height, matchAnchorWidth]);

  // Position on open; keep following the anchor on scroll/resize (capture-phase
  // scroll listener catches scrolling containers, not just the window).
  //
  // Closing CLEARS the position. Keeping it meant the next open rendered one frame at
  // the PREVIOUS open's coordinates — reposition() is an effect, so it only corrects
  // after commit. That flash is a real "the menu opened somewhere else", and it is
  // worst where the anchor moves between opens: rows in the required-fields form shift
  // when a validation error or an error box mounts above them.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      role="dialog"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        minWidth: pos.minWidth,
        // A menu stretched to a wider anchor must not be capped back below it:
        // minWidth would win anyway and the declared max was silently dead.
        maxWidth: Math.max(width, pos.minWidth ?? 0),
        // The `height` prop is what the placement math reserved room for, so it has to
        // bound what actually renders too — otherwise the box is placed for 220px and
        // drawn at the stylesheet's 430px, overflowing the window it was fitted into.
        maxHeight: `min(${height}px, calc(100vh - 16px))`,
        zIndex: 10000,
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export default Popover;

