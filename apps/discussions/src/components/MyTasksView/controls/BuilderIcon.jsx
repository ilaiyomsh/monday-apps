import React from 'react';

/*
 * Monochrome icon set for the My Tasks builder segments. Every glyph uses
 * `currentColor` so the consumer controls the color (grey for column/option
 * icons, blue for the active check) — NO baked-in green/blue/red, per the
 * "uniform, colorless icons" requirement.
 *
 * Names: column types (status | date | text | relation), direction/order
 * (up | down | alphaAsc | alphaDesc | calUp | calDown), deadline ranges
 * (calToday | calWeek | calMonth | clock), and chrome (chev | check).
 */
const P = {
  chev: <path d="M5 7.5 10 12l5-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  back: <path d="M12 5l-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
  x: <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
  check: <path d="M4 10.5 8 14l8-8.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
  status: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.5 8.5h7M6.5 12h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  date: (
    <>
      <rect x="3" y="4.5" width="14" height="12" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  text: <path d="M5 6h10M5 10h10M5 14h6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />,
  person: (
    <>
      <circle cx="10" cy="7" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 16c0-3 2.6-4.7 5.5-4.7s5.5 1.7 5.5 4.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  relation: (
    <path d="M8 12a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1M12 8a3 3 0 0 0-4 0l-2 2a3 3 0 0 0 4 4l1-1"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  up: <path d="M10 16V4M10 4 6 8M10 4l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  down: <path d="M10 4v12M10 16l-4-4M10 16l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  alphaAsc: (
    <>
      <text x="1" y="9" fontSize="8.5" fontWeight="600" fill="currentColor">A</text>
      <text x="1" y="18" fontSize="8.5" fontWeight="600" fill="currentColor">Z</text>
      <path d="M17 5v9M17 14l-2-2M17 14l2-2" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  alphaDesc: (
    <>
      <text x="1" y="9" fontSize="8.5" fontWeight="600" fill="currentColor">Z</text>
      <text x="1" y="18" fontSize="8.5" fontWeight="600" fill="currentColor">A</text>
      <path d="M17 5v9M17 14l-2-2M17 14l2-2" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  calUp: (
    <>
      <rect x="2" y="4.8" width="11" height="10.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 8h11M5.5 3.2v3M9.5 3.2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M18 14V6M18 6l-2 2M18 6l2 2" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  calDown: (
    <>
      <rect x="2" y="4.8" width="11" height="10.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 8h11M5.5 3.2v3M9.5 3.2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M18 6v8M18 14l-2-2M18 14l2-2" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  calToday: (
    <>
      <rect x="3" y="4.5" width="14" height="12" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="12" r="1.7" fill="currentColor" />
    </>
  ),
  calWeek: (
    <>
      <rect x="3" y="4.5" width="14" height="12" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="5" y="10.4" width="10" height="2.6" rx="1.1" fill="currentColor" opacity="0.5" />
    </>
  ),
  calMonth: (
    <>
      <rect x="3" y="4.5" width="14" height="12" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 8h14M7 3v3M13 3v3M3 12h14M9 8v8M13 8v8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 8v3.2l2 1.4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

export function BuilderIcon({ name, className, size = 16 }) {
  const body = P[name];
  if (!body) return null;
  // Wider glyphs (A/Z + arrow, calendar + arrow) use a 22-wide viewBox.
  const wide = name === 'alphaAsc' || name === 'alphaDesc' || name === 'calUp' || name === 'calDown';
  return (
    <svg
      className={className}
      viewBox={wide ? '0 0 22 20' : '0 0 20 20'}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  );
}

export default BuilderIcon;
