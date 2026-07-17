import React from 'react';
import { Text } from '@vibe/core';
import { CloseSmall } from '@vibe/icons';
import styles from './SelectionActionBar.module.css';

/**
 * Floating bulk-selection bar shared by every multi-select surface
 * (TasksTab, PreviousTasksTab, DecisionsTab, MyTasksView, MyDecisionsView).
 * Fixed to the bottom-center of the viewport: left = selected count,
 * center = the view's own action buttons (children), right = clear-X.
 * Renders nothing while the selection is empty, so call sites don't need
 * their own `size > 0` guard.
 */
export default function SelectionActionBar({ count, onClear, ariaLabel, children }) {
  if (!count) return null;
  return (
    <div className={styles.actionBar} role="region" aria-label={ariaLabel}>
      <div className={styles.actionBarLeft}>
        <Text type={"text2"} element="span">{count} נבחרו</Text>
      </div>
      <div className={styles.actionBarCenter}>{children}</div>
      <div className={styles.actionBarRight}>
        <button type="button" className={styles.closeSelectionBtn} onClick={onClear} aria-label="בטל בחירה">
          <CloseSmall size={18} />
        </button>
      </div>
    </div>
  );
}

export { SelectionActionBar };
