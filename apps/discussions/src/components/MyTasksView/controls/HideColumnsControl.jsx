import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EyeOff } from 'lucide-react';
import { Checkbox } from '@vibe/core';
import { BuilderIcon } from './BuilderIcon.jsx';
import bs from './builder.module.css';
import styles from './hideColumns.module.css';

/*
 * "Display columns" (Hide) control — a monday-style column show/hide popover for
 * the My Tasks / My Decisions toolbars. The pill matches the Sort/Filter/Group
 * builder pills (bs.bPill); the panel is a PORTAL (position:fixed, z-index 10000
 * per the app popover convention) so it is never clipped, closing on outside
 * click / Esc / scroll / resize (mirrors the FilterSelect / RowMenu pattern).
 *
 * Props:
 *  - columns: ordered [{ key, label, icon, locked? }]. `locked` (the primary
 *    name column) renders checked + disabled and can never be hidden.
 *  - hidden: Set of currently-hidden column keys (applied live).
 *  - onToggle(key): flip one column's visibility.
 *  - onToggleAll(show): show (true) / hide (false) every hideable column.
 *  - onSave(): persist the current selection to the shared saved view (owners);
 *    null hides the "Save to this view" button.
 *  - label: pill label (default "Hide").
 *
 * Owner-gating lives at the CALL SITE — the pill only renders for owners.
 */
const PANEL_W = 320;

export function HideColumnsControl({ columns, hidden, onToggle, onToggleAll, onSave, label = 'הסתר' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const hideable = useMemo(() => columns.filter((c) => !c.locked), [columns]);
  const hiddenCount = hideable.reduce((n, c) => n + (hidden.has(c.key) ? 1 : 0), 0);
  const anyHidden = hiddenCount > 0;
  const allShown = hiddenCount === 0;
  const someHidden = anyHidden && hiddenCount < hideable.length;
  // "N selected" counts every SHOWN column, including the always-on name column.
  const shownCount = columns.length - hiddenCount;

  const visibleRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return columns;
    return columns.filter((c) => (c.label || '').toLowerCase().includes(term));
  }, [columns, q]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    const reposition = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  // Clamp inside the viewport once the panel has a measured size (so opening near
  // a screen edge never pushes it off-screen).
  useLayoutEffect(() => {
    if (!open || !pos || !panelRef.current) return;
    const r = panelRef.current.getBoundingClientRect();
    const top = Math.max(8, Math.min(pos.top, window.innerHeight - r.height - 8));
    const left = Math.max(8, Math.min(pos.left, window.innerWidth - r.width - 8));
    if (top !== pos.top || left !== pos.left) setPos({ top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos?.top, pos?.left]);

  const toggleOpen = () => {
    if (open) { setOpen(false); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, left: rect.left });
    setQ('');
    setOpen(true);
  };

  const pillClass = `${bs.bPill}${anyHidden ? ` ${bs.bPillApplied}` : ''}${open ? ` ${bs.bPillOpen}` : ''}`;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={pillClass}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
      >
        <EyeOff className={bs.bPillIcon} aria-hidden="true" />
        <span>{label}</span>
        {anyHidden ? <span className={bs.bPillCount}>/ {hiddenCount}</span> : null}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className={styles.hcPanel}
          role="dialog"
          aria-label="Display columns"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_W, zIndex: 10000 }}
        >
          <div className={styles.hcHead}>
            <span className={styles.hcTitle}>Display columns</span>
            {onSave ? (
              <button type="button" className={styles.hcSave} onClick={() => { onSave(); setOpen(false); }}>
                Save to this view
              </button>
            ) : null}
          </div>

          <div className={styles.hcSearchRow}>
            <input
              type="text"
              className={styles.hcSearch}
              value={q}
              placeholder="Find columns to show/hide"
              aria-label="Find columns to show/hide"
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className={`${styles.hcRow} ${styles.hcMasterRow}`}>
            <Checkbox
              checked={allShown}
              indeterminate={someHidden}
              onChange={(e) => onToggleAll(e.target.checked)}
              ariaLabel="All columns"
            />
            <span className={styles.hcMasterLabel}>All columns — {shownCount} selected</span>
          </div>

          <div className={styles.hcList}>
            {visibleRows.map((c) => {
              const isShown = !hidden.has(c.key);
              return (
                <div key={c.key} className={`${styles.hcRow}${c.locked ? ` ${styles.hcRowLocked}` : ''}`}>
                  <Checkbox
                    checked={isShown}
                    disabled={c.locked}
                    onChange={() => onToggle(c.key)}
                    ariaLabel={c.label}
                  />
                  <button
                    type="button"
                    className={styles.hcRowMain}
                    disabled={c.locked}
                    onClick={() => onToggle(c.key)}
                  >
                    <BuilderIcon name={c.icon} className={styles.hcIcon} />
                    <span className={styles.hcLabel}>{c.label}</span>
                  </button>
                </div>
              );
            })}
            {visibleRows.length === 0 ? <div className={styles.hcEmpty}>No columns found</div> : null}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default HideColumnsControl;
