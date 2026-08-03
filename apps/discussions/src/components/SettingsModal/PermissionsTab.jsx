import React, { useMemo, useState, useEffect, useSyncExternalStore } from 'react';
import { Button, Text } from '@vibe/core';
import { Download, DropdownChevronDown } from '@vibe/icons';
import { groupCapabilities } from './permissionsGrouping.js';
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

// Inline eye / eye-off glyphs for the per-role-COLUMN "hide" toggle (no eye icon
// in @vibe/icons). Eye-off = "ignore this column"; eye = "restore".
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 6.1C11.05 6.03 11.52 6 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7c1.9 0 3.6-.5 5-1.3" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

/*
 * "הרשאות" tab — round212 REDESIGN (owner spec): one ✓-MATRIX TABLE per tier —
 * the actions are the rows, the roles are the columns, and every intersection
 * is a clickable cell (✓ = allowed). Below the matrices, the APP ROLES section
 * assigns account users to Owners / Super Members / Members.
 *
 * Still client-side ADVISORY gating (the app has no server). The state lives in
 * the parent SettingsModal draft and persists as one `permissions` object.
 */

/* round332 (owner request, approved mock) — the explanatory captions
   ("התפקידים נקבעים לפי עמודות האנשים…") are GONE: the owner judged them noise,
   and the matrix's own role columns already say it. The head is chevron + title. */
const TIERS = [
  { id: 'disc', title: 'דיון ונושאים' },
  { id: 'task', title: 'שדות משימה' },
  { id: 'decision', title: 'שדות החלטה' },
];

// Which board's columns back each people-column tier (system is synthetic).
const TIER_BOARD_KEY = { disc: 'discussions', task: 'tasks', decision: 'decisions' };

/* round333 (owner request) — fixed reading order for the discussions matrix,
   right to left: יוצר → מנהל → מרכז → משתתפים. The live people-column list
   arrives in BOARD order, which is whatever order the columns were created in —
   not a reading order. Aliases absent from this list keep their relative board
   order after the known ones (stable sort). */
const ROLE_ALIAS_ORDER = {
  discussions: ['discussionCreatorID', 'discussionLeadID', 'discussionCoordinatorID', 'participantsID'],
};

function sortRolesByPreferredOrder(boardKey, roles) {
  const order = ROLE_ALIAS_ORDER[boardKey];
  if (!order) return roles;
  const rank = (r) => {
    const i = order.indexOf(r.alias);
    return i === -1 ? order.length : i;
  };
  return [...roles].sort((a, b) => rank(a) - rank(b));
}

// The system tier is NOT a people-column role; it is a single global pseudo-role
// stored under this fixed key so its grants persist alongside the people roles.
const SYSTEM_ROLE_KEY = 'system:system';

// round147 — the two DEFINING super-member capabilities (always granted to super
// members by the resolver, above the matrix). Locked ✓ in the system table.
const SUPER_MEMBER_CAPS = new Set(['addDiscussionTypes', 'manageTemplates']);

// A column alias is a "role source" iff its mapped type is a people column.
function isPeopleType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'people' || t === 'person' || t === 'multiple_person';
}

/**
 * The role COLUMNS of one board tier: ALL the live people columns of that board
 * (a column added there appears automatically). Mapped role-source aliases keep
 * their alias key (preserves stored config); extra columns key by raw column id.
 * Falls back to the mapped people columns until the live list has loaded.
 */
function buildTierRoles(boardKey, columns) {
  const cfg = columns?.[boardKey] || {};
  const roleSources = PERMISSION_ROLE_SOURCES[boardKey] || [];
  const aliasByColId = {};
  for (const alias of roleSources) {
    const entry = cfg[alias];
    const ids = [entry?.id, ...(Array.isArray(entry?.ids) ? entry.ids : [])].filter(Boolean);
    for (const cid of ids) aliasByColId[cid] = alias;
  }
  const live = getPeopleColumns(boardKey);
  if (live.length) {
    const seenKeys = new Set();
    const roles = live
      .map((col) => {
        const alias = aliasByColId[col.id];
        return alias
          ? { key: `${boardKey}:${alias}`, boardKey, alias, title: col.title || cfg[alias]?.title || alias }
          : { key: `${boardKey}:${col.id}`, boardKey, alias: col.id, title: col.title || col.id };
      })
      .filter((r) => (seenKeys.has(r.key) ? false : (seenKeys.add(r.key), true)));
    return sortRolesByPreferredOrder(boardKey, roles);
  }
  return sortRolesByPreferredOrder(
    boardKey,
    roleSources
      .filter((alias) => isPeopleType(cfg[alias]?.type))
      .map((alias) => ({ key: `${boardKey}:${alias}`, boardKey, alias, title: cfg[alias]?.title || alias }))
  );
}

