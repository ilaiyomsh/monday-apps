/*
 * usePermission — the client-side ADVISORY permission resolver.
 *
 * Feature-on precedence (top wins): owner bypass → ready gate → system caps
 * (from the `system:system` role) → 'all'-default caps → role scan with a
 * deny-wins VETO (an explicit `false` in ANY held non-hidden role vetoes the
 * grant from other held roles; hidden roles contribute nothing) → creator/lead
 * content override (ABOVE the veto by default; BELOW it when
 * `permissions.strictCreatorLead` is true) → default-deny.
 *
 * GOLDEN RULES (see docs/board-permissions-spec.md):
 *  - Advisory only. The app has no server; this is UX guardrails, NOT security.
 *  - Fail-open: while `permissions.enabled` is false the resolver reproduces
 *    TODAY's behavior byte-for-byte (creator/lead/owner edit; everyone else
 *    read-only; view/create/templates open; reorder owners-only).
 *  - Only the board/object OWNER (canManageSettings) bypasses the whole matrix —
 *    always ALLOW. Account admins are NOT auto-bypassed (an admin who wants access
 *    makes themselves an owner via the native subscribers box).
 *  - My Tasks task edits ARE matrix-gated (since 2026-07): the row's task caps
 *    resolve from the TASK's own people columns. There is no discussion in that
 *    ctx, so readiness + the fail-open path fall back to the task item (its
 *    creator/responsible) instead of the discussion — see the isTaskCap
 *    no-discussion branches below. `saveViewDefaults` still gates the toolbar's
 *    Save-view button there.
 *
 * The core resolution is a PURE function `resolveCan(...)` (no React) so it can
 * be unit-tested exhaustively; the hooks (`usePermission`, `usePermissions`)
 * wire it to the React contexts.
 */
import { useContext, useMemo, useSyncExternalStore } from 'react';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { MondayContext } from '@generated/contexts/MondayContext.jsx';
import {
  CAPABILITY_DEFAULTS,
  CAPABILITIES,
  PERMISSION_ROLE_SOURCES,
  CAP_ITEM_SELF_ROLES,
  DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEY,
} from '@api/boards.config.js';
import { getColumns } from '@api/board-config-store.js';
import {
  getPeopleColumns,
  subscribe as subscribePeopleColumns,
  getVersion as getPeopleColumnsVersion,
} from '@api/peopleColumns.js';

/**
 * The people-column "role" entries for a board: the mapped-alias roles
 * (PERMISSION_ROLE_SOURCES, keyed by alias — preserves stored config) PLUS every
 * LIVE people column that isn't one of those aliases (keyed by raw column id).
 * `readId` is the property on the item/discussion carrying that column's people
 * value (the alias for mapped columns, the column id for extra ones — BoardSDK
 * exposes both). Returns [] gracefully when nothing is loaded (unit tests).
 */
function boardRoleEntries(boardKey) {
  const cfg = getColumns(boardKey) || {};
  const aliasEntries = (PERMISSION_ROLE_SOURCES[boardKey] || []).map((alias) => ({
    key: `${boardKey}:${alias}`,
    readId: alias,
    columnId: cfg[alias]?.id,
    // Multi-column people alias (`ids`, e.g. tasks.taskViewersID): every mapped
    // column belongs to this ONE role — mapItem merges their people under the
    // alias, and listing them here keeps them out of the raw-id extras below.
    columnIds: [cfg[alias]?.id, ...(Array.isArray(cfg[alias]?.ids) ? cfg[alias].ids : [])].filter(Boolean),
  }));
  const mappedIds = new Set(aliasEntries.flatMap((e) => e.columnIds));
  const extraEntries = getPeopleColumns(boardKey)
    .filter((col) => !mappedIds.has(col.id))
    .map((col) => ({ key: `${boardKey}:${col.id}`, readId: col.id, columnId: col.id }));
  return [...aliasEntries, ...extraEntries];
}

