// SOURCE: ported from apps/discussions/src/components/PersonPicker/PersonPicker.jsx
// — the proven implementation two separate correction sessions pointed at as
// "the working one". Do NOT rebuild this from scratch or from Vibe Dialog/Combobox
// (Dialog double-rendered its content; Combobox option clicks were dead).
// Adaptations for the scaffold: the account roster is fetched here via
// mondayService (the source app read it from a shared usersStore), and logging
// hooks were dropped. Behavior and markup are otherwise identical.
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, AvatarGroup } from '@vibe/core';
import { Check, CloseSmall, Search, Person } from '@vibe/icons';
import { computeFloatingPosition } from '../../utils/overlayPlacement';
import mondayService from '../../services/mondayService';
import { loadRoster, getCachedRoster } from '../../services/rosterAccess';
import logger from '../../utils/logger';
import styles from './PersonPicker.module.css';

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

function photoOf(user) {
  return user?.photo_thumb ?? user?.photo_url?.thumb ?? null;
}

function entryKey(entry) {
  return `${entry?.kind || 'person'}:${String(entry?.id)}`;
}

/**
 * People picker styled after monday's native people-column picker: removable
 * chips for the current selection + a searchable list of account users with
 * avatars. Uses a plain clickable button list inside a popover portaled to
 * document.body — so it escapes table overflow/sticky headers AND transform
 * ancestors, and renders exactly once.
 *
 * Props: { selected: [{id, name, kind}], onChange, users?, teams?, bordered?,
 * closeOnSelect?, single? }.
 * `users`: optionally pass a pre-fetched roster instead of the built-in fetch.
 * `teams`: optional account teams — shown in the same list with kind:'team'.
 * `single`: cap the selection at one person (assignee fields). A second pick is
 * blocked with a notice; deselecting the existing person is still allowed.
 */
export function PersonPicker({
  selected = [],
  onChange,
  users = null,
  teams = null,
  bordered = false,
  closeOnSelect = false,
  single = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState(null);
  const [fetchedUsers, setFetchedUsers] = useState(getCachedRoster() || []);
  const [loading, setLoading] = useState(!users && !getCachedRoster());
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
      // loadRoster resolves [] on failure, so this is defensive only —
      // but the chain must terminate in .catch (promise/catch-or-return).
      logger.error('PersonPicker', 'Roster load rejected', err);
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [users]);

  const roster = useMemo(() => {
    const people = (users || fetchedUsers).map((user) => ({
      ...user,
      kind: user.kind || 'person',
    }));
    const teamEntries = (teams || []).map((team) => ({
      id: team.id,
      name: team.name,
      kind: 'team',
    }));
    return [...people, ...teamEntries];
  }, [users, fetchedUsers, teams]);

  const byKey = useMemo(() => {
    const m = new Map();
    roster.forEach((entry) => m.set(entryKey(entry), entry));
    return m;
  }, [roster]);
  const getEntry = (entry) => byKey.get(entryKey(entry));

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

  const reposition = useCallback(() => {
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
  }, []);

  // Reposition on scroll/resize while open (capture-phase scroll catches
  // scrolling containers, not just the window).
  useEffect(() => {
    if (!open) return undefined;
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const selectedKeys = useMemo(
    () => new Set((selected || []).map((p) => entryKey(p))),
    [selected],
  );

  const removeEntry = (entry) => {
    const key = entryKey(entry);
    onChange(selected.filter((p) => entryKey(p) !== key));
  };
  const toggleUser = (user) => {
    const kind = user.kind || 'person';
    const key = entryKey({ id: user.id, kind });
    if (selectedKeys.has(key)) {
      removeEntry({ id: user.id, kind });
    } else if (single && selected.length >= 1) {
      // single-assignee mode: one person max. Block the extra pick (the popover
      // stays open so the user can deselect the current person first) and
      // surface a notice. monday.execute is a no-op outside the iframe / tests.
      try {
        mondayService.showNotice('ניתן להקצות אחראי אחד בלבד', 'error');
      } catch (err) {
        // Outside the monday iframe (dev harness / tests) showNotice throws;
        // the notice is cosmetic there, but the failure still gets recorded.
        logger.warn('PersonPicker', 'showNotice unavailable outside iframe', err);
      }
      return;
    } else {
      onChange([...selected, { id: user.id, kind, name: user.name }]);
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
    reposition();
    setOpen(true);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? roster.filter((u) => (u.name || '').toLowerCase().includes(q))
    : roster;
  const hasTeams = (teams || []).length > 0;
  const listHeading = hasTeams ? 'אנשים וצוותים' : 'אנשים מוצעים';
  const emptyText = hasTeams ? 'לא נמצאו תוצאות' : 'לא נמצאו אנשים';

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
            <Person size={16} />
          </span>
        ) : selected.length === 1 ? (
          /* Single assignee (the common case): a plain Avatar centers exactly on
             the same line as the header and the empty placeholder. AvatarGroup
             carries stacking padding that would shift one avatar off-center. */
          (() => {
            const p = selected[0];
            const u = getEntry(p);
            const photo = p.kind === 'team' ? null : photoOf(u);
            return (
              <Avatar
                size="small"
                src={photo}
                text={initialsOf(p.name || u?.name)}
                type={photo ? 'img' : 'text'}
                ariaLabel={p.name}
              />
            );
          })()
        ) : (
          <AvatarGroup size="small" max={4}>
            {selected.map((p) => {
              const u = getEntry(p);
              const photo = p.kind === 'team' ? null : photoOf(u);
              return (
                <Avatar
                  key={entryKey(p)}
                  size="small"
                  src={photo}
                  text={initialsOf(p.name || u?.name)}
                  type={photo ? 'img' : 'text'}
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
                  const u = getEntry(p);
                  const photo = p.kind === 'team' ? null : photoOf(u);
                  const name = p.name || u?.name || '';
                  return (
                    <span key={entryKey(p)} className={styles.chip}>
                      <Avatar size="small" src={photo} text={initialsOf(name)} type={photo ? 'img' : 'text'} ariaLabel={name} />
                      <span className={styles.chipName}>
                        {name}
                        {p.kind === 'team' ? ' (צוות)' : ''}
                      </span>
                      <button
                        type="button"
                        className={styles.chipRemove}
                        onClick={() => removeEntry(p)}
                        aria-label={`הסר ${name}`}
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
                aria-label="חיפוש שם"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className={styles.heading}>{listHeading}</div>
            <div className={styles.list}>
              {loading ? (
                <div className={styles.empty}>טוען...</div>
              ) : filtered.length === 0 ? (
                <div className={styles.empty}>{emptyText}</div>
              ) : (
                filtered.map((user) => {
                  const kind = user.kind || 'person';
                  const isSel = selectedKeys.has(entryKey({ id: user.id, kind }));
                  const photo = kind === 'team' ? null : photoOf(user);
                  return (
                    <button
                      key={entryKey({ id: user.id, kind })}
                      type="button"
                      className={`${styles.row} ${isSel ? styles.rowSelected : ''}`}
                      onClick={() => toggleUser(user)}
                    >
                      <span className={styles.check}>{isSel && <Check size={16} />}</span>
                      <Avatar
                        size="small"
                        src={photo}
                        text={initialsOf(user.name)}
                        type={photo ? 'img' : 'text'}
                        ariaLabel={user.name}
                      />
                      <span className={styles.name}>
                        {user.name}
                        {kind === 'team' ? (
                          <span className={styles.kindHint}> צוות</span>
                        ) : null}
                      </span>
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
