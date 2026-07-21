import React, { useMemo, useState, useEffect, useSyncExternalStore } from 'react';
import { Button, Checkbox, Text } from '@vibe/core';
import { Comment, Note, Status, Completed, Settings, DropdownChevronDown, Download } from '@vibe/icons';
import { buildPermissionsSummaryModel, downloadPermissionsSummary } from '../../utils/permissionsSummaryDoc.js';
import { getBoardId } from '../../utils/mondayApi/board-config-store.js';
import { getBoardPeople } from '../../utils/mondayApi/subscribers.js';
import logger from '../../utils/logger.js';
import {
  CAPABILITIES,
  DEFAULT_PERMISSION_SEED,
  DEFAULT_PERMISSIONS,
  PERMISSION_ROLE_SOURCES,
} from '../../utils/mondayApi/boards.config.js';
import {
  getPeopleColumns,
  ensurePeopleColumns,
  subscribe as subscribePeopleColumns,
  getVersion as getPeopleColumnsVersion,
} from '../../utils/mondayApi/peopleColumns.js';
import BoardPeoplePicker from './BoardPeoplePicker.jsx';
import { PersonPicker } from '@generated/components/PersonPicker';
import styles from './PermissionsTab.module.css';

// Inline eye / eye-off glyphs for the per-role "hide" toggle (no eye icon in
// @vibe/icons). Eye-off = "ignore this column"; eye = "restore".
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 6.1C11.05 6.03 11.52 6 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7c1.9 0 3.6-.5 5-1.3" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

/*
 * "הרשאות" tab — owner-only role/capability matrix (Phase 3).
 *
 * Client-side ADVISORY gating only (the app has no server). While
 * `permissions.enabled` is false the whole matrix is bypassed and behavior is
 * byte-for-byte identical to today (fail-open) — the grid is disabled with an
 * explainer. The owner picks a role on the LEFT (people columns by title,
 * grouped by tier); the MAIN pane shows that role's capabilities as category
 * cards with checkbox rows. State lives in the parent SettingsModal and is
 * persisted as a whole `permissions` object via updateSettings on save.
 *
 * The people-picker (owners/members under "אנשים בלוח") is Phase 5 — NOT here.
 */

// Tier metadata: title, 1-line role description, and the per-tier category cards
// (group id -> { title, icon-illustration glyph }). The catalog
// (CAPABILITIES) is filtered by tier+group to fill each card's checkbox rows.
// `boardLabel` names the SOURCE board each role group's people-columns come from
// (rendered as the group header in the sidebar). disc → the discussions board's
// people columns (creator/lead/participants); task → the tasks board's people
// columns (creator/responsible); decision → the decisions board's role columns
// (creator/decider/מושפעים — PERMISSION_ROLE_SOURCES.decisions, where the
// "מושפעים"/affected people column is now a first-class role); system → global
// pseudo-roles (no board).
// "כללי" (system) is FIRST — it's the global pseudo-role, shown at the top with
// no board-source header. Then the per-board tiers, whose roles are ALL the
// board's mapped people columns (derived dynamically, see buildRoleGroups).
const TIERS = [
  { id: 'system', label: 'כללי', boardLabel: null },
  { id: 'disc', label: 'דיון', boardLabel: 'לוח דיונים' },
  { id: 'task', label: 'משימה', boardLabel: 'לוח משימות' },
  { id: 'decision', label: 'החלטה', boardLabel: 'לוח החלטות' },
];

// Which board's columns back each people-column tier (system is synthetic).
const TIER_BOARD_KEY = { disc: 'discussions', task: 'tasks', decision: 'decisions' };

// The system tier is NOT a people-column role; it is a single global pseudo-role
// stored under this fixed key so its grants persist alongside the people roles.
const SYSTEM_ROLE_KEY = 'system:system';
const SYSTEM_ROLE_TITLE = 'כללי';

