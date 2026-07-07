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
  }));
  const mappedIds = new Set(aliasEntries.map((e) => e.columnId).filter(Boolean));
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
// `viewDiscussion` is a discussion cap but is NOT an edit cap — it must never be
// suppressed by the `ready` gate (you can always view).
const VIEW_CAP = 'viewDiscussion';

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

// Same readiness check for a TASK item (My Tasks — no parent discussion in
// ctx): the task's role columns (taskCreatorID/responsibilityID) must have
// loaded before its task caps can resolve; until then edits stay read-only.
function taskReady(item) {
  if (!item) return false;
  const aliases = PERMISSION_ROLE_SOURCES.tasks || [];
  return aliases.some((alias) => Array.isArray(item?.[alias]));
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

// Resolve a CAPABILITY_DEFAULTS fallback bucket against the held-role context.
//   'all'              → every member (allow)
//   'owner'            → owners/admins only (already handled by bypass → deny)
//   'creatorLeadOwner' → creator/lead (owner already bypassed → so creator/lead)
function resolveDefaultBucket(cap, { discussion, myId, isTaskCap, item }) {
  const bucket = CAPABILITY_DEFAULTS[cap];
  if (bucket === 'all') return true;
  if (bucket === 'owner') return false; // owner already bypassed above
  if (bucket === 'creatorLeadOwner') {
    if (isTaskCap) {
      // task tier: the task's own creator / responsible person
      return (
        inPeople(item?.taskCreatorID, myId) ||
        inPeople(item?.responsibilityID, myId)
      );
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
  const isSystemCap = SYSTEM_CAPS.has(capability);
  const isTaskCap = TASK_CAPS.has(capability);
  // Discussion-scoped EDIT caps are gated by `ready`; view & system caps aren't.
  const isReadyGated = !isSystemCap && !isViewCap;

  // 1. Owner bypass — unrestricted. Account admins are NOT auto-bypassed: an
  // admin who wants access makes themselves an OBJECT owner (native subscribers).
  if (canManageSettings) return true;

  // `ready` gate: until the discussion's people columns load we can't know the
  // user's role, so edit caps stay read-only. (Applies in BOTH the fail-open
  // and feature-on paths — preserves the no-flicker invariant.) Task caps in a
  // ctx WITHOUT a discussion (My Tasks) derive readiness from the TASK item
  // instead — its own role columns are the people source being scanned.
  const noDiscussionTaskCtx = isTaskCap && !discussion;
  const ready = isSystemCap
    ? true
    : noDiscussionTaskCtx
      ? taskReady(item)
      : discussionReady(discussion);
  if (isReadyGated && !ready) return false;

  // 2. Feature off / fail-open — reproduce TODAY exactly.
  if (!permissions?.enabled) {
    if (isViewCap) return true; // view is allow-all today
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
    // discussion-content edits AND task edits: today's legacy gate was
    // creator/lead (owner already bypassed). Task tabs threaded the same
    // creator/lead-derived canEdit, so task caps resolve identically.
    // Task caps with NO discussion in ctx (My Tasks) fall back to the task's
    // own creator/responsible — mirrors that surface's self-edit behavior.
    if (noDiscussionTaskCtx) {
      return (
        inPeople(item?.taskCreatorID, myId) ||
        inPeople(item?.responsibilityID, myId)
      );
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
      return resolveDefaultBucket('reorderColumns', { discussion, myId, isTaskCap, item });
    }

    // createDiscussion / manageTemplates: default allow-all. Explicit false now
    // lets an owner turn "everyone can create/manage" OFF; explicit true grants;
    // undefined → CAPABILITY_DEFAULTS (allow-all) → preserves today.
    if (explicit === false) return false; // revoke
    if (explicit === true) return true;
    return CAPABILITY_DEFAULTS[capability] === 'all';
  }

  // An 'all'-default capability (e.g. viewDiscussion) is allowed for every
  // member regardless of which roles they hold — it isn't role-gated. No matrix
  // rows target it, so there is nothing to veto; keep it allow-all.
  if (CAPABILITY_DEFAULTS[capability] === 'all') return true;

  // Which board's people columns apply to this capability's tier.
  const boardKey = isTaskCap ? 'tasks' : 'discussions';

  // The people-source the role's value comes from: for task caps it's the TASK
  // item; for discussion caps it's the discussion.
  const source = isTaskCap ? item : discussion;

  // 4. Role scan with VETO (deny-wins per-role veto, §2.2). Accumulate over the
  //    HELD, NON-HIDDEN roles the user actually has:
  //      - deny  = ANY held non-hidden role sets capabilities[cap] === false
  //      - grant = ANY held non-hidden role sets === true, OR (=== undefined and
  //                the capability default resolves truthy for this user/item)
  //    An explicit `false` in any held role VETOES the grant from other roles.
  //    Hidden roles contribute NOTHING (no grant, no veto).
  let denied = false;
  let granted = false;
  for (const e of boardRoleEntries(boardKey)) {
    if (!inPeople(source?.[e.readId], myId)) continue; // user doesn't hold this role
    const role = roles[e.key];
    if (role?.hidden) continue; // role's column is ignored — contributes nothing
    const explicit = role?.capabilities?.[capability];
    if (explicit === false) {
      denied = true; // explicit revoke — vetoes grants from other held roles
    } else if (explicit === true) {
      granted = true; // explicit grant
    } else if (
      // absent → inherit the capability default, evaluated for this user/item
      resolveDefaultBucket(capability, { discussion, myId, isTaskCap, item })
    ) {
      granted = true;
    }
  }

  // 5. Creator/Lead override — discussion-scoped content caps only (excludes
  //    system AND task caps). Default: override sits ABOVE the veto (creator/lead
  //    immune → ALLOW). Strict mode: override sits BELOW the veto, so a held
  //    role's explicit `false` can revoke them.
  const contentOverride = !isTaskCap && isCreatorOrLead(discussion, myId);
  if (contentOverride) {
    if (!strictCreatorLead) return true; // override wins (today's behavior)
    if (!denied) return true; // strict: only survives if no held role vetoes
    return false;
  }

  // 6. Resolve: granted AND not vetoed.
  return granted && !denied;
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
