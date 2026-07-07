# Board-permissions enforcement — agent reference

**Audience:** a future code agent about to change the discussions app's permissions.
**Golden rule before you touch anything:** this is **client-side ADVISORY gating only**
(no server; UX guardrails, not a security boundary). While `settings.permissions.enabled === false`
the behavior is **byte-for-byte identical to today**. Do not assume a checkbox in the UI
actually enforces anything — several are decorative today (see §3).

All line refs are current-state anchors. Primary files:

- `src/hooks/usePermission.js` — the resolver (`resolveCan`) + hooks.
- `src/utils/mondayApi/boards.config.js` — the capability catalog, defaults, role sources, seed.
- `src/utils/mondayApi/peopleColumns.js` — live people-column store (dynamic roles).
- `src/components/SettingsModal/PermissionsTab.jsx` — the owner-facing matrix UI.
- `src/contexts/SettingsContext.jsx` — persistence / `updateSettings` deep-merge.
- `src/App.jsx` — `canManageSettings` (owner-only bypass) computation.
- `src/components/DiscussionCard/DiscussionCard.jsx`, `DiscussionList.jsx`, and the tab/table
  components — the `can()` consumers.
- `docs/board-permissions-spec.md` — the stated design intent (spec).
- `docs/sdk-instance-contexts.md` — object vs data-board rule.

---

## 1. Mental model

### Roles = people columns
A **role** is a monday **people column** on a data board. A user *holds* a role when their user id
appears in that column's value on the relevant item. There is no separate role registry — roles are
derived from board columns.

Role **tiers** map to the app's three board scopes:
- `disc` (tier `discussion`) — read from the **discussion** item's people columns.
- `task` — read from the **task** item's people columns.
- `system` (labelled **כללי** in the UI) — a synthetic global pseudo-role, **not** a people column.