// Category cards per tier. Each card groups a subset of CAPABILITIES by `group`.
// `Icon` is a @vibe/icons component (advisory illustration for the card head).
const TIER_CARDS = {
  disc: [
    { group: 'discussion', title: 'דיון', Icon: Comment },
    { group: 'topics', title: 'נושאים ונקודות', Icon: Note },
    { group: 'tasks', title: 'משימות', Icon: Status },
    { group: 'decisions', title: 'החלטות', Icon: Completed },
  ],
  task: [
    // ONE "שדות משימה" card; delete is just another row inside it.
    { group: 'taskFields', title: 'שדות משימה', Icon: Status },
  ],
  decision: [
    // ONE "שדות החלטה" card, mirroring the task tier; delete is a row inside it.
    { group: 'decisionFields', title: 'שדות החלטה', Icon: Completed },
  ],
  system: [
    { group: 'system', title: 'כללי', Icon: Settings },
  ],
};

// A column alias is a "role source" iff its mapped type is a people column.
function isPeopleType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'people' || t === 'person' || t === 'multiple_person';
}

/**
 * Build the LEFT role list. "כללי" (system) is one synthetic role; each board
 * tier's roles are ALL the LIVE people columns of that board (fetched from the
 * real board — a column added there, e.g. "רשם דיון", appears automatically).
 * Roles that correspond to a MAPPED alias keep their alias key so existing
 * stored config is preserved; unmapped columns are keyed by raw column id.
 * Falls back to the mapped people columns until the live list has loaded.
 */
function buildRoleGroups(columns) {
  return TIERS.map((tier) => {
    // The system tier has a single synthetic role (no people column backs it).
    if (tier.id === 'system') {
      return {
        tier,
        roles: [{ key: SYSTEM_ROLE_KEY, boardKey: 'system', alias: 'system', title: SYSTEM_ROLE_TITLE }],
      };
    }
    const boardKey = TIER_BOARD_KEY[tier.id];
    const cfg = columns?.[boardKey] || {};
    // Only PERMISSION_ROLE_SOURCES aliases keep their alias key — that's what
    // the resolver reads for mapped roles. Any OTHER live people column the owner
    // added that isn't a designated role source is NOT an alias-role: the
    // resolver treats it as an EXTRA live column keyed by raw column id, so the
    // UI must too. (decisions' affectedID "מושפעים" is now a role source, so it
    // keeps its alias key like creator/decider.)
    const roleSources = PERMISSION_ROLE_SOURCES[boardKey] || [];
    // alias-by-columnId, to preserve alias keys for already-mapped role columns.
    // A multi-column alias (`ids`, e.g. tasks.taskViewersID) claims EVERY one of
    // its mapped columns — they are all the same role in the matrix.
    const aliasByColId = {};
    for (const alias of roleSources) {
      const entry = cfg[alias];
      const ids = [entry?.id, ...(Array.isArray(entry?.ids) ? entry.ids : [])].filter(Boolean);
      for (const cid of ids) aliasByColId[cid] = alias;
    }

    const live = getPeopleColumns(boardKey);
    let roles;
    if (live.length) {
      const seenKeys = new Set();
      roles = live
        .map((col) => {
          const alias = aliasByColId[col.id];
          return alias
            ? { key: `${boardKey}:${alias}`, boardKey, alias, columnId: col.id, title: col.title || cfg[alias]?.title || alias }
            : { key: `${boardKey}:${col.id}`, boardKey, alias: col.id, columnId: col.id, title: col.title || col.id };
        })
        // several live columns can map to ONE multi-column alias — one matrix row
        .filter((r) => (seenKeys.has(r.key) ? false : (seenKeys.add(r.key), true)));
    } else {
      // Pre-load fallback: mapped people ROLE columns from the settings schema.
      roles = roleSources
        .filter((alias) => isPeopleType(cfg[alias]?.type))
        .map((alias) => ({ key: `${boardKey}:${alias}`, boardKey, alias, columnId: cfg[alias]?.id, title: cfg[alias]?.title || alias }));
    }
    return { tier, roles };
  });
}

