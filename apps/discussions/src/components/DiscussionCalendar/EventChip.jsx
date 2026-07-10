import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, FileDown, Loader2, Pencil, Trash2 } from 'lucide-react';
import { fmtTimeLabel } from '@generated/utils/dateTime.js';
import styles from './EventChip.module.css';

const CARD_W = 220;
const OPEN_DELAY_MS = 180;
const CLOSE_DELAY_MS = 160;

/* Hover card: the discussion's FULL name first, then the same four actions as
   the list rows' kebab menu (edit / duplicate / export / delete with inline
   confirm). Portal-rendered (position:fixed) so it's never clipped by the
   calendar's scroll containers, and kept open while the cursor is over the
   chip OR the card itself. */
function HoverCard({ item, anchor, actions, onLeave, onEnter, onAction }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const openUp = anchor.bottom + 210 > window.innerHeight;
  const pos = {
    top: openUp ? undefined : anchor.bottom + 4,
    bottom: openUp ? window.innerHeight - anchor.top + 4 : undefined,
    left: Math.max(8, Math.min(anchor.right - CARD_W, window.innerWidth - CARD_W - 8)),
  };

  const run = (fn) => (e) => {
    e.stopPropagation();
    onAction();
    fn?.(item);
  };

  return createPortal(
    <div
      className={styles.calHoverCard}
      dir="rtl"
      role="menu"
      style={{ position: 'fixed', ...pos, width: CARD_W, zIndex: 10000 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.calHoverName}>{item.name}</div>
      {item.discussionDateID?.hasTime && (
        <div className={styles.calHoverTime}>{fmtTimeLabel(item.discussionDateID)}</div>
      )}
      <div className={styles.calHoverDivider} />
      {confirmDel ? (
        <div className={styles.calHoverConfirm}>
          <span className={styles.calHoverConfirmText}>למחוק את הדיון?</span>
          <div className={styles.calHoverConfirmActions}>
            <button type="button" className={`${styles.calHoverConfirmBtn} ${styles.calHoverConfirmYes}`} onClick={run(actions.onDelete)} role="menuitem">
              מחק
            </button>
            <button type="button" className={styles.calHoverConfirmBtn} onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }} role="menuitem">
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <>
          {actions.onEdit && (
            <button type="button" className={styles.calHoverItem} onClick={run(actions.onEdit)} role="menuitem">
              <Pencil className={styles.calHoverIcon} />
              <span>עריכה</span>
            </button>
          )}
          {actions.onDuplicate && (
            <button type="button" className={styles.calHoverItem} onClick={run(actions.onDuplicate)} role="menuitem">
              <Copy className={styles.calHoverIcon} />
              <span>שכפול</span>
            </button>
          )}
          {actions.onExport && (
            <button type="button" className={styles.calHoverItem} disabled={actions.exporting} onClick={run(actions.onExport)} role="menuitem">
              {actions.exporting ? (
                <Loader2 className={`${styles.calHoverIcon} ${styles.calHoverSpinning}`} />
              ) : (
                <FileDown className={styles.calHoverIcon} />
              )}
              <span>ייצוא</span>
            </button>
          )}
          {actions.onDelete && (
            <button
              type="button"
              className={`${styles.calHoverItem} ${styles.calHoverDanger}`}
              onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }}
              role="menuitem"
            >
              <Trash2 className={styles.calHoverIcon} />
              <span>מחיקה</span>
            </button>
          )}
        </>
      )}
    </div>,
    document.body
  );
}

/* One discussion chip on the calendar (month cell / all-day strip / hour grid).
   A real <button> so it's keyboard-reachable; clicks must not bubble into the
   surrounding day cell (which navigates to week view). Hovering opens the
   actions card; the card is a portal SIBLING (chips can't nest buttons). */
export function EventChip({ item, accent, selected, onClick, onContextMenu, variant = 'month', style, actions }) {
  const timeLabel = variant === 'month' ? fmtTimeLabel(item.discussionDateID) : '';
  const btnRef = useRef(null);
  const openTimer = useRef(null);
  const closeTimer = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const hasActions = !!(actions && (actions.onEdit || actions.onDuplicate || actions.onExport || actions.onDelete));

  const closeNow = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    setAnchor(null);
  };

  const onChipEnter = () => {
    if (!hasActions) return;
    clearTimeout(closeTimer.current);
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) setAnchor(rect);
    }, OPEN_DELAY_MS);
  };

  const scheduleClose = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setAnchor(null), CLOSE_DELAY_MS);
  };

  const cancelClose = () => clearTimeout(closeTimer.current);

  // The calendar scrolls under the fixed card — close instead of going stale.
  useEffect(() => {
    if (!anchor) return undefined;
    const close = () => closeNow();
    const onEsc = (e) => { if (e.key === 'Escape') closeNow(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onEsc);
    };
  }, [anchor]);

  useEffect(() => () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }, []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.calChip} ${variant === 'timed' ? styles.calChipTimed : ''} ${
          selected ? styles.calChipSelected : ''
        }`}
        style={{ ...style, '--cal-accent': accent }}
        onClick={(e) => {
          e.stopPropagation();
          closeNow();
          onClick?.(item);
        }}
        onContextMenu={onContextMenu ? (e) => { closeNow(); onContextMenu(item, e); } : undefined}
        onMouseEnter={onChipEnter}
        onMouseLeave={scheduleClose}
        aria-label={item.name}
        title={hasActions ? undefined : item.name}
      >
        {variant === 'timed' ? (
          <span className={styles.calChipTimedBody}>
            <span className={styles.calChipName}>{item.name}</span>
            <span className={styles.calChipTime}>{fmtTimeLabel(item.discussionDateID)}</span>
          </span>
        ) : (
          <>
            <span className={styles.calChipDot} aria-hidden="true" />
            {timeLabel && <span className={styles.calChipTime}>{timeLabel}</span>}
            <span className={styles.calChipName}>{item.name}</span>
          </>
        )}
      </button>
      {anchor && hasActions && (
        <HoverCard
          item={item}
          anchor={anchor}
          actions={actions}
          onEnter={cancelClose}
          onLeave={scheduleClose}
          onAction={closeNow}
        />
      )}
    </>
  );
}
