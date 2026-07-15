import React, { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, AvatarGroup } from '@vibe/core';
import { Check, CloseSmall, Search } from '@vibe/icons';
import { subscribe, getVersion, getAllUsers, getUser, hasRoster, ensureRoster } from '@generated/utils/usersStore.js';
import { useBoardSubscribers } from '@generated/hooks/useBoardSubscribers.js';
import { computeFloatingPosition } from '@generated/utils/overlayPlacement';
import logger from '@generated/utils/logger.js';
import { EmptyPersonGlyph } from '../PersonAvatar/PersonAvatar.jsx';
import styles from './PersonPicker.module.css';

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

// Which people list the picker offers (round 79). `accountWide` (or no
// `boardKey`) → the full ACCOUNT roster; otherwise the BOARD's members, falling
// back to the roster while board membership is empty/loading so it's never
// blank. Pure + exported for testing.
export function pickPeopleSource({ accountWide, boardKey, boardUsers, roster }) {
  const all = Array.isArray(roster) ? roster : [];
  if (accountWide || !boardKey) return all;
  return (Array.isArray(boardUsers) && boardUsers.length) ? boardUsers : all;
}

/**
 * People picker styled after monday's native people-column picker: removable
 * chips for the current selection + a searchable list of account users with
 * avatars. Uses a plain clickable button list inside a popover portaled to
 * document.body — so it escapes table overflow/sticky headers AND renders exactly
 * once (Vibe's Dialog double-rendered its content here). Same {selected,onChange}
 * API. ("Invite by email" isn't available to embedded apps; omitted.)
 *
 * `single`: single-person fields (מנהל / מחליט / lead / recorder / task
 * assignee, etc.). Picking a DIFFERENT person REPLACES the current selection —
 * no need to clear the existing one first; clicking the already-selected person
 * deselects it. Multi (משתתפים / מושפעים) is unaffected.
 */
