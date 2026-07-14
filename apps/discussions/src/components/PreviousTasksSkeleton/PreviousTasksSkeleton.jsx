import React from 'react';
import styles from './PreviousTasksSkeleton.module.css';

// monday-style skeleton table loader for the "הנחיות קודמות" tab. Light-gray
// rounded placeholder bars on white with a subtle shimmer sweep — an optional
// toolbar row (a wide lead pill + two action pills), a header row of ~9 short
// column-cell placeholders, then ~9 body rows. Each body row is a short label
// placeholder (varying widths) + a longer content bar at a staggered horizontal
// offset/width, evoking a real board mid-load. Geometry is DETERMINISTIC (fixed
// arrays, no randomness) so it's stable across renders. Reduced-motion freezes
// the shimmer via CSS.

// ~9 short header column-cell widths (px).
const HEADER_CELLS = [64, 96, 72, 84, 60, 100, 76, 88, 68];

// Per body row: label width, content-bar horizontal offset, content-bar width (px).
const ROWS = [
  { label: 54, offset: 0, bar: 240 },
  { label: 72, offset: 40, bar: 190 },
  { label: 48, offset: 12, bar: 280 },
  { label: 90, offset: 96, bar: 150 },
  { label: 60, offset: 24, bar: 220 },
  { label: 44, offset: 150, bar: 130 },
  { label: 82, offset: 8, bar: 260 },
  { label: 52, offset: 64, bar: 200 },
  { label: 68, offset: 32, bar: 176 },
];

export function PreviousTasksSkeleton({ showToolbar = true }) {
  return (
    <div className={styles.ptSkeleton} role="status" aria-live="polite" aria-label="טוען משימות">
      {showToolbar && (
        <div className={styles.ptToolbar}>
          <div className={`${styles.ptBar} ${styles.ptToolbarLead}`} />
          <div className={styles.ptToolbarActions}>
            <div className={`${styles.ptBar} ${styles.ptToolbarPill}`} />
            <div className={`${styles.ptBar} ${styles.ptToolbarPill}`} />
          </div>
        </div>
      )}

      <div className={styles.ptHeaderRow}>
        {HEADER_CELLS.map((w, i) => (
          <div key={i} className={`${styles.ptBar} ${styles.ptHeaderCell}`} style={{ width: w }} />
        ))}
      </div>

      <div className={styles.ptBody}>
        {ROWS.map((r, i) => (
          <div key={i} className={styles.ptRow}>
            <div className={`${styles.ptBar} ${styles.ptRowLabel}`} style={{ width: r.label }} />
            <div className={styles.ptRowContent}>
              <div
                className={`${styles.ptBar} ${styles.ptRowBar}`}
                style={{ width: r.bar, marginInlineStart: r.offset }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PreviousTasksSkeleton;
