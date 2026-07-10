import React from 'react';
import styles from './BrandLoader.module.css';

// App mark, matching the monday app icon: a central hub with 3 connected nodes.
// Colorized with the Twyst gradient; the 3 nodes step clockwise in discrete
// jumps (steps), landing on the next spoke end each beat. viewBox 96, center
// (48,48), nodes at radius 34 (top, bottom-right, bottom-left).
export function BrandLoader({ fullscreen = false }) {
  return (
    <div
      className={fullscreen ? styles.brandLoaderFull : styles.brandLoader}
      role="status"
      aria-live="polite"
      aria-label="טוען"
    >
      <div className={styles.inner}>
        <svg className={styles.mark} viewBox="0 0 96 96" width="104" height="104" aria-hidden="true">
          <defs>
            <linearGradient id="twystLoaderGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6161FF" />
              <stop offset="50%" stopColor="#E271FF" />
              <stop offset="100%" stopColor="#FFA88D" />
            </linearGradient>
          </defs>
          <g className={styles.spokes}>
            <line x1="48" y1="48" x2="48" y2="14" />
            <line x1="48" y1="48" x2="77.4" y2="65" />
            <line x1="48" y1="48" x2="18.6" y2="65" />
          </g>
          <circle className={styles.hub} cx="48" cy="48" r="10" />
          <g className={styles.nodeGroup}>
            <circle className={styles.node} cx="48" cy="14" r="9" style={{ fill: '#6161FF' }} />
            <circle className={styles.node} cx="77.4" cy="65" r="9" style={{ fill: '#E271FF' }} />
            <circle className={styles.node} cx="18.6" cy="65" r="9" style={{ fill: '#FFA88D' }} />
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
