import React from 'react';
import { ArrowLeft, Gavel, LayoutDashboard, ListChecks } from 'lucide-react';
import styles from './PersonalShell.module.css';

// round170 — "האזור האישי" (personal area): one shell hosting the three personal
// modes (my tasks / my decisions / dashboard), with a back action to the
// discussions area. The modes still map to App's existing `appView` values, so
// persistence/splash logic is unchanged — this component only owns the chrome; each
// view renders embedded beside it.
//
// round174 — the mode switcher moved from a top bar to a LEFT vertical rail (owner
// request): "חזרה לדיונים" at the rail top, then the three modes stacked below.
// This frees the whole top of the screen so each embedded view shows only its own
// (single) toolbar, instead of two stacked, left-crowded bars.
const MODES = [
  { id: 'myTasks', label: 'המשימות שלי', Icon: ListChecks },
  { id: 'myDecisions', label: 'ההחלטות שלי', Icon: Gavel },
  { id: 'dashboard', label: 'דשבורד', Icon: LayoutDashboard },
];

export function PersonalShell({ activeMode, onSelectMode, onBack, children }) {
  return (
    <div className={styles.shell}>
      {/* LEFT vertical rail: back at the top, then the 3-mode switcher. */}
      <nav className={styles.rail} aria-label="האזור האישי">
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
          aria-label="חזרה לאזור הדיונים"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span className={styles.label}>חזרה לדיונים</span>
        </button>
        <div className={styles.sep} />
        <div className={styles.tabs} role="tablist" aria-orientation="vertical">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeMode === id}
              className={`${styles.item} ${activeMode === id ? styles.itemActive : ''}`}
              onClick={() => onSelectMode(id)}
            >
              <Icon size={18} aria-hidden="true" className={styles.itemIcon} />
              <span className={styles.label}>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className={styles.main}>{children}</div>
    </div>
  );
}

export default PersonalShell;
