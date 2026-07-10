import React from 'react';
import styles from './BrandLoader.module.css';

// App mark — an exact recreation of the monday app icon: a central ring with
// three "person" figures (head + shoulders) arranged at 120° around it, each
// facing the center. Colorized with the Twyst palette; the three people step
// CLOCKWISE in discrete jumps around the ring. viewBox 100, center (50,50).
export function BrandLoader({ fullscreen = false }) {
  return (
    <div
      className={fullscreen ? styles.brandLoaderFull : styles.brandLoader}
      role="status"
      aria-live="polite"
      aria-label="טוען"
    >
      <div className={styles.inner}>
        <svg className={styles.mark} viewBox="0 0 100 100" width="112" height="112" aria-hidden="true">
          <defs>
            <linearGradient id="twystLoaderGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6161FF" />
              <stop offset="50%" stopColor="#E271FF" />
              <stop offset="100%" stopColor="#FFA88D" />
            </linearGradient>
          </defs>
          <circle className={styles.ring} cx="50" cy="50" r="13" />
          <g className={styles.people}>
            <g>
              <circle cx="50" cy="15" r="7" fill="#6161FF" />
              <path d="M39 34 A12 12 0 0 0 61 34" fill="none" stroke="#6161FF" strokeWidth="6.5" strokeLinecap="round" />
            </g>
            <g transform="rotate(120 50 50)">
              <circle cx="50" cy="15" r="7" fill="#E271FF" />
              <path d="M39 34 A12 12 0 0 0 61 34" fill="none" stroke="#E271FF" strokeWidth="6.5" strokeLinecap="round" />
            </g>
            <g transform="rotate(240 50 50)">
              <circle cx="50" cy="15" r="7" fill="#FFA88D" />
              <path d="M39 34 A12 12 0 0 0 61 34" fill="none" stroke="#FFA88D" strokeWidth="6.5" strokeLinecap="round" />
            </g>
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
