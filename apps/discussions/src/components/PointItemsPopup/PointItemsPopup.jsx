import React, { useEffect } from 'react';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import styles from './PointItemsPopup.module.css';

// Neutral badge fill when the item has no status label (mirrors monday's
// empty-status gray; chrome color, not board data).
const NEUTRAL_BADGE = '#c4c4c4';

/**
 * Counter popup — the decisions/tasks linked to one topic POINT (mockup:
 * "COUNTER POPUP", 560px modal). READ-ONLY: `items` are the already-loaded
 * decision/task objects resolved by TopicsTab from the discussion's lists (no
 * new queries here). Status badge label + color come from the item's MAPPED
 * status column via useStatusOptions — never hardcoded.
 *
 * Props: { open, kind: 'decision'|'task', point, items, onClose }
 */
export function PointItemsPopup({ open, kind, point, items = [], onClose }) {
  // Both hooks run unconditionally (rules of hooks); each resolves to an empty
  // map when its board/column is unmapped, so this is always safe.
  const decisionOpts = useStatusOptions('decisions', 'decisionStatusID');
  const taskOpts = useStatusOptions('tasks', 'statusID');

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isDecision = kind === 'decision';
  const { labelById, colorById } = isDecision ? decisionOpts : taskOpts;
  const title = isDecision ? 'החלטות מהנקודה' : 'משימות מהנקודה';

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
          {items.map((item) => {
            const statusId = isDecision ? item.decisionStatusID : item.statusID;
            const hasStatus = statusId != null && labelById?.[statusId] != null;
            return (
              <div key={item.id} className={styles.item}>
                <span className={`${styles.bar} ${isDecision ? styles.barDecision : styles.barTask}`} aria-hidden="true" />
                <span className={styles.text}>{item.name}</span>
                <span
                  className={styles.badge}
                  style={{ background: hasStatus ? (colorById?.[statusId] || NEUTRAL_BADGE) : NEUTRAL_BADGE }}
                >
                  {hasStatus ? labelById[statusId] : 'ללא סטאטוס'}
                </span>
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
