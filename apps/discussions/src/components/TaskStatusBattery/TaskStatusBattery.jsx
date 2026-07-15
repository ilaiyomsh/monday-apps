import React from 'react';
import { TASK_BUCKETS, BUCKET_META } from './taskBuckets.js';
import styles from './TaskStatusBattery.module.css';

/*
 * Round 81 — monday-battery-style quick filter: three colored count chips
 * (פתוחות / בוצעו / בעיכוב) shown top-right of the tasks views. Clicking a chip
 * toggles a one-click filter to that bucket; the active chip is highlighted.
 * Presentation-only — the parent owns `active` + `onPick(bucket|null)` and the
 * `counts` ({open, done, delayed}).
 */
export function TaskStatusBattery({ counts, active = null, onPick }) {
  const c = counts || { open: 0, done: 0, delayed: 0 };
  return (
    <div className={styles.battery} role="group" aria-label="סינון מהיר לפי סטטוס" dir="rtl">
      {TASK_BUCKETS.map((bucket) => {
        const meta = BUCKET_META[bucket];
        const isActive = active === bucket;
        return (
          <button
            key={bucket}
            type="button"
            className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
            aria-pressed={isActive}
            title={`הצג ${meta.label}`}
            onClick={() => onPick?.(isActive ? null : bucket)}
          >
            <span className={styles.dot} style={{ background: meta.color }} />
            <span className={styles.label}>{meta.label}</span>
            <span className={styles.count}>{c[bucket] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

export default TaskStatusBattery;
