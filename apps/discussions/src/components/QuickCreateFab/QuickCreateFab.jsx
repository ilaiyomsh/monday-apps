import React from 'react';
import { Add } from '@vibe/icons';
import styles from './QuickCreateFab.module.css';

/**
 * Global quick-create floating action button — white plus in a 56px blue
 * circle, pinned to the bottom corner (same positioning conventions as
 * CreateTaskFab: explicit `right` because ancestors are dir="ltr").
 * Opens the QuickCreateModal (החלטה/משימה) on every tab.
 */
export function QuickCreateFab({ onClick, ariaLabel = 'יצירה מהירה' }) {
  return (
    <button type="button" className={styles.fab} onClick={onClick} aria-label={ariaLabel}>
      <Add />
    </button>
  );
}

export default QuickCreateFab;