// Capability ids that are GLOBAL (system tier) — not bound to a discussion/task.
const SYSTEM_CAPS = new Set(
  CAPABILITIES.filter((c) => c.tier === 'system').map((c) => c.id)
);
// Capability ids that act on a specific TASK (task tier).
const TASK_CAPS = new Set(
  CAPABILITIES.filter((c) => c.tier === 'task').map((c) => c.id)
);
// Capability ids that act on a specific DECISION (decision tier) — resolve
// exactly like the task tier, from the DECISION item's own people columns
// (PERMISSION_ROLE_SOURCES.decisions: decisionCreatorID/deciderID).
const DECISION_CAPS = new Set(
  CAPABILITIES.filter((c) => c.tier === 'decision').map((c) => c.id)
);
// (Item 13's single-person-roles-only restriction on editSummary was REMOVED in
// round212: the permissions matrix table gives owners full ✓ control, so a grant
// on ANY held role — participants included — now counts for the summary write.)
// `viewDiscussion` is a discussion cap but is NOT an edit cap — it must never be
// suppressed by the `ready` gate (you can always view).
const VIEW_CAP = 'viewDiscussion';
// round209 — per-role VIEW gates for the triple-box panes (התייחסויות / סיכום).
// View-like: never ready-gated, allow-all while the feature is off, and the two
// viewDiscussion safety valves apply. Their CAPABILITY_DEFAULTS bucket is 'all'
// but they deliberately SKIP the 'all' short-circuit so an explicit `false` on
// a held role (e.g. the owner unchecking participants) actually hides the pane;
// existing stored role maps that lack these keys inherit the default → visible.
const BOX_VIEW_CAPS = new Set(['viewReferencesBox', 'viewSummaryBox']);

// True when `myId` appears in a monday people-column value (array of {id}).
function inPeople(arr, myId) {
  return Array.isArray(arr) && !!myId && arr.some((p) => String(p?.id) === myId);
}

// Has the discussion's people columns loaded yet? While they're undefined we
// can't know the user's role, so edit caps must degrade to read-only (preserve
// the no-flicker invariant from DiscussionCard). A discussion is "ready" once at
// least one of its role columns is an array (even empty) — i.e. details merged.
function discussionReady(discussion) {
  if (!discussion) return false;
  const aliases = PERMISSION_ROLE_SOURCES.discussions || [];
  return aliases.some((alias) => Array.isArray(discussion?.[alias]));
}

// Same readiness check for an ITEM-tier object (task / decision) in a ctx
// WITHOUT a parent discussion: the item's own role columns
// (taskCreatorID/responsibilityID or decisionCreatorID/deciderID) must have
// loaded before its caps can resolve; until then edits stay read-only.
function itemReady(item, itemBoardKey) {
  if (!item) return false;
  const aliases = PERMISSION_ROLE_SOURCES[itemBoardKey] || [];
  return aliases.some((alias) => Array.isArray(item?.[alias]));
}

// Does the user hold one of the ITEM's own role columns (task
// creator/responsible, decision creator/decider)? The item-tier analogue of
// isCreatorOrLead — drives the fail-open self-edit path and the
// 'creatorLeadOwner' default bucket for item-tier caps.
//
// round305 — a capability listed in CAP_ITEM_SELF_ROLES narrows the scan to the
// roles its owner spec names (e.g. editTaskPartners must NOT reach the read-only
// taskViewersID role), and may additionally accept the parent DISCUSSION's
// lead/coordinator/creator, which a personal-view row carries under
// `__discussionRoles` (there is no discussion object in that ctx).
function isItemSelfRole(item, itemBoardKey, myId, capability = null) {
  const rule = capability ? CAP_ITEM_SELF_ROLES[capability]?.[itemBoardKey] : null;
  const aliases = rule?.selfRoles || PERMISSION_ROLE_SOURCES[itemBoardKey] || [];
  if (aliases.some((alias) => inPeople(item?.[alias], myId))) return true;
  if (rule?.parentDiscussionEditors && isCreatorOrLead(item?.__discussionRoles, myId)) return true;
  return false;
}

// Is the user a discussion "editor" — its creator, lead (מנהל דיון), or
// coordinator (מרכז דיון)? These three people columns all confer full
// discussion-content edit (the coordinator was added to edit like the lead).
function isCreatorOrLead(discussion, myId) {
  return (
    inPeople(discussion?.discussionCreatorID, myId) ||
    inPeople(discussion?.discussionLeadID, myId) ||
    inPeople(discussion?.discussionCoordinatorID, myId)
  );
}

