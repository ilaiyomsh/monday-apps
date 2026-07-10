import React from 'react';
import styles from './BrandLoader.module.css';

// Round-table brand mark: a central "table" ringed by 8 "seats" (people) that
// orbit the table, colored along the Twyst signature gradient
// (indigo #6161FF -> sky #97AEFF -> magenta #E271FF -> peach #FFA88D).
const SEATS = [
  { x: 110, y: 70, c: '#6161FF' },
  { x: 98.28, y: 41.72, c: '#8A8CFF' },
  { x: 70, y: 30, c: '#97AEFF' },
  { x: 41.72, y: 41.72, c: '#C293FF' },
  { x: 30, y: 70, c: '#E271FF' },
  { x: 41.72, y: 98.28, c: '#F284C4' },
  { x: 70, y: 110, c: '#FFA88D' },
  { x: 98.28, y: 98.28, c: '#FF9D9F' },
];

export function BrandLoader({ fullscreen = false }) {
  return (
    <div
      className={fullscreen ? styles.brandLoaderFull : styles.brandLoader}
      role="status"
      aria-live="polite"
      aria-label="טוען"
    >
      <div className={styles.inner}>
        <svg className={styles.mark} viewBox="0 0 140 140" width="108" height="108" aria-hidden="true">
          <defs>
            <linearGradient id="twystLoaderGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6161FF" />
              <stop offset="28%" stopColor="#97AEFF" />
              <stop offset="60%" stopColor="#E271FF" />
              <stop offset="100%" stopColor="#FFA88D" />
            </linearGradient>
          </defs>
          <circle className={styles.ring} cx="70" cy="70" r="40" />
          <circle className={styles.arc} cx="70" cy="70" r="54" pathLength="100" />
          <circle className={styles.table} cx="70" cy="70" r="17" />
          <g className={styles.seatGroup}>
            {SEATS.map((s, i) => (
              <circle key={i} className={styles.seat} cx={s.x} cy={s.y} r="8" style={{ fill: s.c, '--i': i }} />
            ))}
          </g>
        </svg>

        <div className={styles.textBlock}>
          <div className={styles.wordmark}>Meetings</div>
          <div className={styles.poweredBy}>Powered by twyst</div>
        </div>
      </div>
    </div>
  );
}

export default BrandLoader;