/** Checked iff the stored value is exactly `true` (an explicit grant). */
function isCapChecked(permissions, roleKey, capId) {
  return permissions?.roles?.[roleKey]?.capabilities?.[capId] === true;
}

export default function PermissionsTab({ permissions, setPermissions, columns }) {
  // Board permissions are ALWAYS ON. On mount: force enabled + seed/backfill.
  useEffect(() => {
    setPermissions((prev) => {
      const needsSeed = !prev?.roles || Object.keys(prev.roles).length === 0;
      const missingSeedKeys = needsSeed
        ? []
        : Object.keys(DEFAULT_PERMISSION_SEED).filter((k) => !prev.roles[k]);
      // Per-CAPABILITY backfill (round209/round212): capability ids added to the
      // catalog AFTER an instance stored its roles are seeded into the EXISTING
      // role rows so the cells reflect the live default. Only wholly-ABSENT keys
      // are added — an owner's explicit true/false is never touched.
      const NEW_CAPS = ['viewReferencesBox', 'viewSummaryBox', 'writeBackground', 'writeReferences'];
      const capBackfill = needsSeed
        ? []
        : Object.keys(DEFAULT_PERMISSION_SEED).filter((k) => {
          if (!prev.roles[k]) return false;
          const seedCaps = DEFAULT_PERMISSION_SEED[k]?.capabilities || {};
          return NEW_CAPS.some((c) => c in seedCaps && prev.roles[k]?.capabilities?.[c] === undefined);
        });
      if (prev?.enabled === true && !needsSeed && !missingSeedKeys.length && !capBackfill.length) return prev;
      const next = { ...DEFAULT_PERMISSIONS, ...prev, enabled: true };
      if (needsSeed) {
        next.roles = JSON.parse(JSON.stringify(DEFAULT_PERMISSION_SEED));
      } else if (missingSeedKeys.length || capBackfill.length) {
        next.roles = { ...prev.roles };
        for (const k of missingSeedKeys) {
          next.roles[k] = JSON.parse(JSON.stringify(DEFAULT_PERMISSION_SEED[k]));
        }
        for (const k of capBackfill) {
          const seedCaps = DEFAULT_PERMISSION_SEED[k]?.capabilities || {};
          const caps = { ...(next.roles[k]?.capabilities || {}) };
          NEW_CAPS.forEach((c) => { if (c in seedCaps && caps[c] === undefined) caps[c] = seedCaps[c]; });
          next.roles[k] = { ...next.roles[k], capabilities: caps };
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live people columns (extra roles beyond the mapped aliases).
  useEffect(() => { ensurePeopleColumns(); }, []);
  const peopleColumnsVersion = useSyncExternalStore(
    subscribePeopleColumns, getPeopleColumnsVersion, getPeopleColumnsVersion
  );

  // round219 — the coordinator ("מרכז דיון") column is now driven PURELY by the
  // board mapping (buildTierRoles): it appears as a role column iff that people
  // column is mapped, labeled with its mapped title, and simply doesn't exist
  // otherwise. The old instance-level `permissions.noCoordinator` switch (and its
  // checkbox + sentence) was removed — mapping is the single source of truth.
  const tierRoles = useMemo(() => {
    const map = {};
    for (const tier of TIERS) {
      const boardKey = TIER_BOARD_KEY[tier.id];
      map[tier.id] = buildTierRoles(boardKey, columns);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, peopleColumnsVersion]);

  const roleGroups = useMemo(() => ([
    { tier: { id: 'system', label: 'כללי' }, roles: [{ key: SYSTEM_ROLE_KEY, boardKey: 'system', alias: 'system', title: 'כללי' }] },
    ...TIERS.map((tier) => ({ tier: { id: tier.id, label: tier.title }, roles: tierRoles[tier.id] || [] })),
  ]), [tierRoles]);

  // Writes the cell's literal boolean: `true` on check (grant), `false` on
  // uncheck (explicit revoke). Never DELETES the key — an unchecked cell is a
  // stored `false`, distinct from an untouched cap (undefined → defaults).
  const toggleCap = (roleKey, capId, value) =>
    setPermissions((prev) => {
      const roles = { ...(prev?.roles || {}) };
      const role = roles[roleKey] || {};
      const capabilities = { ...(role.capabilities || {}) };
      capabilities[capId] = value;
      roles[roleKey] = { ...role, capabilities };
      return { ...prev, roles };
    });

  // A hidden role's column is IGNORED by the runtime resolver.
  const isRoleHidden = (roleKey) => permissions?.roles?.[roleKey]?.hidden === true;
  const toggleHidden = (roleKey) =>
    setPermissions((prev) => {
      const roles = { ...(prev?.roles || {}) };
      const role = roles[roleKey] || {};
      roles[roleKey] = { ...role, hidden: !role.hidden };
      return { ...prev, roles };
    });

  // round246 (owner request) — every permission table is COLLAPSED by default
  // and opens on click. `expanded` holds the ids of the open sections.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleSection = (id) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  // round203 — "הורדת סיכום הרשאות" (Word).
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

  // One matrix cell: click toggles grant/revoke. Hidden role columns disable.
  const renderCell = (roleKey, capId, disabled) => {
    const on = isCapChecked(permissions, roleKey, capId);
    return (
      <td key={roleKey} className={styles.mxTd}>
        <button
          type="button"
          className={`${styles.mxCell} ${on ? styles.mxOn : ''}`}
          onClick={() => toggleCap(roleKey, capId, !on)}
          disabled={disabled}
          aria-pressed={on}
          aria-label={on ? 'מורשה — לחץ לביטול' : 'לא מורשה — לחץ להרשאה'}
          data-testid={`mx-${roleKey}-${capId}`}
        >
          {on ? '✓' : ''}
        </button>
      </td>
    );
  };

  // round246 — a tier's cap rows, grouped by component with a SUB-HEADING row
  // per group (shown only when the tier has more than one group).
  const renderGroupedTbody = (roles, caps) => {
    const groups = groupCapabilities(caps);
    const showSub = groups.length > 1;
    return (
      <tbody>
        {groups.map((grp) => (
          <React.Fragment key={grp.group}>
            {showSub && (
              <tr className={styles.mxGroupRow}>
                <td className={styles.mxGroupCell} colSpan={roles.length + 1}>{grp.label}</td>
              </tr>
            )}
            {grp.caps.map((cap) => (
              <tr key={cap.id}>
                <td className={styles.mxAction}>{cap.label}</td>
                {roles.map((role) => renderCell(role.key, cap.id, isRoleHidden(role.key)))}
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    );
  };

  // round246 — a collapsible section header (chevron + title).
  // round332 — the caption arg is gone (owner request), and the head is no longer
  // a bordered box of its own: it is the top of the section CARD (`.mxSec`), so an
  // open table reads as pouring out of its head rather than floating under it.
  const sectionHead = (id, title) => {
    const open = expanded.has(id);
    return (
      <button
        type="button"
        className={`${styles.secHead} ${open ? styles.secHeadOpen : ''}`}
        onClick={() => toggleSection(id)}
        aria-expanded={open}
      >
        <DropdownChevronDown className={`${styles.secChevron} ${open ? '' : styles.secChevronClosed}`} />
        <span className={styles.mxTitle}>{title}</span>
      </button>
    );
  };

  const systemCaps = CAPABILITIES.filter((c) => c.tier === 'system');

  return (
    <div className={styles.root} dir="rtl">
      <div className={styles.matrixScroll}>
        <div className={styles.summaryRow}>
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

        {/* ===== per-tier ✓ matrices (round246 — each COLLAPSED by default,
             cap rows grouped by component with sub-headings) ===== */}
        {TIERS.map((tier) => {
          const roles = tierRoles[tier.id] || [];
          const caps = CAPABILITIES.filter((c) => c.tier === tier.id);
          const open = expanded.has(tier.id);
          // round246 (owner request) — the "שדות משימה" tier no longer shows a
          // view/edit column matrix; instead a plain-language card states the
          // effective rule. (Enforcement is unchanged — see the note.)
          if (tier.id === 'task') {
            return (
              <div key={tier.id} className={styles.mxSec}>
                {sectionHead(tier.id, tier.title)}
                {open && (
                  <div className={styles.taskRuleCard}>
                    <div className={styles.taskRuleLine}>
                      <span className={`${styles.taskRuleBadge} ${styles.badgeCreate}`}>יצירה</span>
                      <span>כל משתמש יכול ליצור משימה — גם ב"המשימות שלי" וגם בתוך דיון.</span>
                    </div>
                    <div className={styles.taskRuleLine}>
                      <span className={`${styles.taskRuleBadge} ${styles.badgeView}`}>צפייה</span>
                      <span>כל מי שנמצא בדיון רואה את משימותיו; ב"המשימות שלי" כל אחד רואה את המשימות שלו/באחריותו.</span>
                    </div>
                    <div className={styles.taskRuleLine}>
                      <span className={`${styles.taskRuleBadge} ${styles.badgeEdit}`}>עריכה</span>
                      <span>יוצר הדיון, מנהל הדיון ומרכז הדיון עורכים כל משימה שנוצרה בדיון; שאר המשתתפים עורכים רק משימות שיצרו או שהם האחראי עליהן.</span>
                    </div>
                  </div>
                )}
              </div>
            );
          }
          if (!roles.length || !caps.length) return null;
          return (
            <div key={tier.id} className={styles.mxSec}>
              {sectionHead(tier.id, tier.title)}
              {open && (
              <>
              <table className={styles.mxTable}>
                <thead>
                  <tr>
                    <th className={styles.mxActionTh} />
                    {roles.map((role) => {
                      const hidden = isRoleHidden(role.key);
                      return (
                        <th key={role.key} className={`${styles.mxRoleTh} ${hidden ? styles.mxRoleHidden : ''}`}>
                          <span className={styles.mxRoleName}>{role.title}</span>
                          <button
                            type="button"
                            className={styles.mxEyeBtn}
                            onClick={() => toggleHidden(role.key)}
                            aria-label={hidden ? 'העמודה מוסתרת — לחץ להצגה' : 'התעלם מהרשאות העמודה'}
                            title={hidden ? 'העמודה מוסתרת — ההרשאות שלה לא נאכפות' : 'התעלם מהרשאות העמודה'}
                          >
                            {hidden ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                {renderGroupedTbody(roles, caps)}
              </table>
              {/* round333 (owner request) — the empty-coordinator/Owners-bypass
                  footnote is GONE. The BEHAVIOUR it described is unchanged and
                  enforced in usePermission's resolver; only the caption left. */}
              </>
              )}
            </div>
          );
        })}

        {/* ===== system tier: Members / Super Members / Owners ===== */}
        <div className={styles.mxSec}>
          {sectionHead('system', 'מערכת (כלל-האפליקציה)')}
          {expanded.has('system') && (
          <table className={styles.mxTable}>
            <thead>
              {/* round333 (owner request) — reading order right-to-left: Owners,
                  then Super Members, then Members. The table is RTL, so DOM order
                  IS the visual right-to-left order; the body cells below follow
                  the same order. */}
              <tr>
                <th className={styles.mxActionTh} />
                <th className={styles.mxRoleTh}><span className={styles.mxRoleName}>Owners</span><small className={styles.mxRoleSmall}>בעלי הלוח</small></th>
                <th className={styles.mxRoleTh}><span className={styles.mxRoleName}>Super Members</span><small className={styles.mxRoleSmall}>חברי-על</small></th>
                <th className={styles.mxRoleTh}><span className={styles.mxRoleName}>Members</span><small className={styles.mxRoleSmall}>כל משתמשי הלוח</small></th>
              </tr>
            </thead>
            <tbody>
              {systemCaps.map((cap) => (
                <tr key={cap.id}>
                  <td className={styles.mxAction}>{cap.label}</td>
                  {/* round333 — Owners first (rightmost), matching the header. */}
                  <td className={styles.mxTd}>
                    <span className={`${styles.mxCell} ${styles.mxOn} ${styles.mxLocked}`} title="בעלי הלוח תמיד מורשים">✓<span className={styles.mxAlways}>תמיד</span></span>
                  </td>
                  {/* Super members = regular members PLUS the two defining caps
                      (locked ✓); every other system cap follows the Members cell. */}
                  <td className={styles.mxTd}>
                    {SUPER_MEMBER_CAPS.has(cap.id)
                      ? <span className={`${styles.mxCell} ${styles.mxOn} ${styles.mxLocked}`} title="יכולת מגדירה של חבר-על — תמיד מורשה">✓<span className={styles.mxAlways}>תמיד</span></span>
                      : <span className={`${styles.mxCell} ${styles.mxInherit}`} title="כמו Members">כמו חברים</span>}
                  </td>
                  {renderCell(SYSTEM_ROLE_KEY, cap.id, false)}
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>

        {/* ===== app roles — user assignment (round219: compact) =====
            round332 — a REAL section like every other: the same collapsible card
            head instead of a bare bold title (owner request). */}
        <div className={styles.mxSec}>
          {sectionHead('roles', 'תפקידי האפליקציה — שיוך משתמשים')}
          {expanded.has('roles') && (
          <div className={styles.appRolesGrid}>
            <div className={styles.appRoleCard}>
              <div className={styles.appRoleHead}><span className={`${styles.appRoleBadge} ${styles.badgeOwner}`}>OWNERS · MEMBERS</span> אנשים בלוח</div>
              <Text type="text3" color="secondary" className={styles.appRoleDesc}>
                בעלי הלוח (כתר) עוקפים את הטבלאות; חברים מקבלים את הרשאות התפקידים.
              </Text>
              <BoardPeoplePicker />
            </div>
            <div className={styles.appRoleCard}>
              <div className={styles.appRoleHead}><span className={`${styles.appRoleBadge} ${styles.badgeSuper}`}>SUPER MEMBERS</span> חברי-על</div>
              <Text type="text3" color="secondary" className={styles.appRoleDesc}>
                חברים + יצירת תבניות והוספת סוגי דיון.
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
        </div>
      </div>
    </div>
  );
}