// round147 — "חברי-על" (owner spec 2026-07-17): a super member is a regular
// user plus exactly TWO extra abilities — adding discussion types and managing
// topic templates. Nothing else: no content-edit bypass, no other system caps,
// no settings access. The list lives on the permissions blob
// (permissions.superMembers, entries {id, name} or bare ids) and is honored in
// BOTH permission modes, so the grant sits above the fail-open/feature-on fork
// and above the matrix (an explicit system-role revoke does not strip a super
// member of the two defining caps — remove them from the list instead).
const SUPER_MEMBER_CAPS = new Set(['addDiscussionTypes', 'manageTemplates']);

export function isSuperMember(permissions, userId) {
  const id = String(userId ?? '');
  if (!id) return false;
  const list = permissions?.superMembers;
  return Array.isArray(list) && list.some((p) => String(p?.id ?? p) === id);
}

// Resolve a CAPABILITY_DEFAULTS fallback bucket against the held-role context.
//   'all'              → every member (allow)
//   'owner'            → owners/admins only (already handled by bypass → deny)
//   'creatorLeadOwner' → creator/lead (owner already bypassed → so creator/lead)
function resolveDefaultBucket(cap, { discussion, myId, itemBoardKey, item }) {
  const bucket = CAPABILITY_DEFAULTS[cap];
  if (bucket === 'all') return true;
  if (bucket === 'owner') return false; // owner already bypassed above
  if (bucket === 'creatorLeadOwner') {
    if (itemBoardKey) {
      // item tier (task/decision): the item's own role columns — task
      // creator/responsible, decision creator/decider (narrowed per capability
      // by CAP_ITEM_SELF_ROLES; round305).
      return isItemSelfRole(item, itemBoardKey, myId, cap);
    }
    return isCreatorOrLead(discussion, myId);
  }
  return false;
}

/**
 * Pure resolver. Returns a boolean ALLOW/DENY for `capability` in `ctx`.
 *
 * @param {string} capability
 * @param {object} ctx           { boardKey, item, discussion, currentUserId }
 * @param {object} opts
 * @param {object} opts.permissions       settings.permissions blob (or DEFAULT_PERMISSIONS)
 * @param {boolean} opts.canManageSettings board/object OWNER (the only bypass)
 */
