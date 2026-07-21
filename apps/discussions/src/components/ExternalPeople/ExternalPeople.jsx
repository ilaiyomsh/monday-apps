import React, { useState } from 'react';
import { Avatar } from '@vibe/core';
import { externalInitials } from '@generated/utils/externalParticipants.js';
import styles from './ExternalPeople.module.css';

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
          <span key={`${name}-${i}`} className={styles.extAvatar} title={name}>
            <Avatar size="small" text={externalInitials(name)} type="text" ariaLabel={name} />
          </span>
        ))}
        {canEdit && (
          <button
            type="button"
            className={styles.extAddBtn}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label="עריכת משתתפים חיצוניים"
            title="עריכת משתתפים חיצוניים"
          >
            +
          </button>
        )}
      </div>

      {open && (
        <>
          <div className={styles.extBackdrop} onClick={() => setOpen(false)} />
          <div className={styles.extPopover} role="dialog" aria-label="משתתפים חיצוניים">
            <div className={styles.extTitle}>משתתפים חיצוניים</div>
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
        </>
      )}
    </div>
  );
}

export default ExternalPeople;
