import React, { useContext } from 'react';
import { SettingsContext } from '../../contexts/SettingsContext.jsx';
import styles from './BrandLoader.module.css';

// round307 — the ROULETTE spin, tuned by the owner on the interactive mockup.
// Kept here (not buried in the stylesheet) because these three numbers ARE the
// design decision, and the stylesheet consumes them as custom properties:
//   cycleMs      — one throw, start to rest.
//   sweepDeg     — how far a throw travels. A multiple of 120° on purpose: the
//                  three figures sit 120° apart, so every throw lands one of them
//                  back on a "seat" instead of stopping mid-gap. 1200° = 3⅓ turns.
//   easing       — fast start, monotonic slow-down, NO dwell anywhere. Encodes a
//                  0.82 deceleration depth: it keeps 18% of its speed at the end
//                  (final slope 0.072/0.4), so the next throw picks up smoothly
//                  instead of jumping from a dead stop.
export const SPIN = {
  cycleMs: 4200,
  sweepDeg: 1200,
  easing: 'cubic-bezier(0.2, 0.528, 0.6, 0.928)',
};

// App mark — recreation of the monday app icon: a central SOLID gradient disc
// (round307 removed the 8 white radial cuts that made it read as a pizza) with a
// gradient outline ring, plus three "person" figures (head + shoulder arc curving
// around the disc) at 120°. Colorized with the Twyst palette; the three people
// orbit the disc as one continuous roulette throw. viewBox 100.
//
// `logoUrl` — the owner's logo for THIS instance, shown ABOVE the mark. It comes
// from settings.preferences.logoUrl, which is per-instance storage, so every
// discussions view can carry its own. Read straight off the context (not through
// useSettings) so rendering the loader outside a provider stays silent — it is a
// presentational component and a missing logo is simply "no logo". The prop wins
// when passed, which is what the tests and the settings preview use.
export function BrandLoader({ fullscreen = false, logoUrl = undefined }) {
  const ctx = useContext(SettingsContext);
  const logo = logoUrl !== undefined ? logoUrl : (ctx?.settings?.preferences?.logoUrl || null);

  return (
    <div
      className={fullscreen ? styles.brandLoaderFull : styles.brandLoader}
      role="status"
      aria-live="polite"
      aria-label="טוען"
    >
      <div className={styles.inner}>
        {logo ? <img className={styles.logo} src={logo} alt="" /> : null}
        <svg
          className={styles.mark}
          viewBox="0 0 100 100"
          width="116"
          height="116"
          aria-hidden="true"
          style={{
            '--bl-spin-cycle': `${SPIN.cycleMs}ms`,
            '--bl-spin-sweep': `${SPIN.sweepDeg}deg`,
            '--bl-spin-ease': SPIN.easing,
          }}
        >
          <defs>
            <linearGradient id="twystLoaderGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6161FF" />
              <stop offset="50%" stopColor="#E271FF" />
              <stop offset="100%" stopColor="#FFA88D" />
            </linearGradient>
          </defs>
          <g className={styles.pizza}>
            {/* Solid gradient disc — no cuts. */}
            <circle cx="50" cy="50" r="16" fill="url(#twystLoaderGrad)" fillOpacity="0.92" />
            {/* Gradient outline ring on TOP — a clean, crisp edge. */}
            <circle cx="50" cy="50" r="16" fill="none" stroke="url(#twystLoaderGrad)" strokeWidth="2.5" />
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
