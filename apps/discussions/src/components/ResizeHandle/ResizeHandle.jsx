import React from 'react';
import styles from './ResizeHandle.module.css';

/*
 * A thin (6px) column-resize grip, absolutely positioned on the trailing edge of
 * a header cell (inset-inline-end). The parent cell must be a positioning context
 * (position: sticky/relative). Mouse-only — render it only for owners on
 * non-touch viewports (gated by the caller). `onMouseDown` should call the
 * table's startResize(key, e).
 */
export function ResizeHandle({ onMouseDown, ariaLabel = 'שנה רוחב עמודה' }) {
  return (
    <span
      className={styles.handle}
      onMouseDown={onMouseDown}
      // Stop the pointerdown from reaching a column-reorder drag sensor on the
      // header cell — resizing the edge must never start a column move.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
    />
  );
}

export default ResizeHandle;
