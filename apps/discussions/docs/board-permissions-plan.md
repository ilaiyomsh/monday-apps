# Board-Permissions Enforcement Plan — Wiring the Matrix to Real (Advisory) Enforcement, Incl. REVOKE

**Status:** DESIGN ONLY — no code changes in this document.
**Scope:** Close the gap between the permissions matrix UI (owner can check/uncheck capabilities per role) and the runtime resolver (`resolveCan`), so that (a) unchecking a box actually **denies** (revoke), (b) the three **system-tier** capabilities are honored from the `system:system` role, and (c) the **`exportDocs`** capability gains a real consumer.

> **Golden rule that overrides everything below (from `docs/board-permissions-spec.md`):**
> This is **client-side ADVISORY gating only** — the app has no server. It is UX guardrails, **NOT** a security boundary. Real enforcement is only monday's server rejecting the user's own token. Everything in this plan must preserve the **fail-open** invariant: while `settings.permissions.enabled === false`, behavior is **byte-for-byte identical to today**.

---

## 0. Reference anchors (authoritative current state)

| Concern | File | Anchor |
|---|---|---|
| Resolver entry / branch order | `src/hooks/usePermission.js` | `resolveCan` `:121`; owner bypass `:137`; ready gate `:142-143`; fail-open `:145-157`; creator/lead override `:161-164`; system branch `:169-178`; additive loop `:184-205`; default-deny `:207-208` |
| Default buckets | `src/hooks/usePermission.js` | `resolveDefaultBucket` `:91-110` |
| Role entries | `src/hooks/usePermission.js` | `boardRoleEntries` `:42-54`; `inPeople` `:69-71`; `discussionReady` `:77-81`; `isCreatorOrLead` `:84-89` |
| Hook wrappers | `src/hooks/usePermission.js` | `usePermission` `:219-249`; `usePermissions` `:259-272` |
| Catalog / defaults / seed | `src/utils/mondayApi/boards.config.js` | `DEFAULT_PERMISSIONS` `:67-71`; `CAPABILITY_DEFAULTS` `:81-104`; `CAPABILITIES` `:114-138`; `PERMISSION_ROLE_SOURCES` `:147-150`; `DEFAULT_PERMISSION_SEED` `:159-228` |
| Matrix UI read/write | `src/components/SettingsModal/PermissionsTab.jsx` | `TIERS` `:62-66`; `buildRoleGroups` `:104-136`; `system:system` synthetic role `:70-71,107-110`; `isCapChecked` `:143-146`; `toggleCap` `:198-206`; `toggleHidden` `:212-218`; `toggleEnabled` first-enable seed `:188-196` |
| Persistence deep-merge | `src/contexts/SettingsContext.jsx` | `updateSettings` `:136-177`; permissions merge `:158-164`; `permissions` accessor `:185` |
| Owner/ownership | `src/App.jsx` | `canManageSettings` state `:243`; owner check `:251-311`; threading `:567,623,646,659` |
| Consumers (per-cap) | see §3 table | — |

---

## 1. Current state — capability × {consumer? · resolver-honored? · grant works? · revoke works?}

Legend: **consumer?** = is `can('<cap>')` actually called somewhere and does it gate a control/handler. **resolver-honored?** = does `resolveCan` ever read this cap's per-role `capabilities[cap]` (i.e., is the checkbox even consulted). **grant works?** = checking the box (or seed `true`) can produce ALLOW. **revoke works?** = unchecking the box (explicit `false`) produces DENY for a user who would otherwise be allowed.

### Discussion-tier caps (`tier: 'disc'`)