export function resolveCan(capability, ctx = {}, opts = {}) {
  const {
    permissions = DEFAULT_PERMISSIONS,
    canManageSettings = false,
  } = opts;
  const { discussion, item } = ctx;
  const myId = String(ctx.currentUserId ?? '');

  const isViewCap = capability === VIEW_CAP;
  const isBoxViewCap = BOX_VIEW_CAPS.has(capability);
  const isSystemCap = SYSTEM_CAPS.has(capability);
  const isTaskCap = TASK_CAPS.has(capability);
  const isDecisionCap = DECISION_CAPS.has(capability);
  // ITEM-tier caps (task / decision) resolve from the ITEM's own people columns;
  // itemBoardKey names the board whose role sources apply (null = discussion tier).
  const itemBoardKey = isTaskCap ? 'tasks' : isDecisionCap ? 'decisions' : null;
  // Discussion-scoped EDIT caps are gated by `ready`; view & system caps aren't.
  const isReadyGated = !isSystemCap && !isViewCap && !isBoxViewCap;

  // 1. Owner bypass — unrestricted. Account admins are NOT auto-bypassed: an
  // admin who wants access makes themselves an OBJECT owner (native subscribers).
  if (canManageSettings) return true;

  // 1b. Super-member grant (round147) — see SUPER_MEMBER_CAPS above.
  if (SUPER_MEMBER_CAPS.has(capability) && isSuperMember(permissions, myId)) return true;

  // `ready` gate: until the discussion's people columns load we can't know the
  // user's role, so edit caps stay read-only. (Applies in BOTH the fail-open
  // and feature-on paths — preserves the no-flicker invariant.) Item-tier caps
  // (task / decision) in a ctx WITHOUT a discussion (My Tasks / My Decisions)
  // derive readiness from the ITEM instead — its own role columns are the
  // people source being scanned.
  const noDiscussionItemCtx = !!itemBoardKey && !discussion;
  const ready = isSystemCap
    ? true
    : noDiscussionItemCtx
      ? itemReady(item, itemBoardKey)
      : discussionReady(discussion);
  if (isReadyGated && !ready) return false;

  // 2. Feature off / fail-open — reproduce TODAY exactly.
  if (!permissions?.enabled) {
    if (isViewCap) return true; // view is allow-all today
    if (isBoxViewCap) return true; // the boxes were visible to every viewer today
    // DOCS-export ran UNGATED today (any user seeing the row/chip could export).
    // The consumers now gate via can('exportDocs'), so the fail-open path MUST
    // return true here — otherwise a non-creator/lead/owner participant would
    // lose the export control they have today on every existing (enabled:false)
    // instance. Keep this byte-for-byte with today's ungated behavior.
    if (capability === 'exportDocs') return true;
    if (isSystemCap) {
      if (capability === 'reorderColumns') return false; // owners only (bypassed above)
      if (capability === 'addDiscussionTypes') return false; // owners only (bypassed above)
      if (capability === 'saveViewDefaults') return false; // owners only (bypassed above)
      // createDiscussion / manageTemplates were allow-all today.
      return true;
    }
    // discussion-content edits AND task/decision edits: today's legacy gate was
    // creator/lead (owner already bypassed). Task tabs threaded the same
    // creator/lead-derived canEdit, so item caps resolve identically.
    // Item caps with NO discussion in ctx (My Tasks / My Decisions) fall back
    // to the item's own role columns (task creator/responsible, decision
    // creator/decider) — mirrors those surfaces' self-edit behavior.
    if (noDiscussionItemCtx) {
      return isItemSelfRole(item, itemBoardKey, myId, capability);
    }
    return isCreatorOrLead(discussion, myId);
  }

  // ---- feature ON ----------------------------------------------------------

  const roles = permissions?.roles || {};
  // When strict, an explicit `false` on a role the creator/lead ALSO holds can
  // revoke them (the creator/lead override moves BELOW the veto). Default off
  // keeps the override ABOVE the veto — creator/lead stay immune, as today.
  const strictCreatorLead = !!permissions?.strictCreatorLead;

  // 3. SYSTEM caps — driven by the synthetic `system:system` role's capabilities
  //    (§2.1). Every user "holds" this global pseudo-role; a hidden system role
  //    (defensive — the UI forbids hiding it) makes all system caps fall to
  //    their CAPABILITY_DEFAULTS. Explicit true grants, explicit false denies
  //    (revoke), undefined → default.
  if (isSystemCap) {
    const systemRole = roles[SYSTEM_ROLE_KEY];
    const explicit = systemRole?.hidden ? undefined : systemRole?.capabilities?.[capability];

    if (capability === 'reorderColumns') {
      // Board-structural: baseline owners-only (owners already bypassed above).
      // A checkbox `true` opens it to members (holders of a non-hidden discussion
      // role on THIS discussion); `false` keeps it closed; undefined → default
      // 'owner' bucket → closed. Never grant to non-members even when checked.
      if (explicit === false) return false; // revoke
      if (explicit === true) {
        return boardRoleEntries('discussions').some(
          (e) => !roles[e.key]?.hidden && inPeople(discussion?.[e.readId], myId)
        );
      }
      // undefined → owners-only default (owners already bypassed → deny).
      return resolveDefaultBucket('reorderColumns', { discussion, myId, itemBoardKey, item });
    }

    // createDiscussion / manageTemplates: default allow-all. Explicit false now
    // lets an owner turn "everyone can create/manage" OFF; explicit true grants;
    // undefined → CAPABILITY_DEFAULTS (allow-all) → preserves today.
    if (explicit === false) return false; // revoke
    if (explicit === true) return true;
    return CAPABILITY_DEFAULTS[capability] === 'all';
  }

  // An 'all'-default capability is allowed for every member regardless of
  // which roles they hold — it isn't role-gated. The box-view caps are the
  // exception (round209): their 'all' default flows through the ROLE SCAN as a
  // default grant instead, so an explicit `false` on a held role can revoke it.
  if (CAPABILITY_DEFAULTS[capability] === 'all' && !isBoxViewCap) return true;

  // Item 20 (2026-07-14) — viewDiscussion is now ROLE-GATED (participants view
  // via the seed; strangers are denied by the scan below). Two safety valves
  // keep it permissive where denial would be wrong:
  //   (a) people columns not loaded yet → allow (never flash "no access");
  //   (b) roles map has no discussions:* rows (owner never opened the
  //       permissions tab, so the seed was never written) → keep the historic
  //       allow-all instead of locking every member out.
  if (isViewCap || isBoxViewCap) {
    if (!discussionReady(discussion)) return true;
    if (!Object.keys(roles).some((k) => k.startsWith('discussions:'))) return true;
  }

  // Which board's people columns apply to this capability's tier.
  const boardKey = itemBoardKey || 'discussions';

  // The people-source the role's value comes from: for item-tier caps (task /
  // decision) it's the ITEM; for discussion caps it's the discussion.
  const source = itemBoardKey ? item : discussion;

  // 4. Role scan with UNION semantics (owner decision 2026-07-14). Accumulate
  //    over the HELD, NON-HIDDEN roles the user actually has:
  //      - explicitGrant = ANY held non-hidden role sets capabilities[cap] === true
  //      - deny          = ANY held non-hidden role sets === false
  //      - defaultGrant  = ANY held non-hidden role leaves it undefined AND the
  //                        capability default resolves truthy for this user/item
  //    An explicit GRANT from any held role WINS — holding an additional,
  //    weaker role never subtracts an explicitly-granted ability. An explicit
  //    `false` only vetoes INHERITED (default-bucket) grants. Rationale: the
  //    PermissionsTab writes explicit false for every UNCHECKED box, so the old
  //    deny-wins veto collapsed multi-role users to the INTERSECTION of their
  //    roles' checkboxes (e.g. a decision creator also listed under "מושפעים"
  //    lost editDecisionAffected). Hidden roles contribute NOTHING.
  let denied = false;
  let explicitGranted = false;
  let defaultGranted = false;
  for (const e of boardRoleEntries(boardKey)) {
    if (!inPeople(source?.[e.readId], myId)) continue; // user doesn't hold this role
    const role = roles[e.key];
    if (role?.hidden) continue; // role's column is ignored — contributes nothing
    const explicit = role?.capabilities?.[capability];
    if (explicit === false) {
      denied = true; // explicit revoke — vetoes DEFAULT grants only
    } else if (explicit === true) {
      explicitGranted = true; // explicit grant — immune to other roles' revokes
    } else if (
      // absent → inherit the capability default, evaluated for this user/item
      resolveDefaultBucket(capability, { discussion, myId, itemBoardKey, item })
    ) {
      defaultGranted = true;
    }
  }

  // 5. Creator/Lead override — discussion-scoped content caps only (excludes
  //    system AND item-tier caps). Default: creator/lead are immune → ALLOW.
  //    Strict mode drops the override and resolves them through the same role
  //    scan as everyone else (their held role's explicit `false` still revokes,
  //    since no explicit grant remains to win the union).
  const contentOverride = !itemBoardKey && isCreatorOrLead(discussion, myId);
  if (contentOverride && !strictCreatorLead) return true;

  // Item 21 (2026-07-14): the discussion's single-person manager roles (מנהל
  // דיון / מרכז דיון) may EDIT any decision of their discussion — delete stays
  // with the roles the matrix grants it to. Applies only when the decision is
  // resolved WITH its parent discussion in ctx (the in-discussion tab).
  if (
    itemBoardKey === 'decisions' &&
    capability !== 'deleteDecision' &&
    (inPeople(discussion?.discussionLeadID, myId) || inPeople(discussion?.discussionCoordinatorID, myId))
  ) {
    return true;
  }

  // round249 (owner approval 2026-07-23) — the discussion's creator / lead
  // (מנהל דיון) / coordinator (מרכז דיון) may EDIT any TASK of their discussion,
  // mirroring the decision override above and matching the permissions-screen
  // rule card (round246): "edit = discussion creator / manager / coordinator /
  // task owner". The task OWNER (responsible) is already covered by the item's
  // own role scan; this adds the discussion roles. Delete (deleteTask) stays
  // with the matrix / task owner. Applies only when the task is resolved WITH
  // its parent discussion in ctx (the in-discussion Tasks tab); My-Tasks (no
  // discussion) is unaffected.
  if (
    itemBoardKey === 'tasks' &&
    capability !== 'deleteTask' &&
    isCreatorOrLead(discussion, myId)
  ) {
    return true;
  }

  // round305 — the same discussion-roles override for a capability that opted in
  // (CAP_ITEM_SELF_ROLES[cap][board].parentDiscussionEditors) when the row is
  // resolved WITHOUT its discussion in ctx: the personal "בדיונים שהובלתי" list
  // carries the parent's lead/coordinator/creator on the row itself. The role scan
  // above cannot reach it — a user holding none of the TASK's own people columns
  // never enters the loop — so it is checked here, next to its sibling override.
  if (
    itemBoardKey &&
    CAP_ITEM_SELF_ROLES[capability]?.[itemBoardKey]?.parentDiscussionEditors &&
    isCreatorOrLead(item?.__discussionRoles, myId)
  ) {
    return true;
  }

  // 6. Resolve: an explicit grant wins outright; otherwise inherited defaults
  //    survive only when no held role explicitly revokes.
  return explicitGranted || (defaultGranted && !denied);
}

