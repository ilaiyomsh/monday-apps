import React from 'react';
import { ArrowRight } from 'lucide-react';
import styles from './PersonalShell.module.css';

// round170 — "האזור האישי" (personal area): one shell hosting the three personal
// modes (my tasks / my decisions / dashboard) behind a centered 3-tab switcher,
// with a back arrow (top-left) to the discussions area. Replaces the three
// separate top-level nav buttons in the discussions list. The modes still map to
// App's existing `appView` values, so persistence/splash logic is unchanged — this
// component only owns the chrome (back + tabs); each view renders embedded below.
const MODES = [
  { id: 'myTasks', label: 'המשימות שלי' },
  { id: 'myDecisions', label: 'ההחלטות שלי' },
  { id: 'dashboard', label: 'דשבורד' },
];

export function PersonalShell({ activeMode, onSelectMode, onBack, children }) {
  return (
    <div className={styles.shell} dir="rtl">
      <div className={styles.header}>
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
          aria-label="חזרה לאזור הדיונים"
        >
          <ArrowRight size={17} aria-hidden="true" />
          <span>חזרה לדיונים</span>
        </button>
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
        </div>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}

export default PersonalShell;
