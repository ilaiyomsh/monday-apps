import React from 'react';
import styles from './StatusBadge.module.css';

// A fixed-width pill so every status reads the same size regardless of its text
// length. Status values are stable label ids, so the CALLER resolves the id to a
// display label + color (via useStatusOptions) and passes them in — this stays a
// pure presentational component with no hardcoded label list.
export function StatusBadge({ label, color, className = '' }) {
  const displayLabel = label || 'ללא סטאטוס';
  const displayColor = label ? (color || 'hsl(var(--status-default))') : 'hsl(var(--status-default))';
  return (
    <span
      className={`${styles.badge} ${className}`.trim()}
      style={{ backgroundColor: displayColor }}
    >
      {displayLabel}
    </span>
  );
}

export default StatusBadge;