/**
 * usePermission — returns a stable `can(capability, ctx)` bound to the live
 * settings + monday context. `ctx` typically supplies { discussion } and/or
 * { item } (the task); currentUserId defaults to the current user.
 *
 * @param {object} extra { canManageSettings?, currentUser? } overrides for
 *   callers (DiscussionList) that receive these as props instead of via context.
 */
export function usePermission(extra = {}) {
  const { permissions } = useSettings();
  // Read MondayContext SOFTLY (useContext, not useMondayContext) so the hook
  // also works in surfaces that intentionally render without a MondayProvider
  // (DiscussionList in isolation / unit tests). Those callers pass `currentUser`
  // and `canManageSettings` as props instead.
  const ctxApi = useContext(MondayContext);
  const context = ctxApi?.context;
  const currentUser = extra.currentUser ?? ctxApi?.currentUser;

  const canManageSettings = !!extra.canManageSettings;
  const defaultUserId = String(currentUser?.id ?? context?.user?.id ?? '');

  // Re-evaluate when the live people columns load (extra roles beyond the mapped
  // aliases) so gates that depend on an unmapped people column resolve correctly.
  const peopleColumnsVersion = useSyncExternalStore(
    subscribePeopleColumns,
    getPeopleColumnsVersion,
    getPeopleColumnsVersion
  );

  return useMemo(() => {
    const can = (capability, ctx = {}) =>
      resolveCan(
        capability,
        { currentUserId: defaultUserId, ...ctx },
        { permissions, canManageSettings }
      );
    return can;
  }, [permissions, canManageSettings, defaultUserId, peopleColumnsVersion]);
}

