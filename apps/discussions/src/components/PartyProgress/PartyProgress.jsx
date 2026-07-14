import React from 'react';
import styles from './PartyProgress.module.css';

/* Fun, branded progress bar (items 6+8): a rounded track with an animated
   multi-color gradient fill in the app's palette. `value` is 0..1 for real
   progress (create-discussion / apply-template report actual step counts);
   null renders an indeterminate sweep. */
export function PartyProgress({ value = null, label = '' }) {
  const pct = value == null ? null : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={styles.wrap} dir="rtl">
      {label ? <span className={styles.label}>{label}</span> : null}
      <div
        className={styles.track}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct == null ? undefined : Math.round(pct)}
        aria-label={label || 'התקדמות'}
      >
        <div
          className={pct == null ? `${styles.fill} ${styles.indeterminate}` : styles.fill}
          style={pct == null ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default PartyProgress;
