import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { externalInitials } from '@generated/utils/externalParticipants.js';
import styles from './ExternalPeople.module.css';

const POPOVER_W = 240;

// round217 — a stable accent color per external name (a deterministic hue), so
// the initials circle always has a solid colored background instead of the
// near-white Vibe text-avatar that got "swallowed" on the white header.
const EXT_COLORS = ['#0073ea', '#00854d', '#a25ddc', '#e2445c', '#fdab3d', '#037f4c', '#5559df', '#ff642e'];
function extColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return EXT_COLORS[h % EXT_COLORS.length];
}

/*
 * round211 — EXTERNAL participants (text-only names, not monday users) rendered
 * in the SAME visual language as the regular participant avatars: an
 * initials-circle per name whose full name shows on hover (native title, like
 * PersonAvatar). With `canEdit` (discussion creator/lead/coordinator + board
 * owner) a small "+" chip opens an inline editor popover: add a name (Enter /
 * הוסף) or remove one (✕). `onChange(names)` receives the full updated list.
 */
export function ExternalPeople({ names = [], canEdit = false, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // round220 — the popover is a PORTAL (position:fixed) so the discussion
  // header's overflow can't clip it (owner-reported: it got cut off). Position
  // is measured from the "+" trigger and clamped to the viewport.
  const addBtnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  const openEditor = () => {
    const rect = addBtnRef.current?.getBoundingClientRect();
    if (rect) {
      // Align the popover's inline-start (RTL: right edge) under the trigger.
      setPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - POPOVER_W) });
    }
    setOpen((o) => !o);
  };

  // Clamp inside the viewport once measured (so opening near an edge never
  // pushes it off-screen).
  useLayoutEffect(() => {
    if (!open || !pos || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    const top = Math.max(8, Math.min(pos.top, window.innerHeight - r.height - 8));
    const left = Math.max(8, Math.min(pos.left, window.innerWidth - r.width - 8));
    if (top !== pos.top || left !== pos.left) setPos({ top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos?.top, pos?.left]);

  const commitAdd = () => {
    const name = draft.trim();
    if (!name) return;
    setDraft('');
    onChange?.([...names, name]);
  };
  const removeAt = (idx) => onChange?.(names.filter((_, i) => i !== idx));

  if (!canEdit && names.length === 0) return null;

  return (
    <div className={styles.extWrap}>
      <div className={styles.extAvatars}>
        {names.map((name, i) => (
          <span
            key={`${name}-${i}`}
            className={styles.extAvatar}
            style={{ background: extColor(name) }}
            title={name}
            aria-label={name}
          >
            {externalInitials(name)}
          </span>
        ))}
        {canEdit && (
          <button
            type="button"
            ref={addBtnRef}
            className={styles.extAddBtn}
            onClick={openEditor}
            aria-expanded={open}
            aria-label="עריכת משתתפים"
            title="עריכת משתתפים"
          >
            +
          </button>
        )}
      </div>

      {open && createPortal(
        <>
          <div className={styles.extBackdrop} onClick={() => setOpen(false)} />
          <div
            ref={popRef}
            className={styles.extPopover}
            role="dialog"
            aria-label="משתתפים"
            style={pos ? { top: pos.top, left: pos.left } : undefined}
          >
            <div className={styles.extTitle}>משתתפים</div>
            {names.length > 0 && (
              <ul className={styles.extList}>
                {names.map((name, i) => (
                  <li key={`${name}-${i}`} className={styles.extRow}>
                    <span className={styles.extRowName}>{name}</span>
                    <button
                      type="button"
                      className={styles.extRemove}
                      onClick={() => removeAt(i)}
                      aria-label={`הסרת ${name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.extAddRow}>
              <input
                className={styles.extInput}
                value={draft}
                placeholder="שם מלא…"
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAdd(); } }}
                aria-label="שם משתתף חיצוני"
              />
              <button type="button" className={styles.extAdd} onClick={commitAdd} disabled={!draft.trim()}>
                הוסף
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

export default ExternalPeople;