/**
 * useIsSuperMember — is the CURRENT user on the instance's super-members list
 * (round147)? Drives super-only entry points (the templates-only settings
 * gear); the capability checks themselves go through `can(...)` as usual.
 */
export function useIsSuperMember(extra = {}) {
  const { permissions } = useSettings();
  const ctxApi = useContext(MondayContext);
  const currentUser = extra.currentUser ?? ctxApi?.currentUser;
  const id = String(currentUser?.id ?? ctxApi?.context?.user?.id ?? '');
  return isSuperMember(permissions, id);
}

/**
 * usePermissions — convenience for a single discussion. Returns:
 *   - `can(capability, ctx?)` — defaults ctx.discussion to this discussion
 *   - `ready` — whether the discussion's people columns have loaded
 *   - `canEdit` — COARSE single boolean (creator/lead-or-better edit gate) used
 *     to keep Phase-1 behavior byte-for-byte identical to today. Derived from
 *     `editDiscussionFields`, the representative discussion-edit capability.
 */
export function usePermissions(discussion, extra = {}) {
  const can = usePermission(extra);
  const ready = discussionReady(discussion);

  return useMemo(() => {
    const bound = (capability, ctx = {}) => can(capability, { discussion, ...ctx });
    // Coarse boolean: the single edit gate today's UI threads through as
    // `canEdit`. Use editDiscussionFields as the representative content-edit cap
    // (in the fail-open path every content edit resolves identically, so any
    // edit cap yields the same boolean).
    const canEdit = bound('editDiscussionFields');
    return { can: bound, ready, canEdit };
  }, [can, discussion, ready]);
}

export default usePermission;
