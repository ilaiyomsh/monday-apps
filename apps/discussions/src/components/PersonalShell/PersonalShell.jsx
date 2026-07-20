import React from 'react';
import { ArrowLeft } from 'lucide-react';
import styles from './PersonalShell.module.css';

// round170 — "האזור האישי" (personal area): one shell hosting the three personal
// modes (my tasks / my decisions / dashboard), with a back action to the
// discussions area. The modes still map to App's existing `appView` values, so
// persistence/splash logic is unchanged — this component only owns the chrome; each
// view renders embedded below.
//
// round178 — reverted from the round174 left vertical rail back to the round173
// flush-LEFT horizontal switcher (owner request): the three modes as a segmented
// pill, then "חזרה לדיונים" folded in as a fourth segment (same style, left arrow).
// Order right→left: דשבורד · ההחלטות שלי · המשימות שלי · חזרה לדיונים ←.
//
// round179 — separation redesign (owner request): the switcher now floats on the
// grey backdrop (no card frame) and the active view sits in its own white card
// below (see PersonalShell.module.css). The JSX structure is unchanged — only the
// styling of .header (transparent) and .body (white card) moved.
const MODES = [
  { id: 'dashboard', label: 'דשבורד' },
  { id: 'myDecisions', label: 'ההחלטות שלי' },
  { id: 'myTasks', label: 'המשימות שלי' },
];

export function PersonalShell({ activeMode, onSelectMode, onBack, children }) {
  return (
    <div className={styles.shell} dir="rtl">
      <div className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="האזור האישי">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={activeMode === m.id}
              className={`${styles.tab} ${activeMode === m.id ? styles.tabActive : ''}`}
              onClick={() => onSelectMode(m.id)}
            >
              {m.label}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.tab} ${styles.tabBack}`}
            onClick={onBack}
            aria-label="חזרה לאזור הדיונים"
          >
            <span>חזרה לדיונים</span>
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}

export default PersonalShell;