/**
 * Is a capability box CHECKED for a role in the current draft? Checked iff the
 * stored value is exactly `true` (an explicit grant). Both `false` (explicit
 * revoke, deny-wins in the resolver) and `undefined` (never touched → inherits
 * CAPABILITY_DEFAULTS) render UNCHECKED — `toggleCap` writes `true` on check and
 * `false` on uncheck, so unchecking a box always expresses a revoke.
 */
function isCapChecked(permissions, roleKey, capId) {
  const cap = permissions?.roles?.[roleKey]?.capabilities?.[capId];
  return cap === true;
}

export default function PermissionsTab({ permissions, setPermissions, columns, selectedRoleKey, onSelectRole }) {
  // Board permissions are ALWAYS ON — there is no enable toggle. The matrix is
  // enforced at runtime for everyone (owners are never restricted). On mount we
  // force `enabled: true` in the draft and pre-fill the roles from the LOCKED
  // seed when none are stored yet, so the matrix is never empty and saving
  // persists the always-on state.
  const enabled = true;
  useEffect(() => {
    setPermissions((prev) => {
      const needsSeed = !prev?.roles || Object.keys(prev.roles).length === 0;
      // Backfill: seed role keys that didn't exist when this instance first
      // stored its roles (e.g. the decision tier's decisions:* roles, added
      // after launch). Only WHOLLY-ABSENT keys are added — a role the owner
      // ever touched (even to revoke everything) is never overwritten.
      const missingSeedKeys = needsSeed
        ? []
        : Object.keys(DEFAULT_PERMISSION_SEED).filter((k) => !prev.roles[k]);
      if (prev?.enabled === true && !needsSeed && !missingSeedKeys.length) return prev;
      const next = { ...DEFAULT_PERMISSIONS, ...prev, enabled: true };
      if (needsSeed) {
        next.roles = JSON.parse(JSON.stringify(DEFAULT_PERMISSION_SEED));
      } else if (missingSeedKeys.length) {
        next.roles = { ...prev.roles };
        for (const k of missingSeedKeys) {
          next.roles[k] = JSON.parse(JSON.stringify(DEFAULT_PERMISSION_SEED[k]));
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the live people columns once and re-render when they arrive, so the role
  // list reflects the REAL board (incl. people columns that aren't a mapped alias).
  useEffect(() => { ensurePeopleColumns(); }, []);
  const peopleColumnsVersion = useSyncExternalStore(
    subscribePeopleColumns, getPeopleColumnsVersion, getPeopleColumnsVersion
  );

  const roleGroups = useMemo(() => buildRoleGroups(columns), [columns, peopleColumnsVersion]);
  const allRoleKeys = useMemo(
    () => roleGroups.flatMap((g) => g.roles.map((r) => r.key)),
    [roleGroups]
  );

  // Selected role lives in parent local state (NOT in the persisted permissions
  // blob) so it survives a tab switch but never reaches storage.
  const selectedKey = allRoleKeys.includes(selectedRoleKey)
    ? selectedRoleKey
    : allRoleKeys[0];

  const selectedRole = useMemo(() => {
    for (const g of roleGroups) {
      const found = g.roles.find((r) => r.key === selectedKey);
      if (found) return { ...found, tier: g.tier };
    }
    return null;
  }, [roleGroups, selectedKey]);

  const selectRole = (key) => onSelectRole?.(key);

  // Accordion state — which capability cards are collapsed (keyed by group id).
  // Empty = all expanded by default; toggling flips one card open/closed.
  const [collapsedCards, setCollapsedCards] = useState({});
  const toggleCard = (group) =>
    setCollapsedCards((prev) => ({ ...prev, [group]: !prev[group] }));

  // Writes the checkbox's literal boolean: `true` on check (grant), `false` on
  // uncheck (explicit revoke — deny-wins in the resolver). It never DELETES the
  // key, so an unchecked box is a stored `false`, distinct from an untouched cap
  // (undefined → inherits CAPABILITY_DEFAULTS).
  const toggleCap = (roleKey, capId, value) =>
    setPermissions((prev) => {
      const roles = { ...(prev?.roles || {}) };
      const role = roles[roleKey] || {};
      const capabilities = { ...(role.capabilities || {}) };
      capabilities[capId] = value;
      roles[roleKey] = { ...role, capabilities };
      return { ...prev, roles };
    });

  // A hidden role's column is IGNORED entirely by the runtime resolver (as if the
  // people column weren't a role source). Stored as a per-role `hidden` flag; the
  // sidebar row renders dimmed and the toggle is reversible.
  const isRoleHidden = (roleKey) => permissions?.roles?.[roleKey]?.hidden === true;
  const toggleHidden = (roleKey) =>
    setPermissions((prev) => {
      const roles = { ...(prev?.roles || {}) };
      const role = roles[roleKey] || {};
      roles[roleKey] = { ...role, hidden: !role.hidden };
      return { ...prev, roles };
    });

  const cards = selectedRole ? TIER_CARDS[selectedRole.tier.id] || [] : [];

  // round203 — "הורדת סיכום הרשאות" (owner request): a Word document with every
  // role's effective capabilities, the fixed rules and the board membership.
  // Board people are fetched on demand; a fetch failure still produces the doc
  // (membership lines show "—") — the failure is logged, never swallowed.
  const [downloading, setDownloading] = useState(false);
  const handleDownloadSummary = async () => {
    setDownloading(true);
    try {
      let boardPeople = null;
      try {
        const boardId = getBoardId('discussions');
        if (boardId) boardPeople = await getBoardPeople(boardId);
      } catch (err) {
        if (!err?.__loggedId) logger.warn('PermissionsTab', 'טעינת חברי הלוח לסיכום ההרשאות נכשלה — הסיכום יופק בלעדיהם', err);
      }
      const model = buildPermissionsSummaryModel({ permissions, roleGroups });
      await downloadPermissionsSummary(model, boardPeople);
    } catch (err) {
      if (!err?.__loggedId) logger.error('PermissionsTab', 'הפקת סיכום ההרשאות נכשלה', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={styles.root} dir="ltr">
      <div className={styles.layout}>
        {/* LEFT — role list grouped by tier, thin dividers, no sub-header text.
            The role groups scroll; "People on this board" stays pinned at the
            bottom at a fixed height. */}
        <aside className={styles.sidebar}>
          <div className={styles.roleScroll}>
          {roleGroups.map((group, gi) => (
            <div key={group.tier.id} className={styles.roleGroup}>
              {gi > 0 && <div className={styles.divider} role="separator" />}
              {group.tier.boardLabel && (
                <div className={styles.groupHeader}>{group.tier.boardLabel}</div>
              )}
              <ul className={styles.roleList}>
                {group.roles.map((role) => {
                  const hidden = isRoleHidden(role.key);
                  const canHide = role.boardKey !== 'system';
                  return (
                    <li
                      key={role.key}
                      className={`${styles.roleRow} ${hidden ? styles.roleRowHidden : ''}`}
                    >
                      <button
                        type="button"
                        className={`${styles.roleItem} ${role.key === selectedKey ? styles.roleItemActive : ''}`}
                        onClick={() => selectRole(role.key)}
                        disabled={!enabled}
                      >
                        {role.title}
                      </button>
                      {canHide && (
                        <button
                          type="button"
                          className={styles.hideBtn}
                          onClick={(e) => { e.stopPropagation(); toggleHidden(role.key); }}
                          disabled={!enabled}
                          aria-label={hidden ? 'הצג הרשאות עמודה' : 'התעלם מהרשאות עמודה'}
                          title={hidden ? 'העמודה מוסתרת — לחץ להצגה' : 'התעלם מהרשאות העמודה'}
                        >
                          {hidden ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          </div>

          {/* "אנשים בלוח" — real board owners/members + people-picker (Phase 5).
              Shown regardless of the matrix enable state (it's membership, not a
              capability), but disabled until a discussions board is mapped.
              Pinned at the bottom of the sidebar at a fixed height. */}
          <div className={styles.peopleFooter}>
            <BoardPeoplePicker />
          </div>
        </aside>

        {/* MAIN — selected role title + description + category cards */}
        <section className={styles.main}>
          {/* round203 — permissions-summary download, pinned above the cards. */}
          <div className={styles.summaryRow} dir="rtl">
            <Button
              kind="secondary"
              size="small"
              leftIcon={Download}
              onClick={handleDownloadSummary}
              loading={downloading}
              disabled={downloading}
            >
              הורדת סיכום הרשאות (Word)
            </Button>
          </div>
          {selectedRole && (
            <>
              <div className={styles.roleHeader}>
                <Text type="text1" weight="bold">{selectedRole.title}</Text>
              </div>

              {isRoleHidden(selectedKey) && (
                <div className={styles.hiddenNote} dir="rtl">
                  העמודה הזו מוסתרת — ההרשאות שלה לא נאכפות. לחץ על אייקון העין בסרגל כדי להפעיל מחדש.
                </div>
              )}

              {/* round147 — "חברי-על": a shared people list on the permissions
                  blob. A super member is a REGULAR user plus exactly two extra
                  abilities — adding discussion types and managing templates
                  (they also get the gear in templates-only mode). Deliberately
                  ACTIVE even while the matrix switch is off — like board
                  membership, it isn't a matrix capability. */}
              {selectedRole.tier.id === 'system' && (
                <div className={styles.card} dir="rtl">
                  <div className={styles.cardHead}>
                    <span className={styles.cardIcon} aria-hidden="true"><Settings size={20} /></span>
                    <Text type="text1" weight="medium">חברי-על</Text>
                  </div>
                  <div className={styles.capRows}>
                    <Text type="text3" color="secondary">
                      משתמשים רגילים עם שתי יכולות נוספות בלבד: הוספת סוגי דיון וניהול תבניות.
                      פעיל גם כשמתג ההרשאות כבוי.
                    </Text>
                    <PersonPicker
                      selected={permissions?.superMembers || []}
                      onChange={(people) =>
                        setPermissions((prev) => ({
                          ...prev,
                          superMembers: (people || []).map((p) => ({ id: String(p.id), name: p.name })),
                        }))
                      }
                      accountWide
                      bordered
                    />
                  </div>
                </div>
              )}

              {cards.map((card) => {
                const caps = CAPABILITIES.filter(
                  (c) => c.tier === selectedRole.tier.id && c.group === card.group
                );
                if (!caps.length) return null;
                const CardIcon = card.Icon;
                const isOpen = !collapsedCards[card.group];
                return (
                  <div key={card.group} className={styles.card}>
                    <button
                      type="button"
                      className={styles.cardHead}
                      onClick={() => toggleCard(card.group)}
                      aria-expanded={isOpen}
                    >
                      <span className={styles.cardIcon} aria-hidden="true">
                        {CardIcon ? <CardIcon size={20} /> : null}
                      </span>
                      <Text type="text1" weight="medium">{card.title}</Text>
                      <DropdownChevronDown
                        className={`${styles.cardChevron} ${isOpen ? styles.cardChevronOpen : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                    {isOpen && (
                      <div className={styles.capRows}>
                        {caps.map((cap) => (
                          <div key={cap.id} className={styles.capRow}>
                            <Checkbox
                              label={cap.label}
                              checked={isCapChecked(permissions, selectedKey, cap.id)}
                              onChange={(e) => toggleCap(selectedKey, cap.id, e.target.checked)}
                              disabled={!enabled}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