| Cap | consumer? | resolver-honored? | grant works? | revoke works? | Evidence |
|---|---|---|---|---|---|
| `viewDiscussion` | ❌ never called | ❌ short-circuits at `:182` (`default==='all'`) before loop | n/a (allow-all) | ❌ | No `can('viewDiscussion')` anywhere; `CAPABILITY_DEFAULTS.viewDiscussion==='all'` `:83` → `:182` returns true unconditionally |
| `editDiscussionFields` | ✅ `DiscussionCard.jsx:90` (coarse `canEdit`), `DiscussionList.jsx:286`, `PreviousTasksTab.jsx:821` | ✅ loop reads it `:196` | ✅ | ❌ | Creator/lead auto-allow at `:162` masks it for them; others rely on default `creatorLeadOwner` `:84`; explicit `false` ignored `:204` |
| `editSummary` | ✅ `SummaryTab.jsx:111,112,117` | ✅ `:196` | ✅ | ❌ | Same as above (`:85` default) |
| `exportDocs` | ❌ **no consumer** | ✅ (would be read `:196` if called) | ✅ if called | ❌ | Export/duplicate kebab `DiscussionList.jsx:330-331` run **ungated**; no `can('exportDocs')` exists |
| `addTopicOrPoint` | ✅ `TopicsTab.jsx:310,455,479,512` | ✅ `:196` | ✅ | ❌ | default `creatorLeadOwner` `:88`; explicit `false` ignored `:204` |
| `editTopicOrPoint` | ✅ `TopicsTab.jsx:199,215,240,267,513`, `TopicPointRow.jsx:138,142,169` | ✅ `:196` | ✅ | ❌ | `:89` |
| `deleteTopicOrPoint` | ✅ `TopicsTab.jsx:200,514`, `TopicPointRow.jsx:139` | ✅ `:196` | ✅ | ❌ | `:90` |
| `checkPoint` | ✅ `TopicsTab.jsx:299,515`, `TopicPointRow.jsx:181,183` | ✅ `:196` | ✅ | ❌ | `:91` |
| `editResponses` | ⚠️ **decorative** — threaded to `TopicPointRow` but never destructured/rendered (`TopicPointRow.jsx:102-108`); no responses cell exists post-redesign | ✅ (read if called) | no observable effect | ❌ | Handler `onUpdateResponses` + cap both die unused at the leaf |
| `createTask` | ✅ `DiscussionCard.jsx:178,330`, `TasksTab.jsx:227,265,309`, `PreviousTasksTab.jsx:880` | ✅ `:196` | ✅ | ❌ | `:87` |

### Task-tier caps (`tier: 'task'`)

| Cap | consumer? | resolver-honored? | grant works? | revoke works? | Evidence |
|---|---|---|---|---|---|
| `editTaskStatus` | ✅ `TaskTable.jsx:136`, bulk `TasksTab.jsx:140`, `PreviousTasksTab.jsx:467` | ✅ `:196` (task source `:189`) | ✅ | ❌ | default `creatorLeadOwner` `:94`; note task caps are **excluded** from the creator/lead override `:162` |
| `editTaskPriority` | ✅ `TaskTable.jsx:137`, `TasksTab.jsx:150` | ✅ `:196` | ✅ | ❌ | `:95` |
| `editTaskDeadline` | ✅ `TaskTable.jsx:139`, `TasksTab.jsx:162` | ✅ `:196` | ✅ | ❌ | `:96` |
| `editTaskAssignee` | ✅ `TaskTable.jsx:138`, `TasksTab.jsx:153` | ✅ `:196` | ✅ | ❌ | `:97` |
| `editTaskName` | ✅ `TaskTable.jsx:140`, `TasksTab.jsx:171` | ✅ `:196` | ✅ | ❌ | `:98` |
| `deleteTask` | ✅ `TasksTab.jsx:188,219-220`, `PreviousTasksTab.jsx:560,566-567` | ✅ `:196` | ✅ | ❌ | `:99` |

### System-tier caps (`tier: 'system'`) — the biggest gap

| Cap | consumer? | resolver-honored? | grant works? | revoke works? | Evidence |
|---|---|---|---|---|---|
| `createDiscussion` | ✅ `DiscussionList.jsx:291,374,447` | ❌ **never reads `roles['system:system']`** | n/a — `default==='all'` at `:172` returns true for everyone | ❌ | `:172` short-circuits; the `system:system` capabilities map is dead config |
| `manageTemplates` | ✅ `DiscussionList.jsx:292,369` | ❌ same | n/a — `default==='all'` `:172` → true for everyone | ❌ | `:172` |
| `reorderColumns` | ✅ `TasksTab.jsx:266,295`, `PreviousTasksTab.jsx:930`, `TaskTable.jsx:48,83` | ❌ hardcoded `:173` `return false` | n/a — owners-only, decoupled from the checkbox | ❌ | `:149,173` — box is decorative |

