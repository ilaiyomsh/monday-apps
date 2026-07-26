// SOURCE: ported from apps/discussions/src/components/PersonPicker/PersonPicker.jsx
// ג€” the proven implementation two separate correction sessions pointed at as
// "the working one". Do NOT rebuild this from scratch or from Vibe Dialog/Combobox
// (Dialog double-rendered its content; Combobox option clicks were dead).
// Adaptations for the scaffold: the account roster is fetched here via
// mondayService (the source app read it from a shared usersStore), and logging
// hooks were dropped. Behavior and markup are otherwise identical.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, AvatarGroup } from '@vibe/core';
import { Check, CloseSmall, Search, Person } from '@vibe/icons';
import { computeFloatingPosition } from '../../utils/overlayPlacement';
import mondayService from '../../services/mondayService';
import logger from '../../utils/logger';
import styles from './PersonPicker.module.css';

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

// Module-level roster cache: one users query per page load, shared by every
// picker instance. Shape: [{ id, name, photo_thumb }].
let rosterCache = null;
let rosterPromise = null;
async function loadRoster() {
  if (rosterCache) return rosterCache;
  if (!rosterPromise) {
    rosterPromise = mondayService
      .query('query AccountUsers($limit: Int) { users(limit: $limit) { id name photo_thumb } }', { limit: 500 })
      .then((data) => {
        rosterCache = data?.users || [];
        return rosterCache;
      })
      .catch((err) => {
        logger.error('PersonPicker', 'Failed to load account roster', err);
        rosterPromise = null; // allow retry on next open
        return [];
      });
  }
  return rosterPromise;
}

/**
 * People picker styled after monday's native people-column picker: removable
 * chips for the current selection + a searchable list of account users with
 * avatars. Uses a plain clickable button list inside a popover portaled to
 * document.body ג€” so it escapes table overflow/sticky headers AND transform
 * ancestors, and renders exactly once.
 *
 * Props: { selected: [{id, name, kind}], onChange, users?, bordered?,
 * closeOnSelect?, single? }.
 * `users`: optionally pass a pre-fetched roster instead of the built-in fetch.
 * `single`: cap the selection at one person (assignee fields). A second pick is
 * blocked with a notice; deselecting the existing person is still allowed.
 */
export function PersonPicker({
  selected = [],
  onChange,
  users = null,
  bordered = false,
  closeOnSelect = false,
  single = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState(null);
  const [fetchedUsers, setFetchedUsers] = useState(rosterCache || []);
  const [loading, setLoading] = useState(!users && !rosterCache);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (users) return undefined;
    let alive = true;
    loadRoster().then((list) => {
      if (!alive) return;
      setFetchedUsers(list);
      setLoading(false);
    }).catch((err) => {
      // loadRoster resolves [] on failure, so this is defensive only ג€”
      // but the chain must terminate in .catch (promise/catch-or-return).
      logger.error('PersonPicker', 'Roster load rejected', err);
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [users]);

  const roster = users || fetchedUsers;
  const byId = useMemo(() => {
    const m = new Map();
    roster.forEach((u) => m.set(String(u.id), u));
    return m;
  }, [roster]);
  const getUser = (id) => byId.get(String(id));

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

  // Reposition on scroll/resize while open (capture-phase scroll catches
  // scrolling containers, not just the window).
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
      setPos({ top: next.top, left: next.left, minWidth: Math.max(rect.width, 280) });
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
    onChange(selected.filter((p) => String(p.id) !== String(id)));
  };
  const toggleUser = (user) => {
    if (selectedIds.includes(String(user.id))) {
      removeUser(user.id);
    } else if (single && selected.length >= 1) {
      // single-assignee mode: one person max. Block the extra pick (the popover
      // stays open so the user can deselect the current person first) and
      // surface a notice. monday.execute is a no-op outside the iframe / tests.
      try {
        mondayService.showNotice('׳ ׳™׳×׳ ׳׳”׳§׳¦׳•׳× ׳׳—׳¨׳׳™ ׳׳—׳“ ׳‘׳׳‘׳“', 'error');
      } catch (err) {
        // Outside the monday iframe (dev harness / tests) showNotice throws;
        // the notice is cosmetic there, but the failure still gets recorded.
        logger.warn('PersonPicker', 'showNotice unavailable outside iframe', err);
      }
      return;
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
    setOpen(true);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? roster.filter((u) => (u.name || '').toLowerCase().includes(q))
    : roster;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${bordered ? styles.triggerBordered : ''}`}
        onClick={toggleOpen}
      >
        {selected.length === 0 ? (
          <span className={styles.placeholder} aria-label="׳׳ ׳”׳•׳§׳¦׳”">
            <Person size={16} />
          </span>
        ) : selected.length === 1 ? (
          /* Single assignee (the common case): a plain Avatar centers exactly on
             the same line as the header and the empty placeholder. AvatarGroup
             carries stacking padding that would shift one avatar off-center. */
          (() => {
            const p = selected[0];
            const u = getUser(p.id);
            return (
              <Avatar
                size="small"
                src={u?.photo_thumb}
                text={initialsOf(p.name || u?.name)}
                type={u?.photo_thumb ? 'img' : 'text'}
                ariaLabel={p.name}
              />
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
                        aria-label={`׳”׳¡׳¨ ${name}`}
                      >
                        <CloseSmall size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <div className={styles.searchWrap}>
              <Search className={styles.searchIcon} aria-hidden="true" />
              <input
                type="text"
                className={styles.search}
                aria-label="׳—׳™׳₪׳•׳© ׳©׳"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className={styles.heading}>׳׳ ׳©׳™׳ ׳׳•׳¦׳¢׳™׳</div>
            <div className={styles.list}>
              {loading ? (
                <div className={styles.empty}>׳˜׳•׳¢׳...</div>
              ) : filtered.length === 0 ? (
                <div className={styles.empty}>׳׳ ׳ ׳׳¦׳׳• ׳׳ ׳©׳™׳</div>
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

