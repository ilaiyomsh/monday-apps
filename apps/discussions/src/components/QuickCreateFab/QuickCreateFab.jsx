import React from 'react';
import { Add } from '@vibe/icons';
import styles from './QuickCreateFab.module.css';

/**
 * Global quick-create floating action button — white plus in a 56px blue
 * circle, pinned to the bottom corner (same positioning conventions as
 * CreateTaskFab: explicit `right` because ancestors are dir="ltr").
 * Opens the QuickCreateModal (החלטה/משימה) on every tab.
 *
 * `compact` renders the ~33%-smaller, lower variant (see .fabCompact) — passed
 * only on the Previous-tasks (הנחיות קודמות) / Topics (נושאים) tabs; every other
 * tab keeps the full-size FAB.
 */
export function QuickCreateFab({ onClick, ariaLabel = 'יצירה מהירה', compact = false }) {
  return (
    <button
      type="button"
      className={compact ? `${styles.fab} ${styles.fabCompact}` : styles.fab}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <Add />
    </button>
  );
}

export default QuickCreateFab;