**Summary of gaps:**
- **REVOKE is universally broken.** No capability honors an explicit `false`; the additive loop treats `false` as "keep scanning" (`:204`).
- **All 3 system-tier checkboxes are decorative** (`createDiscussion`/`manageTemplates` short-circuit on `default==='all'` at `:172`; `reorderColumns` is hardcoded `:173`). The `system:system` role's `capabilities` are never read.
- **`exportDocs` has no consumer** and its kebab action runs ungated.
- **`editResponses` is decorative** (leaf ignores it).
- **`viewDiscussion` has no consumer** and short-circuits at `:182` (intentional — leave allow-all, see §2.4).
- For creator/lead, the **override `:162`** makes discussion-content checkboxes irrelevant to them (they are always allowed).

---

## 2. Enforcement gaps & concrete approach

### 2.1 Make SYSTEM-tier caps read `roles['system:system'].capabilities`

**Problem.** The `if (isSystemCap)` branch (`:169-178`) resolves system caps only via (a) `CAPABILITY_DEFAULTS==='all'` (`:172`), (b) hardcoded `reorderColumns` (`:173`), (c) "holds any non-hidden discussion role" (`:175-177`). It never consults `roles['system:system']`.

**Approach.** Introduce a single synthetic system role key constant and rewrite the system branch to be capability-driven, mirroring the additive/revoke semantics chosen in §2.2.

1. **Add the constant.** In `boards.config.js`, export `SYSTEM_ROLE_KEY = 'system:system'` (matching `PermissionsTab.jsx:70-71` which already writes to that exact key). Currently the map notes there is **no** such export — this makes the resolver and the UI agree on one source of truth instead of a magic string.

