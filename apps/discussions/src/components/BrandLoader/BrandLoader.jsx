import React from 'react';
import styles from './BrandLoader.module.css';

// App mark — recreation of the monday app icon: a central "pizza" (a disc split
// into 8 slices) with three "person" figures (head + a shoulder arc that curves
// around the disc) at 120°. Colorized with the Twyst palette; the three people
// SLIDE clockwise to the next seat in a cool eased hop. viewBox 100, center (50,50).
export function BrandLoader({ fullscreen = false }) {
  return (
    <div
      className={fullscreen ? styles.brandLoaderFull : styles.brandLoader}
      role="status"
      aria-live="polite"
      aria-label="טוען"
    >
      <div className={styles.inner}>
        <svg className={styles.mark} viewBox="0 0 100 100" width="116" height="116" aria-hidden="true">
          <defs>
            <linearGradient id="twystLoaderGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6161FF" />
              <stop offset="50%" stopColor="#E271FF" />
              <stop offset="100%" stopColor="#FFA88D" />
            </linearGradient>
          </defs>
          <g className={styles.pizza}>
            <circle cx="50" cy="50" r="16" fill="url(#twystLoaderGrad)" fillOpacity="0.12" stroke="url(#twystLoaderGrad)" strokeWidth="2.5" />
            <g stroke="url(#twystLoaderGrad)" strokeWidth="2" strokeLinecap="round">
              <line x1="34" y1="50" x2="66" y2="50" />
              <line x1="50" y1="34" x2="50" y2="66" />
              <line x1="38.7" y1="38.7" x2="61.3" y2="61.3" />
              <line x1="38.7" y1="61.3" x2="61.3" y2="38.7" />
            </g>
          </g>
          <g className={styles.people}>
            <g>
              <circle cx="50" cy="14" r="7" fill="#6161FF" />
              <path d="M38 26 A13 13 0 0 1 62 26" fill="none" stroke="#6161FF" strokeWidth="6.5" strokeLinecap="round" />
            </g>
            <g transform="rotate(120 50 50)">
              <circle cx="50" cy="14" r="7" fill="#E271FF" />
              <path d="M38 26 A13 13 0 0 1 62 26" fill="none" stroke="#E271FF" strokeWidth="6.5" strokeLinecap="round" />
            </g>
            <g transform="rotate(240 50 50)">
              <circle cx="50" cy="14" r="7" fill="#FFA88D" />
              <path d="M38 26 A13 13 0 0 1 62 26" fill="none" stroke="#FFA88D" strokeWidth="6.5" strokeLinecap="round" />
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
