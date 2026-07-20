import React from 'react';
import { ArrowLeft } from 'lucide-react';
import styles from './PersonalShell.module.css';

// round170 — "האזור האישי" (personal area): one shell hosting the three personal
// modes (my tasks / my decisions / dashboard) behind a segmented switcher, with a
// back action to the discussions area. Replaces the three separate top-level nav
// buttons in the discussions list. The modes still map to App's existing `appView`
// values, so persistence/splash logic is unchanged — this component only owns the
// chrome (tabs + back); each view renders embedded below.
//
// round173 — order (right→left in RTL): דשבורד · ההחלטות שלי · המשימות שלי, then the
// back control folded in as a FOURTH segment of the SAME switcher (identical style,
// a left arrow) — not a separate button.
const MODES = [
  { id: 'dashboard', label: 'דשבורד' },
  { id: 'myDecisions', label: 'ההחלטות שלי' },
  { id: 'myTasks', label: 'המשימות שלי' },
];

export function PersonalShell({ activeMode, onSelectMode, onBack, children }) {
  return (
    <div className={styles.shell} dir="rtl">
      {/* Flush-LEFT segmented switcher: the three modes, then "חזרה לדיונים" as the
          leftmost segment in the same pill — same design, with a left arrow. */}
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
