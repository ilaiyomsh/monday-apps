import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, AvatarGroup } from '@vibe/core';
import { Search, Team, Email } from '@vibe/icons';
import {
  getBoardPeople,
  setBoardMembers,
  removeBoardMembers,
  addEveryoneTeam,
  inviteUsersToAccount,
} from '../../utils/mondayApi/subscribers.js';
import { subscribe, getVersion, getAllUsers, ensureRoster } from '../../utils/usersStore.js';
import { useMondayContext } from '../../contexts/MondayContext.jsx';
import logger from '../../utils/logger.js';
import styles from './BoardPeoplePicker.module.css';

/*
 * "People on this board" — board members panel for the "הרשאות" tab.
 *   • Trigger (in the sidebar, English, styled like monday's board info): a
 *     "People on this board" header with two rows — Members and Owners — each
 *     showing up to 3 avatars then a "+N" circle. Clicking opens the box.
 *   • The box opens CENTERED over the settings modal, a one-to-one replica of
 *     monday's native "Invite to this board" dialog: search on top + one unified
 *     list of everyone on the board, each row avatar · name · CROWN toggle (blue
 *     filled = owner) · ✕ (remove). Typing filters the account roster to ADD
 *     people, offers the "Everyone" team, or INVITEs a new person by email.
 *
 * NOTE: board `team_subscribers` is UNAUTHORIZED for this app's scope, so the box
 * can only ADD the "Everyone" team, not read/display its state.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PREVIEW = 3;

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

// Inline crown glyph (no crown in @vibe/icons). Filled = owner, outline = member.
function Crown({ owner }) {
  return (
    <svg
      className={`${styles.crown} ${owner ? styles.crownOwner : ''}`}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill={owner ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={owner ? 0 : 1.7}
      strokeLinejoin="round"
    >
      <path d="M4 17.5 2.4 7l5 3.4L12 4l4.6 6.4 5-3.4L20 17.5H4Z" />
      <rect x="4" y="18.6" width="16" height="2.2" rx="0.6" stroke="none" fill="currentColor" />
    </svg>
  );
}

// A small stack of skeleton avatar circles shown while people load.
function AvatarSkeleton({ count = 3 }) {
  return (
    <span className={styles.skelGroup} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className={styles.skelAvatar} />
      ))}
    </span>
  );
}

export default function BoardPeoplePicker({ disabled = false }) {
  const { context } = useMondayContext();
  // The app's owners/members belong to the OBJECT the app lives in — i.e.
  // context.boardId (the host board for a board_view, the object itself for a
  // custom object) — NOT the mapped discussions DATA board. See
  // docs/sdk-instance-contexts.md.
  const boardId = context?.boardId ? String(context.boardId) : null;
  const accountSlug =
    context?.account?.slug || context?.account?.name || 'yomsheni-il';
  const everyoneLabel = `Everyone at ${accountSlug}`;

  const [people, setPeople] = useState({ owners: [], subscribers: [], teams: [], boardKind: null });
  const [loaded, setLoaded] = useState(false); // first load completed
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null); // { kind:'ok'|'err', text }

  const boxRef = useRef(null);

  useSyncExternalStore(subscribe, getVersion, getVersion);
  const roster = getAllUsers();

  const refresh = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    try {
      setPeople(await getBoardPeople(boardId));
    } catch (err) {
      logger.warn('BoardPeoplePicker', 'failed to load board people', err);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [boardId]);

  useEffect(() => {
    refresh();
    ensureRoster();
  }, [refresh]);

  // Owners, and Members = subscribers who are NOT owners (owners are also subscribers).
  const owners = people.owners;
  const members = useMemo(() => {
    const ownerIds = new Set(people.owners.map((p) => String(p.id)));
    return people.subscribers.filter((p) => !ownerIds.has(String(p.id)));
  }, [people.owners, people.subscribers]);

  // Everyone on the board, owners first (a person appears once). Tagged with owner status.
  const boardPeople = useMemo(() => {
    const seen = new Map();
    people.owners.forEach((p) => seen.set(String(p.id), { ...p, isOwner: true }));
    people.subscribers.forEach((p) => {
      const id = String(p.id);
      if (!seen.has(id)) seen.set(id, { ...p, isOwner: false });
    });
    return Array.from(seen.values());
  }, [people.owners, people.subscribers]);

  const addedIds = useMemo(
    () => new Set(boardPeople.map((p) => String(p.id))),
    [boardPeople]
  );

  const showSkeleton = loading && !loaded;

  // Close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openBox = () => {
    if (disabled || !boardId) return;
    setSearch(''); setInviteMsg(null); setOpen(true);
  };
  const close = () => { setOpen(false); setSearch(''); setInviteMsg(null); };

  const q = search.trim().toLowerCase();
  const isEmailQuery = EMAIL_RE.test(search.trim());

  const addSuggestions = useMemo(() => {
    if (!q) return [];
    return roster
      .filter((u) => (u.name || '').toLowerCase().includes(q) && !addedIds.has(String(u.id)))
      .slice(0, 30);
  }, [roster, q, addedIds]);

  const showEveryoneAdd = useMemo(() => {
    if (!q) return false;
    return (
      everyoneLabel.toLowerCase().includes(q) ||
      'everyone'.includes(q) ||
      'all'.includes(q) ||
      search.trim().includes('צוות') ||
      search.trim().includes('כולם')
    );
  }, [q, everyoneLabel, search]);

  const invitedList = useMemo(() => {
    if (!q) return boardPeople;
    return boardPeople.filter((p) => (p.name || '').toLowerCase().includes(q));
  }, [boardPeople, q]);

  // --- mutations (OPTIMISTIC) ---
  // Apply the UI change immediately, fire the mutation, then reconcile from the
  // API. On error we roll the UI back to the pre-action snapshot AND log at ERROR
  // so it surfaces as a toast (WARN/INFO are muted in prod).
  //   optimistic: (prevPeople) => nextPeople — omit for actions with no clean
  //   local shape (e.g. adding the account-wide team).
  const run = async (fn, action = 'membership action', optimistic) => {
    if (busy) return;
    const snapshot = people;
    if (optimistic) setPeople(optimistic);
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (err) {
      if (optimistic) setPeople(snapshot); // roll back the optimistic change
      logger.error('BoardPeoplePicker', `${action} failed`, err);
    } finally {
      setBusy(false);
    }
  };

  const addMember = (user) => {
    const id = String(user.id);
    if (addedIds.has(id)) return;
    return run(
      async () => {
        await setBoardMembers(boardId, [user.id], 'subscriber');
        logger.info('BoardPeoplePicker', 'added member', { id: user.id });
        setSearch('');
      },
      'add member',
      (prev) => prev.subscribers.some((p) => String(p.id) === id)
        ? prev
        : { ...prev, subscribers: [...prev.subscribers, { id, name: user.name, photoUrl: user.photo_thumb || null }] },
    );
  };

  const toggleOwner = (person) => {
    const id = String(person.id);
    const makeOwner = !person.isOwner;
    return run(
      async () => {
        await setBoardMembers(boardId, [person.id], makeOwner ? 'owner' : 'subscriber');
        logger.info('BoardPeoplePicker', makeOwner ? 'promoted to owner' : 'demoted to member', { id: person.id });
      },
      'toggle owner',
      (prev) => makeOwner
        ? (prev.owners.some((p) => String(p.id) === id)
            ? prev
            : { ...prev, owners: [...prev.owners, { id, name: person.name, photoUrl: person.photoUrl }] })
        : { ...prev, owners: prev.owners.filter((p) => String(p.id) !== id) },
    );
  };

  const removePerson = (person) => {
    const id = String(person.id);
    return run(
      async () => {
        await removeBoardMembers(boardId, [person.id]);
        logger.info('BoardPeoplePicker', 'removed person', { id: person.id });
      },
      'remove from board',
      (prev) => ({
        ...prev,
        owners: prev.owners.filter((p) => String(p.id) !== id),
        subscribers: prev.subscribers.filter((p) => String(p.id) !== id),
      }),
    );
  };

  const addEveryone = () =>
    run(async () => {
      await addEveryoneTeam(boardId);
      logger.info('BoardPeoplePicker', 'added everyone team');
      setSearch('');
    }, 'add everyone team');

  const invite = async () => {
    if (busy || !isEmailQuery) return;
    const email = search.trim();
    setBusy(true); setInviteMsg(null);
    try {
      const { invited, errors } = await inviteUsersToAccount([email], 'MEMBER');
      if (errors?.length) {
        setInviteMsg({ kind: 'err', text: errors[0]?.message || 'ההזמנה נכשלה' });
      } else {
        setInviteMsg({ kind: 'ok', text: `הוזמן: ${email}` });
        setSearch('');
        ensureRoster();
        logger.info('BoardPeoplePicker', 'invited to account', { email, invited: invited?.length || 0 });
      }
    } catch (err) {
      logger.warn('BoardPeoplePicker', 'invite failed', err);
      setInviteMsg({ kind: 'err', text: 'ההזמנה נכשלה' });
    } finally { setBusy(false); }
  };

  // Avatar preview for a group (Members / Owners): up to MAX_PREVIEW then a "+N" circle.
  const renderPreview = (list) => {
    if (showSkeleton) return <AvatarSkeleton count={3} />;
    if (!list.length) return <span className={styles.previewEmpty}>—</span>;
    return (
      <AvatarGroup size="small" max={MAX_PREVIEW}>
        {list.map((p) => (
          <Avatar
            key={p.id}
            size="small"
            src={p.photoUrl || undefined}
            text={initialsOf(p.name)}
            type={p.photoUrl ? 'img' : 'text'}
            ariaLabel={p.name}
          />
        ))}
      </AvatarGroup>
    );
  };

  return (
    <div className={styles.root} dir="ltr">
      {/* round220 — the internal "People on this board" title was dropped: the
          card header (OWNERS · MEMBERS badge) already names it, so the two rows
          now read as clean bordered picker fields matching the SUPER MEMBERS
          card's PersonPicker (owner request). */}
      <button type="button" className={styles.peopleRow} onClick={openBox} disabled={disabled || !boardId}>
        <span className={styles.peopleRowLabel}>Members</span>
        <span className={styles.peopleRowAvatars}>{renderPreview(members)}</span>
      </button>

      <button type="button" className={styles.peopleRow} onClick={openBox} disabled={disabled || !boardId}>
        <span className={styles.peopleRowLabel}>Owners</span>
        <span className={styles.peopleRowAvatars}>{renderPreview(owners)}</span>
      </button>

      {open && createPortal(
        <div
          className={styles.overlay}
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div ref={boxRef} className={styles.centerBox} dir="ltr" role="dialog" aria-label="People on this board">
            {/* Header */}
            <div className={styles.boxHeader}>
              <span className={styles.boxTitle}>People on this board</span>
              <button type="button" className={styles.boxClose} onClick={close} aria-label="Close">✕</button>
            </div>

            {/* Search */}
            <div className={styles.searchWrap}>
              <Search className={styles.searchIcon} aria-hidden="true" />
              <input
                type="text"
                className={styles.search}
                aria-label="Search by name, team or email"
                placeholder="Search by name, team or email"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setInviteMsg(null); }}
                autoFocus
              />
            </div>

            <div className={styles.scrollBody}>
              {/* ADD suggestions (only while searching) */}
              {q && (
                <>
                  {isEmailQuery && (
                    <button type="button" className={styles.row} onClick={invite} disabled={busy}>
                      <span className={styles.teamIcon} aria-hidden="true"><Email size={18} /></span>
                      <span className={styles.name}>Invite to account: {search.trim()}</span>
                    </button>
                  )}
                  {inviteMsg && (
                    <div className={`${styles.inviteMsg} ${inviteMsg.kind === 'err' ? styles.inviteErr : styles.inviteOk}`}>
                      {inviteMsg.text}
                    </div>
                  )}
                  <div className={styles.groupLabel}>Add</div>
                  <div className={styles.list}>
                    {addSuggestions.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className={styles.row}
                        onClick={() => addMember(user)}
                        disabled={busy}
                      >
                        <Avatar
                          size="small"
                          src={user.photo_thumb || undefined}
                          text={initialsOf(user.name)}
                          type={user.photo_thumb ? 'img' : 'text'}
                          ariaLabel={user.name}
                        />
                        <span className={styles.name}>{user.name}</span>
                      </button>
                    ))}
                    {showEveryoneAdd && (
                      <button type="button" className={styles.row} onClick={addEveryone} disabled={busy}>
                        <span className={styles.teamIcon} aria-hidden="true"><Team size={18} /></span>
                        <span className={styles.name}>{everyoneLabel}</span>
                      </button>
                    )}
                    {addSuggestions.length === 0 && !showEveryoneAdd && !isEmailQuery && (
                      <div className={styles.empty}>No results</div>
                    )}
                  </div>
                </>
              )}

              {/* Board people — unified members + owners, each with crown + ✕ */}
              <div className={styles.groupLabel}>People on this board</div>
              <div className={styles.list}>
                {showSkeleton ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={styles.skelRow}>
                      <span className={styles.skelAvatar} />
                      <span className={styles.skelBar} />
                    </div>
                  ))
                ) : invitedList.length === 0 ? (
                  <div className={styles.empty}>{q ? 'No results' : 'No one on this board'}</div>
                ) : (
                  invitedList.map((p) => (
                    <div key={p.id} className={styles.memberRow}>
                      <Avatar
                        size="small"
                        src={p.photoUrl || undefined}
                        text={initialsOf(p.name)}
                        type={p.photoUrl ? 'img' : 'text'}
                        ariaLabel={p.name}
                      />
                      <span className={styles.name}>{p.name}</span>
                      <button
                        type="button"
                        className={`${styles.crownBtn} ${p.isOwner ? styles.crownBtnOwner : ''}`}
                        onClick={() => toggleOwner(p)}
                        disabled={busy || disabled}
                        aria-label={p.isOwner ? 'Make member' : 'Make owner'}
                        title={p.isOwner ? 'Owner (click to remove ownership)' : 'Member (click to make owner)'}
                      >
                        <Crown owner={p.isOwner} />
                      </button>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={() => removePerson(p)}
                        disabled={busy || disabled}
                        aria-label={`Remove ${p.name}`}
                        title="Remove from board"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
