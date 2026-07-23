import React, { useEffect } from 'react';
import styles from './PointItemsPopup.module.css';

/**
 * Counter popup — lists the NAMES of the decisions/tasks linked to one topic
 * POINT (mockup: "COUNTER POPUP", 560px modal). READ-ONLY and NAMES-ONLY per
 * spec: no status/priority/other columns are shown — just each item's name.
 * `items` are the already-loaded decision/task objects resolved by TopicsTab
 * from the discussion's lists (no new queries here), so the list reflects
 * exactly the items that PERSIST and reload with the discussion.
 *
 * Props: { open, kind: 'decision'|'task', point, items, onClose }
 */
export function PointItemsPopup({ open, kind, point, items = [], onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isDecision = kind === 'decision';
  // round226 — the unified תוצרים popup lists the point's tasks AND decisions,
  // each row tagged by its kind (item._outKind).
  const isOutputs = kind === 'outputs';
  const title = isOutputs ? 'תוצרים מהנקודה' : isDecision ? 'החלטות מהנקודה' : 'משימות מהנקודה';

  return (
    <div className={styles.overlay} onClick={() => onClose?.()} dir="rtl">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.title}>{title}</div>
            <div className={styles.subtitle}>{point?.name || ''}</div>
          </div>
          <button type="button" className={styles.close} aria-label="סגור" onClick={() => onClose?.()}>
            ×
          </button>
        </div>
        <div className={styles.body}>
          {/* NAMES ONLY — the leading bar is fixed decision/task chrome (a color
              marker), not item data. */}
          {items.map((item) => {
            const rowIsDecision = isOutputs ? item._outKind === 'decision' : isDecision;
            return (
              <div key={`${item._outKind || kind}-${item.id}`} className={styles.item}>
                <span className={`${styles.bar} ${rowIsDecision ? styles.barDecision : styles.barTask}`} aria-hidden="true" />
                <span className={styles.text}>{item.name}</span>
                {isOutputs && (
                  <span className={styles.kindTag}>{rowIsDecision ? 'החלטה' : 'משימה'}</span>
                )}
              </div>
            );
          })}
          {items.length === 0 && (
            <div className={styles.empty}>אין פריטים עדיין — צור חדש עם כפתור ה־+</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PointItemsPopup;
