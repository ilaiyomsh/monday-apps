import React, { useEffect, useRef, useState } from 'react';
import styles from './PartyProgress.module.css';

/* Fun, branded progress bar (items 6+8): a rounded track with an animated
   multi-color gradient fill in the app's palette. `value` is 0..1 for real
   progress (create-discussion / apply-template report actual step counts);
   null renders an indeterminate sweep.

   round127 — perceived motion from the instant the bar mounts (owner request):
   the bar used to sit at 0% until the FIRST network call returned. It now
   renders an internal `shown` value that (a) never trails a real tick downward
   within a run, (b) creeps slowly toward — never past — a ceiling just above
   the real value, so the user sees continuous movement even while a step is
   still in flight; a real tick snaps it forward. A ≥4% floor makes the very
   first paint visible. */
export function PartyProgress({ value = null, label = '' }) {
  const [shown, setShown] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (value == null) return undefined; // indeterminate — the CSS sweep animates
    const clamped = Math.max(0, Math.min(1, value));
    // Snap up to the real value; a big DROP (>0.5) means a new run started —
    // follow it down so a reused instance doesn't stay full.
    setShown((s) => (clamped < s - 0.5 ? clamped : Math.max(s, clamped)));
    const id = setInterval(() => {
      const v = valueRef.current;
      if (v == null) return;
      const real = Math.max(0, Math.min(1, v));
      if (real >= 1) return; // done — no creep past the finish
      const ceiling = Math.min(0.97, real + (1 - real) * 0.9);
      setShown((s) => Math.min(s + (ceiling - s) * 0.06, ceiling));
    }, 250);
    return () => clearInterval(id);
  }, [value]);

  const pct = value == null ? null : Math.max(4, Math.min(1, Math.max(shown, Math.min(1, value))) * 100);
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