Role sources per board (`PERMISSION_ROLE_SOURCES`, `boards.config.js:147-150`):
- `discussions`: `discussionCreatorID`, `discussionLeadID`, `participantsID`
- `tasks`: `taskCreatorID`, `responsibilityID`
- `topics`: none (topics inherit the parent discussion's gate)

### Capabilities
A **capability** is an atomic action (e.g. `editDiscussionFields`, `deleteTask`, `createDiscussion`).
The full catalog is `CAPABILITIES` (`boards.config.js:114-138`); each entry has `id`, `tier`
(`discussion`/`task`/`system`), `group`, and a Hebrew `label`. A role grants a set of capabilities.

### The OBJECT vs the mapped DATA boards
Two distinct notions of "board" — do not conflate them:

- **The OBJECT = `context.boardId`.** The app-instance host container (the board a `board_view`
  is embedded on, or the object itself for a custom object view). **Owners/members/subscribers are a
  property of this object.** This is who "owns the app instance." See `docs/sdk-instance-contexts.md:6-11`.
- **The mapped DATA boards = `settings.boards.discussions/tasks/topics.id`.** The three domain
  boards the app reads/writes via the alias mapping. Unrelated to app-instance ownership.

Trap (`docs/sdk-instance-contexts.md:28-30`): on a board_view the object's `context.boardId`
*coincidentally equals* `settings.boards.discussions.id`. On a custom object they differ. Always key
ownership/membership off `context.boardId`, never the data board.

### Owner-only bypass (admins are NOT bypassed)
`canManageSettings` is the single unrestricted bypass in the resolver (`usePermission.js:137`).
It is computed in `App.jsx` (`checkBoardOwnership`, `App.jsx:251-311`) as: is the current user an
**owner of `context.boardId`** (`App.jsx:294-296`).

- **Account admins are NOT auto-bypassed** (`App.jsx:255-257`). An admin who wants access adds
  themselves as an owner via native board subscribers. `context.user.isAdmin` is read for roster
  purposes (`App.jsx:320`) but never feeds `canManageSettings`.
- The owner check **fails closed but loud**: one bounded retry (`App.jsx:288-292`), and only a second
  failure sets `false` + logs an error — a flaky network won't silently strip an owner's access.
- `canManageSettings` is threaded into `DiscussionCard` (`App.jsx:646`), `MyTasksView` (`App.jsx:567`),
  and the resolver. It is passed to the hook **only via the `extra` prop** — never read from context
  inside the hook (`usePermission.js:229`).

Object membership is managed by `BoardPeoplePicker.jsx`, keyed on `context.boardId`
(`BoardPeoplePicker.jsx:75-80`), via `subscribers.js` (`setBoardMembers`, `removeBoardMembers`,
`addEveryoneTeam`, `inviteUsersToAccount`). Caveat: `board team_subscribers` is unauthorized for this
app's scope, so the picker can only *add* the Everyone team, not read its state
(`BoardPeoplePicker.jsx:28-29`).

### Dynamic people-column roles (`peopleColumns.js`) + the `hidden` flag
Roles are **dynamic from the live board people columns**, not a static list:

- Mapped columns keep their **alias** key (e.g. `discussions:discussionLeadID`).
- Unmapped live people columns (e.g. "רשם דיון") are keyed by their **raw column id**
  (`discussions:<colId>`).
- `boardRoleEntries(boardKey)` (`usePermission.js:42-54`) merges alias entries (from
  `PERMISSION_ROLE_SOURCES` + settings config) with **extra** entries — every live people column
  whose id is not already a mapped alias id. Each entry carries `readId` (the property to read the
  people value off the item: alias for mapped, column id for extras).
- Backed by `peopleColumns.js`: a module singleton loaded once by `ensurePeopleColumns()`, querying
  `boards(ids){ columns{ id title type } }` for the role boards, keeping only people-type columns.
  A `useSyncExternalStore` subscription re-evaluates gates when columns load
  (`usePermission.js:234-238`).

**`hidden` flag** — a per-role boolean meaning "the runtime resolver **ignores this people column
entirely**, as if it weren't a role source." Two checks, both in the resolver:
- System-cap membership test: `!roles[e.key]?.hidden && inPeople(...)` (`usePermission.js:176`).
- Additive loop: `if (role?.hidden) continue;` (`usePermission.js:195`) — skipped before its
  capabilities are read (no grant, no default inheritance).
The ready gate and creator/lead override do **not** consult `hidden`.

---

## 2. The resolution algorithm (`resolveCan`, exactly as it runs)

Signature: `resolveCan(capability, ctx = {}, opts = {})` (`usePermission.js:121`).
- `opts`: `{ permissions = DEFAULT_PERMISSIONS, canManageSettings = false }` (`:122-125`) — fail-open defaults.
- `ctx`: `{ discussion, item, currentUserId }`; `myId = String(ctx.currentUserId ?? '')` — always a
  string (all id compares stringify, `:70`; empty string never matches — `inPeople` requires truthy `myId`).

Capability classification (`:129-133`):
- `isViewCap` = capability is `'viewDiscussion'`.
- `isSystemCap` = capability's tier is `system` (`createDiscussion`, `reorderColumns`, `manageTemplates`).
- `isTaskCap` = capability's tier is `task`.
- `isReadyGated = !isSystemCap && !isViewCap` — i.e. discussion-scoped **edit** caps only.

Branches, in order:

### Step 0 — Owner bypass (`:135-137`)
```
if (canManageSettings) return true;
```
Unconditional ALLOW, **before** the ready gate and **before** the enabled check. Admins are not
auto-bypassed (they must be object owners).

### Step 1 — Ready gate (`:139-143`)
```
const ready = isSystemCap ? true : discussionReady(discussion);
if (isReadyGated && !ready) return false;
```
System caps are never gated (`ready` forced true). `viewDiscussion` is excluded via `isReadyGated`.
Only discussion-scoped edit caps DENY while the discussion's people columns are unloaded.
`discussionReady` (`:77-81`) returns true once at least one `PERMISSION_ROLE_SOURCES.discussions`
alias on the discussion is an **array** (even empty); null discussion → false. This preserves the
DiscussionCard no-flicker invariant, in **both** the fail-open and feature-on paths.

### Step 2 — Feature OFF / fail-open (`:145-157`), guarded by `if (!permissions?.enabled)`
Reproduces today's behavior byte-for-byte:
- View cap → `return true` (allow-all today).
- System caps: `reorderColumns` → `return false` (owners only, already bypassed above); everything
  else (`createDiscussion` / `manageTemplates`) → `return true` (allow-all today).
- Fallthrough — all discussion-content edits AND task edits → `return isCreatorOrLead(discussion, myId)`
  (`:156`). `isCreatorOrLead` (`:84-89`) = user is in `discussionCreatorID` OR `discussionLeadID`.

### Feature ON (everything below `:159`)

### Step 3 — Creator/Lead override (`:161-164`)
```
if (!isSystemCap && !isTaskCap && isCreatorOrLead(discussion, myId)) return true;
```
**Discussion-scoped content caps ONLY** — excludes system AND task caps. So a discussion creator/lead
is auto-allowed every discussion-content edit even feature-on. **Consequence: their checkboxes in the
matrix are irrelevant** for discussion content — they're always allowed regardless.

### System caps under feature-on (`:169-178`), inside `if (isSystemCap)`
- `CAPABILITY_DEFAULTS[capability] === 'all'` → `return true` (`createDiscussion`, `manageTemplates`).
- `reorderColumns` → `return false` (owners only).
- Otherwise: grant iff the user holds ANY **non-hidden** role column on the **current discussion**
  (`:175-177`). System caps always resolve against `'discussions'` role columns.

> **Important:** this branch never reads `roles['system:system'].capabilities`. The `system:system`
> pseudo-role's capability map is **dead config** (see §3).

### 'all'-default short-circuit for non-system caps (`:180-182`)
```
if (CAPABILITY_DEFAULTS[capability] === 'all') return true;
```
E.g. `viewDiscussion` — allowed for every member, not role-gated.

### Step 4 — Additive role union (`:184-205`)
- `boardKey = isTaskCap ? 'tasks' : 'discussions'`; `source = isTaskCap ? item : discussion`.
- Loop over `boardRoleEntries(boardKey)`:
  1. `if (!inPeople(source?.[e.readId], myId)) continue;` — skip roles the user doesn't hold.
  2. `if (role?.hidden) continue;` — hidden roles contribute nothing.
  3. `explicit = role?.capabilities?.[capability]`:
     - `=== true` → `return true`.
     - `=== undefined` → inherit via `resolveDefaultBucket(...)`; if truthy → `return true`.
     - `=== false` → **NOT a revoke.** The loop keeps scanning other held roles.

### Step 5 — Default-deny (`:207-208`)
`return false` (read-only) if no held role granted it.

### `CAPABILITY_DEFAULTS` buckets (`resolveDefaultBucket`, `:91-110`; catalog `boards.config.js:81-104`)
Reached only from the additive loop when a held role leaves the cap `undefined`. Buckets:
- `'all'` → `true` (every member). Caps: `viewDiscussion`, `createDiscussion`, `manageTemplates`.
- `'owner'` → `false` (owners already bypassed at step 0, so nobody else qualifies). Cap: `reorderColumns`.
- `'creatorLeadOwner'` → for task caps: task's own creator/responsible (`taskCreatorID`/`responsibilityID`);
  else: discussion creator/lead. This is **all** discussion-content edits + all task edits.
- Unknown bucket → `false`.

Evaluated **per user/item**, not a blanket allow.

---

## 3. CURRENT enforcement reality vs intent — READ THIS

The spec (`docs/board-permissions-spec.md`) describes a richer intent. The **current code** diverges
in ways that make several UI checkboxes misleading. Do not assume a checkbox enforces anything.

### 3a. Additive only — there is NO revoke path
`resolveCan` is additive: an explicit `false` in a role's `capabilities` is **not** a revoke — it only
fails to grant (`:204`, comment). Any single held role granting the cap wins.
**Unchecking a box does not restrict access.** There is no way today to take a capability away from a
user who holds another granting role (or who is creator/lead, or an owner). Matches the spec's
"explicit false is NOT a revoke" rule — but engineers routinely expect unchecking to deny. It does not.

### 3b. System-tier caps are NOT enforced from `system:system`
The three כללי checkboxes (`createDiscussion`, `manageTemplates`, `reorderColumns`) do **not** read
`roles['system:system'].capabilities`. The `isSystemCap` branch (`:169-178`) resolves them purely by:
- `createDiscussion`, `manageTemplates` → `CAPABILITY_DEFAULTS === 'all'` → allow-everyone.
- `reorderColumns` → hardcoded owners-only (`return false` for non-owners).

**=> All 3 "כללי" checkboxes are decorative.** Any capabilities stored on a system role are dead config.

### 3c. `exportDocs` has a checkbox but NO consumer
There is **no `can('exportDocs')` call anywhere.** The DOCS-export/duplicate actions
(`App.handleExport`, the EventChip `onExport`, `DiscussionList.jsx:330-331` `onDuplicate`/`onExport`)
run **ungated**. Toggling `exportDocs` grants/blocks nothing.

### 3d. `viewDiscussion` has NO consumer
Never called via `can('viewDiscussion')`. The resolver always returns `true` for it. Dead cap; the app
has no view gate.

### 3e. `editResponses` is DECORATIVE (wired but no-op)
`canEditResponses` (and `onUpdateResponses`) is threaded `DiscussionCard → TopicsTab → TopicPointRow`,
but `TopicPointRow` never destructures or uses it, and the redesigned Topics table (point·נידונה·avatar)
renders no responses cell. The cap and handler die unused at the leaf. Zero observable effect.

### 3f. Creator/lead override makes their content checkboxes irrelevant
Creator/lead get a HARDCODED allow for discussion-content caps (`:161-164`). Their matrix checkboxes
for those caps never affect the outcome. Other roles (e.g. `participantsID`) are denied content edits
only because the **default** bucket is `creatorLeadOwner` — not because a box is unchecked.

**Genuinely enforced today:** the discussion-content edit caps (`editDiscussionFields`, `editSummary`,
`addTopicOrPoint`, `editTopicOrPoint`, `deleteTopicOrPoint`, `checkPoint`), `createTask`, all six task
caps, `createDiscussion` (via the list buttons), `reorderColumns` (owners-only), `manageTemplates`.
All enforcement is **advisory** (client-side, no server) per `usePermission.js:1-12`.

---

## 4. Where enforcement is consumed

`usePermission()` (`usePermission.js:219`) returns `can(cap, ctx)`. `usePermissions(discussion, extra)`
(`:259-272`) wraps it: auto-fills `ctx.discussion`, exposes `ready`, and the coarse
`canEdit = bound('editDiscussionFields')` (`:269`) — the legacy single edit boolean.

`DiscussionCard.jsx:83-103` resolves discussion/system caps into named booleans and a per-task
`canTask(cap, task)` closure (`:96`), then threads them as props. `DiscussionList.jsx:284-292`
independently resolves row-level + system caps. **Leaf enforcement pattern:** withhold the mutation
handler (renders read-only) and/or hide the control.

| Capability | Key consumer(s) | Enforced? |
|---|---|---|
| `viewDiscussion` | none | NO — dead cap |
| `editDiscussionFields` | coarse `canEdit`; `DiscussionCard:144,156,217`; `DiscussionList:286→329,332,492,495`; `PreviousTasksTab:821` | yes |
| `editSummary` | `DiscussionCard:83 → SummaryTab:28→111,112,117` (TipTap `editable=false`) | yes |
| `exportDocs` | none | NO — dead cap; export runs ungated |
| `addTopicOrPoint` | `DiscussionCard:85 → TopicsTab:512→310,455,479` | yes |
| `editTopicOrPoint` | `TopicsTab:513→199,215,240,267`; `TopicPointRow:138,142,169` | yes |
| `deleteTopicOrPoint` | `TopicsTab:514→200`; `TopicPointRow:139` | yes |
| `checkPoint` | `TopicsTab:515→299`; `TopicPointRow:181,183` | yes |
| `editResponses` | threaded to `TopicPointRow` but unused | DECORATIVE — no effect |
| `createTask` | `DiscussionCard:178,330`; `TasksTab:227,265,309`; `PreviousTasksTab:880` | yes |
| `editTaskStatus` | `canTask → TaskTable:136`; bulk `TasksTab:140`, `PreviousTasksTab:467` | yes |
| `editTaskPriority` | `TaskTable:137`; bulk `TasksTab:150` | yes |
| `editTaskDeadline` | `TaskTable:139`; bulk `TasksTab:162` | yes |
| `editTaskAssignee` | `TaskTable:138`; bulk `TasksTab:153` | yes |
| `editTaskName` | `TaskTable:140`; `TasksTab:171` | yes |
| `deleteTask` | `TasksTab:188,219-220`; `PreviousTasksTab:560,566-567` | yes |
| `createDiscussion` | `DiscussionList:291→374,447` | yes (gate in list buttons) |
| `reorderColumns` | `DiscussionCard:103 → TasksTab:266,295`, `PreviousTasksTab:930 → TaskTable:48,83` (`?? canManageSettings`, desktop only) | yes — owners only. My Tasks passes no prop → falls back to `canManageSettings` (intentional) |
| `manageTemplates` | `DiscussionList:292→369` | yes |

---

## 5. How to add a new capability end-to-end

1. **Catalog entry** — add to `CAPABILITIES` in `boards.config.js:114-138`:
   `{ id, tier: 'discussion'|'task'|'system', group, label: '<Hebrew>' }`. Pick the correct tier —
   tier drives which item's people columns are read and which resolver branch runs.
2. **Default bucket** — add the id to `CAPABILITY_DEFAULTS` (`:81-104`) with `'all'`,
   `'creatorLeadOwner'`, or `'owner'`. This is the fallback when a held role leaves the cap `undefined`.
   Omitting it means the additive loop's default-inherit path resolves to `false` for that cap.
3. **Seed** — add explicit `true`/`false` per role in `DEFAULT_PERMISSION_SEED` (`:159-228`),
   keyed `${boardKey}:${alias}`. This pre-fills `permissions.roles` on first enable. (System tier is
   not seeded and — per §3b — not enforced from roles anyway.)
4. **Settings UI** — the matrix auto-renders any cap in `CAPABILITIES` under its `tier`+`group` via
   `TIER_CARDS` (`PermissionsTab.jsx:75-88`, filter `:311-313`). Add a new `group` to `TIER_CARDS`
   only if the cap needs a new card; otherwise it appears in the existing card automatically.
5. **Resolver** — usually no change: `resolveCan` reads the catalog/defaults generically. Only edit
   `usePermission.js` if the cap needs special handling (like the hardcoded `reorderColumns`).
   ⚠️ If it's a **system** cap you want actually enforced from a role, you MUST change the
   `isSystemCap` branch (`:169-178`) — today it ignores role capabilities (§3b).
6. **UI consumer** — call `can('<capId>', ctx)` (or thread a boolean from `DiscussionCard`/
   `DiscussionList`) and enforce by **withholding the mutation handler** and/or **hiding the control**.
   A cap with no consumer is dead (see `exportDocs`, `viewDiscussion`).
7. **Tests** — add resolver parity + granular tests. Baseline: with `enabled:false`, behavior must be
   unchanged (see `src/components/SettingsModal/__tests__/permissionsTab.persistence.test.jsx` and the
   resolver tests). Run `npm run test:run` and `npm run build`.

---

## 6. Storage & persistence

**Persisted shape** (top-level `settings.permissions`, alongside `boards`/`columns`/`preferences`):
```
{ enabled: bool, version: 1, roles: { [roleKey]: { capabilities: { [capId]: bool }, hidden?: bool } } }
```
- **Default when absent** — `DEFAULT_PERMISSIONS = { enabled: false, version: 1, roles: {} }`
  (`boards.config.js:67-71`). Absent permissions = fail-open = behavior identical to before the feature
  (`SettingsContext.jsx:185`).
- **Storage key** — `discussions_settings_${instanceId}`, instanceId falling back
  `instanceId → boardId → 'default'` (`SettingsContext.jsx:169`).
- **Role KEY format** — `${boardKey}:${alias-or-columnId}`. Mapped columns → alias suffix
  (preserves stored config); unmapped live columns → raw column id suffix. Built in
  `buildRoleGroups` (`PermissionsTab.jsx:104-136`) and `boardRoleEntries` (`usePermission.js:42-54`).
  The synthetic system row is the fixed key `"system:system"` (`PermissionsTab.jsx:107-110`).
- **First-enable seeding** — `toggleEnabled` (`PermissionsTab.jsx:188-196`): first time the owner
  flips enable ON with no roles stored, deep-clones `DEFAULT_PERMISSION_SEED` (does not mutate the
  module constant).

**`updateSettings` deep-merge** (`SettingsContext.jsx:158-164`):
```
next.permissions = {
  ...base.permissions, ...partial.permissions,
  roles: { ...base.permissions?.roles, ...partial.permissions?.roles },
};
```
Guarded by `'permissions' in base || 'permissions' in partial` so a fresh `buildEmptyConfig()` instance
that never had permissions isn't given an empty blob.

⚠️ **Per-role replacement caveat** — the roles merge is **shallow at the role-key level**. A role object
in `partial.permissions.roles` **replaces the whole stored role object**; its `capabilities`/`hidden`
are NOT deep-merged. A partial write like `{ roles: { 'disc:x': { capabilities: { foo: true } } } }`
drops that role's `hidden` and other caps. In practice the tab always spreads from the current
`permissions` (`PermissionsTab.jsx:199-205,213-217`) and SettingsModal saves the whole blob — so send
the role's **complete** object if you write directly.

**Load path** (`SettingsContext.jsx:77-127`) runs `migrateColumnAliases` on `columns` only —
**no permissions-specific migration**. `roles` are keyed by alias where possible precisely so config
survives column-mapping changes.

---

## 7. Pitfalls / invariants

- **`enabled:false` MUST equal today.** The fail-open path (`:145-157`) reproduces today's
  creator/lead/owner-edit + everyone-read-only + open create/templates behavior byte-for-byte. Any
  change here is a behavior change to every existing instance. Don't touch it lightly; parity tests
  guard it.
- **Advisory, not security.** No server enforcement. Never market/treat it as a security boundary; real
  enforcement is only monday's server rejecting the user's own token. Keep the UI disclaimer.
- **Ready-gate no-flicker invariant.** Edit caps return read-only until the discussion's role columns
  load (`discussionReady`, `:77-81`; gate `:142-143`). Don't remove it or edit surfaces will flash
  editable then lock. Owners are unaffected (bypassed at step 0).
- **Don't break alias-keyed config.** Roles are keyed by alias for mapped columns and column id for
  unmapped ones. If you re-key everything by column id, alias-keyed seed/stored grants orphan. Preserve
  the `buildRoleGroups`/`boardRoleEntries` alias-first logic.
- **No revoke today (§3a).** If a product requirement needs "unchecking = deny," you must add a revoke
  pass to `resolveCan` (an explicit `false` in any held non-hidden role should short-circuit to
  `return false`) — it does not exist now, and adding it changes the additive semantics globally.
- **System caps ignore role config (§3b).** To make a כללי checkbox real you must edit the
  `isSystemCap` branch — the catalog/seed alone won't wire it.
- **A cap with no `can()` consumer does nothing (§3c/3d/3e).** Don't add a checkbox and assume it's
  enforced; wire the consumer and hide/withhold at the leaf.
- **Owner = owner of `context.boardId`,** not the data board, and **not** account admins
  (`App.jsx:255-296`; `docs/sdk-instance-contexts.md`). Keep membership logic keyed off the object.
- **My Tasks stays UNGATED** — never call `can()` there; a user always edits their own assigned tasks'
  status/priority/notes.
- **`hidden` fully removes a role at runtime** (`:176`, `:195`). It's the only way today to make a
  people column not count as a role.