export function PersonPicker({ selected = [], onChange, bordered = false, closeOnSelect = false, single = false, boardKey = null, accountWide = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  // Option source: when `boardKey` is given, restrict to that BOARD'S members
  // (owners + subscribers) — the only people monday will let you assign to it
  // (assigning a non-member throws invalidPersonAssignment). Falls back to the
  // full account roster while board membership is loading or if it comes back
  // empty, so the picker is never blank. Without a boardKey — or with
  // `accountWide` (round 79: מושפעים may be anyone in the account, not only the
  // decisions-board members) — it uses the account roster.
  useSyncExternalStore(subscribe, getVersion, getVersion);
  // accountWide short-circuits the board fetch entirely (null boardKey → inert).
  const board = useBoardSubscribers(accountWide ? null : boardKey);
  const roster = getAllUsers();
  const subscribers = pickPeopleSource({ accountWide, boardKey, boardUsers: board.users, roster });
  const loading = (boardKey && !accountWide)
    ? (board.loading && board.users.length === 0 && roster.length === 0)
    : (!hasRoster() && roster.length === 0);

  // Always warm the account roster: it's the fallback source, and selected-chip
  // avatars for people who aren't board members still resolve from it.
  useEffect(() => { ensureRoster(); }, []);

  // Close on click-outside / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
      setSearch('');
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = computeFloatingPosition({
        anchorRect: rect,
        preferred: 'bottom-start',
        popupWidth: Math.max(rect.width, 300),
        popupHeight: 430,
        offset: 4,
      });
      if (!next) return;
      setPos({
        top: next.top,
        left: next.left,
        minWidth: Math.max(rect.width, 280),
      });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const selectedIds = useMemo(() => (selected || []).map((p) => String(p.id)), [selected]);

  const removeUser = (id) => {
    logger.info('PersonPicker', 'remove user', { id });
    const next = selected.filter((p) => String(p.id) !== String(id));
    onChange(next);
    // round114 — removing the LAST person empties the column: close the picker
    // immediately (owner request) instead of leaving the popover hanging open.
    if (next.length === 0) {
      setOpen(false);
      setSearch('');
    }
  };
  const toggleUser = (user) => {
    logger.info('PersonPicker', 'option clicked → toggle user', { id: user.id, name: user.name });
    if (selectedIds.includes(String(user.id))) {
      removeUser(user.id);
    } else if (single) {
      // single-person mode: picking a DIFFERENT person REPLACES the current
      // selection (no "only one allowed" block, no need to clear it first).
      onChange([{ id: user.id, kind: 'person', name: user.name }]);
    } else {
      onChange([...selected, { id: user.id, kind: 'person', name: user.name }]);
    }
    if (closeOnSelect) {
      setOpen(false);
      setSearch('');
    }
  };

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      setSearch('');
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const next = computeFloatingPosition({
        anchorRect: rect,
        preferred: 'bottom-start',
        popupWidth: Math.max(rect.width, 300),
        popupHeight: 430,
        offset: 4,
      });
      if (next) {
        setPos({ top: next.top, left: next.left, minWidth: Math.max(rect.width, 280) });
      }
    }
    logger.info('PersonPicker', 'trigger clicked → opening', { loaded: subscribers.length, selected: selected.length });
    setOpen(true);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? subscribers.filter((u) => (u.name || '').toLowerCase().includes(q))
    : subscribers;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${bordered ? styles.triggerBordered : ''}`}
        onClick={toggleOpen}
      >
        {selected.length === 0 ? (
          <span className={styles.placeholder} aria-label="לא הוקצה">
            <EmptyPersonGlyph size={28} />
          </span>
        ) : selected.length === 1 ? (
          /* Single assignee (the common case): a plain Avatar centers exactly on
             the same line as the header and the empty placeholder. AvatarGroup
             carries stacking padding that would shift one avatar off-center. */
          (() => {
            const p = selected[0];
            const u = getUser(p.id);
            return (
              // Native-title name tooltip (round 33) — never clipped / always on top.
              <span title={p.name || u?.name} style={{ display: 'inline-flex' }}>
                <Avatar
                  size="small"
                  src={u?.photo_thumb}
                  text={initialsOf(p.name || u?.name)}
                  type={u?.photo_thumb ? 'img' : 'text'}
                  ariaLabel={p.name}
                />
              </span>
            );
          })()
        ) : (
          <AvatarGroup size="small" max={4}>
            {selected.map((p) => {
              const u = getUser(p.id);
              return (
                <Avatar
                  key={p.id}
                  size="small"
                  src={u?.photo_thumb}
                  text={initialsOf(p.name || u?.name)}
                  type={u?.photo_thumb ? 'img' : 'text'}
                  ariaLabel={p.name}
                  // Overlapping group avatars keep the @vibe tooltip (a wrapper
                  // span would break the stack) but pinned to z-index 10000 so
                  // it's never hidden behind other UI (round 33).
                  tooltipProps={{ content: p.name || u?.name, zIndex: 10000 }}
                />
              );
            })}
          </AvatarGroup>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className={styles.popover}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth, zIndex: 10000 }}
        >
          <div className={styles.menu}>
            {selected.length > 0 && (
              <div className={styles.chips}>
                {selected.map((p) => {
                  const u = getUser(p.id);
                  const photo = u?.photo_thumb;
                  const name = p.name || u?.name || '';
                  return (
                    <span key={p.id} className={styles.chip}>
                      <Avatar size="small" src={photo} text={initialsOf(name)} type={photo ? 'img' : 'text'} ariaLabel={name} />
                      <span className={styles.chipName}>{name}</span>
                      <button
                        type="button"
                        className={styles.chipRemove}
                        onClick={() => removeUser(p.id)}
                        aria-label={`הסר ${name}`}
                      >
                        <CloseSmall size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* RTL search (round 97): Hebrew names type right-to-left. dir="rtl"
                on the wrap flips the logical-property icon/padding to the right
                AND sets the input's typing direction. */}
            <div className={styles.searchWrap} dir="rtl">
              <Search className={styles.searchIcon} aria-hidden="true" />
              <input
                type="text"
                className={styles.search}
                aria-label="חיפוש שם"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className={styles.list}>
              {loading ? (
                <div className={styles.empty}>טוען...</div>
              ) : filtered.length === 0 ? (
                <div className={styles.empty}>לא נמצאו אנשים</div>
              ) : (
                filtered.map((user) => {
                  const isSel = selectedIds.includes(String(user.id));
                  return (
                    <button
                      key={user.id}
                      type="button"
                      className={`${styles.row} ${isSel ? styles.rowSelected : ''}`}
                      onClick={() => toggleUser(user)}
                    >
                      <span className={styles.check}>{isSel && <Check size={16} />}</span>
                      <Avatar
                        size="small"
                        src={user.photo_thumb}
                        text={initialsOf(user.name)}
                        type={user.photo_thumb ? 'img' : 'text'}
                        ariaLabel={user.name}
                      />
                      <span className={styles.name}>{user.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default PersonPicker;
