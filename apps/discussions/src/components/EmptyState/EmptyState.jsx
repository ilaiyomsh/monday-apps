import React from 'react';
import styles from './EmptyState.module.css';

/**
 * EmptyState — the single, consistent "empty / not-found" message for every
 * main content VIEW in the app (tasks/decisions/topics/discussions lists, the
 * dashboard cards, etc.). It centers its message both horizontally and
 * vertically inside the available space and renders it at a large, readable
 * size (~2× the old inline empty text). RTL-first, theme-aware via @vibe tokens.
 *
 * Props:
 * - children:   the message text (keep the existing Hebrew strings).
 * - className:  optional extra class, appended for parent-specific tweaks.
 * - icon:       optional node rendered above the message (ignored if absent).
 * - bleedStart: when the parent view has an inline-start gutter (e.g. the ~52px
 *               white gutter under the Previous-tasks tab), offset it so the box
 *               centers across the FULL view width, not just the inset area.
 */
function EmptyState({ children, className, icon, bleedStart = false }) {
  const classes = [
    styles.emptyStateRoot,
    bleedStart ? styles.emptyStateBleedStart : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="status">
      {icon ? <div className={styles.emptyStateIcon}>{icon}</div> : null}
      <div className={styles.emptyStateText}>{children}</div>
    </div>
  );
}

export default EmptyState;
