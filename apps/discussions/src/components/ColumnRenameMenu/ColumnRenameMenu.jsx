import React, { useEffect, useRef, useState } from 'react';
import { Button, TextField } from '@vibe/core';
import { logger } from '@generated/utils/logger.js';
import styles from './ColumnRenameMenu.module.css';

/*
 * round140 — the owner-only "rename column" popover, opened from the
 * three-dot button that appears on header-cell hover. One instance per table;
 * fixed-positioned at the click point (same pattern as the group-color
 * palette). Enter saves, Escape/backdrop closes; an empty name (or the
 * default) resets the override — the caller's useColumnLabels handles that.
 */
export function ColumnRenameMenu({ position, currentName, defaultName, onSave, onClose }) {
  const [value, setValue] = useState(currentName || '');
  const cardRef = useRef(null);

  // Keep the card on-screen: clamp after first paint.
  const [pos, setPos] = useState(position);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - r.width - 8);
    const y = Math.min(position.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [position]);

  const save = (name) => {
    Promise.resolve(onSave(name)).catch((err) => {
      logger.error('UI', 'שמירת שם עמודה נכשלה', err);
    });
    onClose();
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={cardRef}
        className={styles.card}
        style={{ left: pos.x, top: pos.y }}
        dir="rtl"
        role="dialog"
        aria-label="שינוי שם עמודה"
      >
        <div className={styles.title}>שינוי שם עמודה</div>
        <TextField
          autoFocus
          value={value}
          placeholder={defaultName}
          onChange={(v) => setValue(v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(value); }
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className={styles.actions}>
          <Button size={"small"} kind={"primary"} onClick={() => save(value)}>שמירה</Button>
          <Button size={"small"} kind={"tertiary"} onClick={onClose}>ביטול</Button>
          {currentName !== defaultName && (
            <button type="button" className={styles.resetLink} onClick={() => save('')}>
              איפוס לברירת מחדל
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default ColumnRenameMenu;
