// SOURCE: ported from apps/discussions/src/components/StatusBadge/StatusBadge.jsx.
// A fixed-width pill so every status reads the same size regardless of text
// length. Purely presentational: the CALLER resolves a status label id to a
// display label + color (from the status column's typed settings labels/colors)
// and passes them in ג€” no hardcoded label list lives here.
import React from 'react';
import styles from './StatusChip.module.css';

const DEFAULT_COLOR = 'var(--secondary-text-color, #676879)';

export function StatusChip({ label, color, className = '' }) {
  const displayLabel = label || '׳׳׳ ׳¡׳˜׳׳˜׳•׳¡';
  const displayColor = label ? (color || DEFAULT_COLOR) : DEFAULT_COLOR;
  return (
    <span
      className={`${styles.chip} ${className}`.trim()}
      style={{ backgroundColor: displayColor }}
    >
      {displayLabel}
    </span>
  );
}

export default StatusChip;