2. **Rewrite the system branch** (replace `:169-178`). New precedence (feature-on):
   - Owner already bypassed at `:137`.
   - `reorderColumns`: still hard `owner`-only baseline (`default==='owner'`), **but** now allow an explicit `true` on `system:system` to open it to holders of a discussion role, and an explicit `false` to keep it closed. Concretely:
     - `explicit = roles[SYSTEM_ROLE_KEY]?.capabilities?.[capability]`.
     - `if (explicit === false) return false;` (revoke — see §2.2).
     - `if (explicit === true) return <userHoldsNonHiddenDiscussionRole>;` (grant to members; owners already through). Do **not** grant `reorderColumns` to non-members even when checked, because the control is board-structural — checked means "members too," unchecked/absent means "owners only."
     - `if (explicit === undefined) return resolveDefaultBucket('reorderColumns', …)` → `'owner'` bucket → `false` (owners already bypassed). Preserves today.
   - `createDiscussion` / `manageTemplates` (`default==='all'`):
     - `if (explicit === false) return false;` (revoke — now an owner can turn "everyone can create" OFF).
     - `if (explicit === true) return true;`
     - `if (explicit === undefined) return CAPABILITY_DEFAULTS[capability] === 'all';` → `true` (preserves today's allow-all).

   > Note the deliberate asymmetry: for `createDiscussion`/`manageTemplates` the **absent** default is allow-all (matches today); for `reorderColumns` the absent default is owners-only. This keeps the `enabled:false` byte-for-byte invariant and the "unchecked-when-enabled" story coherent per tier (§2.4).

3. **`hidden` on system role.** The UI forbids hiding `system:system` (`PermissionsTab.jsx:257` `canHide = role.boardKey !== 'system'`), so the resolver need not special-case a hidden system role; still, defensively read `roles[SYSTEM_ROLE_KEY]?.hidden` and treat a hidden system role as "all system caps fall to default."

4. **Who "holds" the system role.** The system pseudo-role is **global**, not a people column — every user "holds" it. So the additive loop over people columns does not apply; the branch reads the single `system:system` entry directly. Membership for the `reorderColumns=checked` grant is "holds any non-hidden discussion role on the current discussion," reusing the existing `boardRoleEntries('discussions')` scan (`:175-177`). For `createDiscussion`/`manageTemplates` there is no discussion in context (list-level), so grant/deny is global (no membership test) — which is correct because these are account-wide actions.

### 2.2 REVOKE semantics — explicit `false` must DENY

**Decision:** adopt **role-scoped revoke with a global override tier**, expressed as a single, well-ordered precedence. An explicit `false` denies **within the roles the user actually holds**, but never overrides the owner bypass and (by default) never overrides the creator/lead override — unless the owner opts into "strict" mode (see the flag below).

**Why not pure additive-with-veto (any `false` anywhere wins)?** Because roles are held simultaneously (a user can be both participant and lead-column member). A blanket "any false wins" makes a single restrictive role silently clobber a permissive one and is very surprising for owners. Instead we use **per-role veto with union of grants**, i.e.:

> A capability is **granted** iff **at least one held, non-hidden role grants it** (explicit `true`, or `undefined` → default resolves truthy) **AND no held, non-hidden role explicitly denies it** (`explicit === false`).

That is: **explicit `false` in any held role vetoes the grant from other held roles.** This is the minimal change that makes "uncheck = deny" intuitive: if the owner unchecks a cap on the participant role, a participant is denied even if some other column they happen to be in grants it. (Between "any-grant-wins" and "any-deny-wins" we choose **deny-wins** because that is what "uncheck to restrict" means to an owner.)

**Precise precedence order for `resolveCan` (feature-on), top wins:**

1. **Owner bypass** (`:137`) — `canManageSettings` → **ALLOW**. Unchanged. Never revocable (owners are the ones editing the matrix; revoking them = lockout; the spec forbids it).
2. **Ready gate** (`:142-143`) — edit caps → read-only until people columns load. Unchanged.
3. **System caps** — resolved by the §2.1 branch (its own `false`→deny, `true`→grant, `undefined`→default).
4. **`default==='all'` caps that are NOT explicitly touched by any held role** → **ALLOW** (`viewDiscussion`). BUT this must now come **after** a revoke check so an owner *could* restrict a normally-all cap if they add an explicit `false` (see step 6). Practically `viewDiscussion` has no role rows in the matrix, so it stays allow-all; keep the short-circuit but move it below the deny scan for correctness.
5. **Creator/Lead override** (`:162`) — discussion-content caps only, ALLOW. **Configurable interaction with revoke (see flag).** Default = override still wins (creator/lead cannot be revoked), matching today's "creator/lead always edit" invariant and avoiding self-lockout of the discussion owner.
6. **Role scan with veto:**
   - Scan `boardRoleEntries(boardKey)` for held, non-hidden roles.
   - **First pass — deny:** if ANY held non-hidden role has `capabilities[cap] === false` → record `denied = true`.
   - **Grant pass:** if ANY held non-hidden role has `capabilities[cap] === true`, or (`=== undefined` and `resolveDefaultBucket(...)` truthy) → record `granted = true`.
   - **Resolve:** `return granted && !denied;`
   - This replaces the early-`return true` on grant (`:197,201`) with accumulation so a later role's `false` can veto.
7. **Default-deny** (`:207-208`) — unchanged fallthrough.

**Interaction table (feature-on):**

| Situation | Result | Rationale |
|---|---|---|
| Owner (`canManageSettings`) | ALLOW always | step 1, never revocable |
| Creator/lead, discussion-content cap, cap unchecked on their role | ALLOW (default) / DENY (strict flag) | step 5 override; flag lets owner opt into strict |
| Creator/lead, **task** cap | goes to role scan (override excludes task caps `:162`) | task caps honor revoke normally |
| User holds role A (grants) + role B (`false`) | DENY | step 6 deny-wins veto |
| User holds role A (grants) + role B (undefined→default truthy) | ALLOW | no explicit `false` present |
| Cap `undefined` on all held roles, default `creatorLeadOwner`, user is neither | DENY | `resolveDefaultBucket` → false |
| `viewDiscussion`, no role touches it | ALLOW | step 4 |

**Interaction with `CAPABILITY_DEFAULTS` (2.a):** defaults only fill `undefined`. An explicit `false` short-circuits the default (deny-wins). An explicit `true` overrides a restrictive default. Unchanged conceptually; the only new rule is that `false` now matters.

**Interaction with creator/lead override (2.b):** default keeps the override above the veto (creator/lead immune). Add `settings.permissions.strictCreatorLead` (default `false`). When `true`, move step 5 **below** step 6 so an explicit `false` on a role the creator/lead also holds can revoke them. Ship default-off to preserve today.

**Interaction with owner bypass (2.c):** owner bypass is **absolute and above all revokes** — non-negotiable per the spec's no-lockout rule. Document loudly in the resolver.

### 2.3 Wire `exportDocs` to a real `can('exportDocs')` gate

**Problem.** No `can('exportDocs')` call exists; the DOCS-export action is ungated.

**Exact call sites to add the gate:**
- **`DiscussionList.jsx`** — the row kebab passes `onExport` (and `onDuplicate`) at `:330-331` **ungated**. Compute `canExport = can('exportDocs', { discussion: <row> })` per row (the list already resolves per-row caps around `:284-292` / `:286` `canEditItem`). Withhold/hide the "ייצוא ל-DOCS" kebab item when `!canExport`, mirroring how the edit/delete kebab is gated by `canEditItem` (`:329,332`).
- **`DiscussionCard.jsx`** — if a card-level export/EventChip `onExport` affordance exists (the DiscussionCard branch owns the discussion detail actions), resolve `canExport = can('exportDocs')` alongside the other named booleans (`:83-103`) and thread it to the export control (hide when false), matching `editSummary`/`editDiscussionFields` threading.
- **`App.jsx` `handleExport`** — belt-and-suspenders: early-return in `handleExport` if the gate is false for the target discussion, so a stale/unhidden control can't fire the mutation. (Advisory: this is a UX guard, not security.)

Because `exportDocs` default is `creatorLeadOwner` (`:86`), wiring it makes creator/lead/owner able to export (unchanged spirit) and lets an owner grant it to participants via the checkbox (grant already works once consumed) and **revoke** it via §2.2.

### 2.4 "Unchecked when enabled" — default-allow vs default-deny per tier

An **unchecked** box for a role means the stored value is either **absent (`undefined`)** or **explicit `false`**. These are now distinct:
- **`undefined`** → inherit `CAPABILITY_DEFAULTS[cap]` (the tier default). This is what a freshly-seeded role that never touched the cap looks like.
- **`false`** → explicit revoke (§2.2 veto).

But note `PermissionsTab.jsx:isCapChecked` (`:143-146`) returns `cap === true` — so the UI **cannot today distinguish** `undefined` from `false`; both render unchecked, and `toggleCap` writes a literal boolean. **Required UI change (design):** `toggleCap` must write `false` on uncheck (it already toggles to the opposite boolean), so an unchecked seeded cap is stored as `false` → revoke. For caps the seed set `true` (e.g. participant's `viewDiscussion`), unchecking → `false` = deny; re-checking → `true` = grant. For caps never present in the seed, they stay `undefined` = default. This is the desired behavior: **within the matrix, unchecking always means deny.**

Per-tier default (the `undefined` fallback), unchanged from `CAPABILITY_DEFAULTS`:
- **Discussion content** → `creatorLeadOwner` (default-deny for non-creator/lead members).
- **Task fields** → `creatorLeadOwner` (default-deny; based on task creator/responsible).
- **System `createDiscussion`/`manageTemplates`** → `all` (default-allow — matches today).
- **System `reorderColumns`** → `owner` (default-deny for non-owners).
- **`viewDiscussion`** → `all` (default-allow).

> The **feature-off** path (`:145-157`) keeps its own literal reproduction of today and is untouched — the default story above only governs feature-on.

---

## 3. Per-capability wiring checklist (component → `can()` call)

Caps already wired keep their site; the checklist highlights **new** work (🆕) and **verify-only** (✅).

| Cap | Component / call | Action |
|---|---|---|
| `viewDiscussion` | — | ✅ leave allow-all; no consumer needed (informational cap). Optionally 🆕 gate the whole `DiscussionCard` mount later, but out of scope. |
| `editDiscussionFields` | `DiscussionCard.jsx:90,144,156,217`; `DiscussionList.jsx:286`; `PreviousTasksTab.jsx:821` | ✅ verify revoke now denies non-creator/lead members |
| `editSummary` | `SummaryTab.jsx:111,112,117` | ✅ verify |
| `exportDocs` | `DiscussionList.jsx:330-331` (row kebab), `DiscussionCard.jsx:83-103` (card action), `App.jsx handleExport` | 🆕 add `can('exportDocs', {discussion})` at all three; hide control + early-return |
| `addTopicOrPoint` | `TopicsTab.jsx:310,455,479,512` | ✅ verify |
| `editTopicOrPoint` | `TopicsTab.jsx:199,215,240,267,513`; `TopicPointRow.jsx:138,142,169` | ✅ verify |
| `deleteTopicOrPoint` | `TopicsTab.jsx:200,514`; `TopicPointRow.jsx:139` | ✅ verify |
| `checkPoint` | `TopicsTab.jsx:299,515`; `TopicPointRow.jsx:181,183` | ✅ verify |
| `editResponses` | `TopicPointRow.jsx:102-108` | 🆕 **decide**: either (a) remove the cap from the catalog + threading (it's decorative post-redesign), OR (b) if a responses cell returns, destructure `canEditResponses`/`onUpdateResponses` and gate the cell. Recommend (a) — delete dead cap to avoid a lying checkbox. |
| `createTask` | `DiscussionCard.jsx:178,330`; `TasksTab.jsx:227,265,309`; `PreviousTasksTab.jsx:880` | ✅ verify |
| `editTaskStatus/Priority/Deadline/Assignee/Name` | `TaskTable.jsx:136-140`; bulk `TasksTab.jsx:140,150,153,162,171` | ✅ verify revoke; note task caps skip the creator/lead override (`:162`) so revoke applies to everyone incl. creator/lead |
| `deleteTask` | `TasksTab.jsx:188,219-220`; `PreviousTasksTab.jsx:560,566-567` | ✅ verify |
| `createDiscussion` | `DiscussionList.jsx:291,374,447` | 🆕 no call-site change (already gated by `can`), but resolver §2.1 makes the box live — verify revoke hides the "דיון חדש" button and calendar add |
| `manageTemplates` | `DiscussionList.jsx:292,369` | 🆕 resolver §2.1 makes box live — verify revoke hides "ניהול תבניות" |
| `reorderColumns` | `TasksTab.jsx:266,295`; `PreviousTasksTab.jsx:930`; `TaskTable.jsx:48,83` | 🆕 resolver §2.1 lets a checked box open reorder to members; keep My-Tasks fallback to `canManageSettings` (no prop) |

**Never gate:** My Tasks (`MyTasksView`) — spec golden rule #4. Do not add `can()` there.

---

## 4. Back-compat & migration

1. **`enabled:false` invariant (byte-for-byte).** All §2 changes live in the **feature-on** path (below `:159`) and the system branch. The fail-open block `:145-157` is **not** touched. `DEFAULT_PERMISSIONS` (`:67-71`) stays `{enabled:false, version:1, roles:{}}`, and the `permissions` accessor fallback (`SettingsContext.jsx:185`) keeps absent-permissions = fail-open. **Acceptance test:** with `enabled:false`, `resolveCan` output is identical for every cap/role/user combination before and after this change (snapshot test, §5).

2. **Alias-keyed roles survive.** Role keys are `${boardKey}:${alias}` for mapped columns and `${boardKey}:${columnId}` for unmapped live columns (`boardRoleEntries` `:44-52`; `buildRoleGroups` `:104-136`). The resolver already reads by `e.key`; no re-keying needed. `system:system` is a fixed literal key already produced by `buildRoleGroups` (`:107-110`) — the new `SYSTEM_ROLE_KEY` constant must equal `'system:system'` exactly.

3. **`system:system` starts empty.** Existing enabled instances have `roles['system:system']` **absent** (the seed never included the system tier — `DEFAULT_PERMISSION_SEED` `:159-228` has no system role). Under §2.1, absent `system:system` → all system caps fall to their `CAPABILITY_DEFAULTS` (`createDiscussion`/`manageTemplates` = allow-all, `reorderColumns` = owner-only) = **exactly today's behavior**. So enabling the new resolver on an already-enabled instance is a no-op until the owner touches a system checkbox. No migration write required.

4. **Additive→veto behavior change.** This is the one **intentional** behavior change for `enabled:true` instances: a stored explicit `false` (from a seed like participant's `editDiscussionFields:false` at `boards.config.js:192+`) that was previously **ignored** will now **deny**. Because the seed's `false` values already encode the intended restriction (participant can't edit fields), the new behavior *matches the seed's stated intent* — participants become correctly restricted rather than accidentally permitted via default fallthrough. **Call this out in release notes.** For any owner who had relied on the old additive leniency, the mitigation is: re-check the box (writes `true`, which wins over other roles' `false` only if that role isn't also `false` — with deny-wins, they must ensure no held role denies; document this).

5. **`isCapChecked`/`toggleCap` semantics (§2.4).** No migration of stored data; `toggleCap` already writes booleans. Verify `toggleCap` writes `false` (not delete) on uncheck so revoke is expressible. If product later wants a tri-state (grant/deny/inherit), add an "inherit" affordance that deletes the key → `undefined`; out of scope for this plan.

6. **Deep-merge preserved.** `updateSettings` roles merge is shallow-at-role-key (`SettingsContext.jsx:158-164`); the matrix always spreads the full role object (`PermissionsTab.jsx:199-205,213-217`) so no clobber. Adding `SYSTEM_ROLE_KEY` writes go through the same `toggleCap`/`toggleHidden` path — safe.

7. **Version bump.** Optional: bump `DEFAULT_PERMISSIONS.version` to `2` to mark "veto semantics." Not required for correctness (absent/false handling is backward-safe), but useful for future migrations. If bumped, do **not** gate behavior on version — the resolver must handle v1 blobs identically.

---

## 5. Test plan

### 5.1 Unit — `resolveCan` (extend `usePermission` tests)

**A. Fail-open invariant (regression guard).** For `enabled:false`, table-test every cap across {owner, creator, lead, participant, stranger} × {discussion ready / not ready} and assert results match the pre-change baseline (capture a snapshot from current code first). This is the byte-for-byte guard.

**B. Revoke (feature-on).**
- Role A grants `editSummary:true`, user holds A → ALLOW.
- Role A grants, Role B has `editSummary:false`, user holds A+B → **DENY** (deny-wins veto).
- Role A `false`, user holds only A → DENY (even though default would be creatorLeadOwner and user is neither — trivially DENY, but assert the `false` path executes).
- Cap `undefined` on held role, default `creatorLeadOwner`, user is creator → ALLOW via default bucket; user is stranger → DENY.
- Hidden role with `false` → contributes nothing (`:195`), so no veto; assert grant from another role survives.

**C. Creator/lead override vs revoke.**
- `strictCreatorLead=false` (default): creator holds a role with `editDiscussionFields:false` → **ALLOW** (override wins, `:162`).
- `strictCreatorLead=true`: same setup → **DENY** (override moved below veto).
- Task cap `editTaskStatus:false` on a role the creator holds → DENY regardless of override (task caps excluded from override at `:162`).

**D. System caps (§2.1).**
- `system:system` absent → `createDiscussion` ALLOW (default all), `manageTemplates` ALLOW, `reorderColumns` DENY for non-owner, ALLOW for owner (bypass).
- `system:system.capabilities.createDiscussion=false` → **DENY** for non-owner; owner still ALLOW (bypass).
- `system:system.manageTemplates=false` → DENY.
- `reorderColumns:true` on `system:system`, user holds a non-hidden discussion role → ALLOW; user holds no role → DENY.
- `reorderColumns:false` → DENY for members (and owners still bypass).
- Hidden `system:system` (defensive) → system caps fall to defaults.

**E. Owner bypass absolute.** For every cap incl. explicit `false` on all roles, `canManageSettings:true` → ALLOW.

**F. `exportDocs` resolver.** Grant/revoke parity with `editSummary` (same tier/default).

### 5.2 Component gates
- `DiscussionList`: with `createDiscussion:false` (system role), "דיון חדש" button + calendar add hidden. With `manageTemplates:false`, "ניהול תבניות" hidden. With `exportDocs:false` for a row, that row's export kebab item hidden.
- `DiscussionCard` / `SummaryTab` / `TopicsTab` / `TaskTable`: revoke hides/read-onlys the corresponding control (extend existing gate tests with a `false` role).
- `MyTasksView`: assert **no** `can()` call and controls always editable (golden rule #4).
- `PermissionsTab`: `toggleCap` uncheck writes `false` (not delete); `system:system` row renders and cannot be hidden (`:257`).

### 5.3 Build + review
`npm run test:run` + `npm run build` green; whole-diff review against the four golden rules (advisory-only, fail-open, owner/no-lockout, My-Tasks-ungated).

---

## 6. Staged rollout

- **Stage 1 — Resolver only (dark).** Land §2.1 (system branch reads `SYSTEM_ROLE_KEY`) + §2.2 (veto precedence) + `SYSTEM_ROLE_KEY` constant + `strictCreatorLead` flag (default off). Ship behind `enabled:false` fail-open → zero user-visible change. Full unit suite (5.1). Commit.
- **Stage 2 — `exportDocs` consumer.** Add the three call sites (§2.3) + component tests. Still inert while `enabled:false`. Commit.
- **Stage 3 — `editResponses` cleanup.** Remove the dead cap (or gate it if a responses cell returns). Commit.
- **Stage 4 — UI truth.** Confirm `toggleCap` writes `false` on uncheck (§2.4). Optional version bump. Commit.
- **Stage 5 — Enablement docs.** Update `docs/board-permissions-spec.md` + `CLAUDE.md` to state veto semantics and the advisory caveat; add release note on the additive→veto change (§4.4). No code.
- **Stage 6 — Owner opt-in.** Feature is only active when an owner flips `enabled` in `PermissionsTab` (`toggleEnabled` `:188-196`), which seeds `DEFAULT_PERMISSION_SEED`. Validate on a test instance end-to-end (grant + revoke + system) before broad enablement.

---

## 7. Risks & the advisory-only caveat

- **ADVISORY, NOT SECURITY.** Every gate here withholds a UI control or a client-side handler; a determined user with edit rights on the underlying monday board can still mutate via monday's own UI/API. The only real enforcement is monday's server rejecting the user's token. The matrix UI **must** carry the disclaimer ("advisory, not security"). Do not market this as access control.
- **Owner lockout.** Owner bypass (`:137`) is absolute and above all revokes; `openSettings` stays hard owner-only OUTSIDE the matrix. Never expose a checkbox that could revoke an owner's ability to reach settings. `system:system` cannot be hidden (`:257`) — preserve that.
- **Behavior change on enabled instances (§4.4).** The additive→veto switch is the only intended change for `enabled:true` blobs; it makes seeded `false` values take effect. Mitigate with release notes and the re-check guidance.
- **Ready-gate flicker.** The veto accumulation must run **after** the ready gate (`:143`) so edit caps stay read-only until people columns load — do not move the deny scan above the gate.
- **Deny-wins surprise.** Owners may not expect one restrictive role to veto a permissive one. Document the "deny-wins across held roles" rule in the matrix UI help text; consider a per-role tooltip.
- **Dynamic role churn.** Roles come from live people columns (`peopleColumns.js`); an unmapped column keyed by id can appear/disappear. A role removed from the board leaves an orphan key in stored `roles` — harmless (never held), but the matrix should tolerate it (it already derives rows from live columns + mapped aliases). `hidden` fully ignores a column at runtime (`:176,195`).
- **`reorderColumns` semantics.** Opening column reorder to members is board-structural; keep it conservative (checked = members too, unchecked/absent = owners only) and never grant to non-members.
