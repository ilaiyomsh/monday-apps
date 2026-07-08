# Board Permissions — Implementation Spec

Authoritative design for the role-based board-permissions feature. Subagents MUST follow this.
Companion design doc (visual): the approved mock + research artifact (role-centric monday Board-Permissions UI).

## Golden rules
- **Client-side ADVISORY gating only** — the app has no server. This is UX guardrails, NOT security. Never market/treat it as a security boundary. Real enforcement is only monday's server rejecting the user's own token.
- **Fail-open migration**: `settings.permissions.enabled` defaults `false`. While `false`, behavior is **byte-for-byte identical to today** (creator/lead/owner edit; everyone else read-only; create/templates open). The feature is invisible until an owner opts in.
- **Owner/Admin bypass**: board owners (`canManageSettings`) AND account admins (`context.user.isAdmin`) are unrestricted — they bypass the entire matrix, always. `openSettings` stays hard owner-only OUTSIDE the matrix (no lockout).
- **My Tasks stays UNGATED** — never call `can()` there; a user always edits their own assigned tasks' status/priority/notes.
- **Conventions**: never `console.*` (use `logger.*`); write paths call `assertNoGraphQLErrors` right after `safeApi`/`api`; never hardcode board/column ids (use aliases); `@vibe/core` is v4 (string literals); CSS Modules are `non-scoped` (plain class names, use `:global()` for vibe internals). Build output is `build/`. NEVER deploy, NEVER push.

## Model: three tiers, roles = people columns
Roles are **auto-derived from the people-type columns** mapped on each board, shown **by their column title** (versatile — a new people column appears automatically as a role). Mapping lives in Settings.

- 🟦 **Discussion tier** — roles from the DISCUSSIONS board people columns: `discussionCreatorID`, `discussionLeadID`, `participantsID`. A user's discussion role cascades to ALL of that discussion's content.
- 🟩 **Task tier** — roles from the TASKS board people columns: `taskCreatorID`, `responsibilityID`. Scoped per-task (you act on the specific task you're on).
- 🟪 **System tier** — global, not item-bound.

### Owner vs Member
Permissions apply to **board members** only. **Owners** (and account admins) are unrestricted. "Everyone at account" can be added as a subscriber team (`team_ids: [-1]`).

## Capability catalog
Discussion tier (`tier:'disc'`):
- `viewDiscussion` — צפייה בדיון (default: all)
- `editDiscussionFields` — עריכת פרטי הדיון (title/date/type/lead)
- `editSummary` — עריכת סיכום
- `exportDocs` — ייצוא ל-DOCS
- `createTask` — יצירת משימה בדיון
- `addTopicOrPoint` — הוספת נושא/נקודה (gates BOTH `useTopics.addTopic` AND `addPoint`)
- `editTopicOrPoint` — עריכת נושא/נקודה (gates `renameTopic` AND `renamePoint`)
- `deleteTopicOrPoint` — מחיקת נושא/נקודה (gates `deleteTopic` AND `deletePoint`)
- `checkPoint` — סימון נקודה כנידונה (`togglePoint`)
- `editResponses` — עריכת התייחסויות (`updatePointResponses`)

Task tier (`tier:'task'`), each maps 1:1 to an existing handler (fixed set, NOT arbitrary columns):
- `editTaskStatus` → `updateTaskStatus` (+ batch)
- `editTaskPriority` → `updateTaskPriority` (+ batch)
- `editTaskDeadline` → `updateTaskDeadline` (+ batch)
- `editTaskAssignee` → `updateTaskAssignee` (+ batch)
- `editTaskName` → `updateTaskName`
- `deleteTask` → `softDeleteTasks` (+ bulk bar)

System tier (`tier:'system'`, global):
- `createDiscussion` — יצירת דיון
- `reorderColumns` — סידור עמודות (ColumnOrderContext / SortableColumnHeader)
- `manageTemplates` — ניהול תבניות (TemplateManager open/edit)
- `openSettings` — **NOT in matrix**; hard-locked to owners.

## LOCKED default seed (per role) — used to pre-fill when the owner first enables
- `discussions:discussionCreatorID` → ALL discussion caps true (full).
- `discussions:discussionLeadID` → ALL discussion caps true (full).
- `discussions:participantsID` → viewDiscussion✓ exportDocs✓ createTask✓ addTopicOrPoint✓ checkPoint✓ editResponses✓ ; editDiscussionFields✗ editSummary✗ editTopicOrPoint✗ deleteTopicOrPoint✗.
- `tasks:taskCreatorID` → ALL task caps true (incl. editTaskDeadline, deleteTask).
- `tasks:responsibilityID` → editTaskStatus✓ editTaskPriority✓ ; editTaskDeadline✗ editTaskAssignee✗ editTaskName✗ deleteTask✗.
- system → createDiscussion = ALL members ; reorderColumns = owners only ; manageTemplates = ALL members.

`viewDiscussion` default = allow-all. `CAPABILITY_DEFAULTS[cap]` (fallback when a held role neither grants nor is seeded) = `'creatorLeadOwner'` for discussion content edits and task edits, `'all'` for view/createDiscussion/manageTemplates, `'owner'` for reorderColumns.

## Resolution algorithm — `can(capability, ctx)`  (cheap, at render; no extra queries)
`ctx = { boardKey, item, discussion, currentUserId }`. Reuse `inPeople(arr)` (= `arr.some(p => String(p.id) === myId)`) and `String(currentUser?.id ?? context?.user?.id)`.
1. **Owner/Admin bypass** — if `canManageSettings || context.user.isAdmin` → ALLOW.
2. **Feature off / fail-open** — if `!settings.permissions?.enabled` → reproduce TODAY: discussion content edits allowed iff `inPeople(discussion.discussionCreatorID) || inPeople(discussion.discussionLeadID)`; `viewDiscussion`/`createDiscussion`/`manageTemplates` = allow-all; `reorderColumns` = owners only; task edits = legacy (today threads canEdit → so creator/lead). Return that.
3. **Creator/Lead override** — for discussion-scoped content caps, if user ∈ creator/lead → ALLOW.
4. **Role union (additive, no deny)** — compute roles the user holds for `ctx` (discussion caps → discussion people cols; task caps → the task's `taskCreatorID`/`responsibilityID`; global caps → none). For each held role read `permissions.roles['${boardKey}:${alias}'].capabilities[cap]`: explicit `true` → grant; absent → inherit `CAPABILITY_DEFAULTS[cap]`; explicit `false` is NOT a revoke. Granted if ANY held role grants. Global caps: `owner || CAPABILITY_DEFAULTS==='all' || role-held-on-current-discussion`.
5. else **default-deny** (read-only; show the existing "צפייה בלבד" chip).
- **ready flag**: while a discussion's details haven't loaded (people cols undefined), edit caps return read-only regardless (preserve the no-flicker invariant from DiscussionCard).

## Data model — `settings.permissions` (top-level, sparse)
```
permissions: {
  enabled: false,           // false ⇒ behaves exactly like today
  version: 1,
  roles: {                  // keyed `${boardKey}:${peopleAlias}`; only deviations stored
    "discussions:discussionLeadID": { label?: "…", capabilities: { editTaskFields?:true, ... } }
  }
}
```
`updateSettings` already deep-merges `preferences` and `permissions.roles` (done in 200702b). `buildEmptyConfig` stays `{boards,columns}`. Read permissions from the React `useSettings()` context (NOT board-config-store).

## Owner UI — "הרשאות" tab in SettingsModal (LTR, monday Board-Permissions style)
Owner-only (modal already gated). See the approved mock. Structure:
- Master enable toggle (`permissions.enabled`); while off, grid disabled + explainer.
- LEFT sidebar: flat role list = people columns by title, grouped by tier with thin dividers (NO sub-header text); below, **"אנשים בלוח"**: Members + Owners rows with avatar stacks; clicking opens the people-picker.
- MAIN: selected role title + 1-line description; **category cards** with illustrations (disc: דיון / נושאים ונקודות / משימות; task: ONE card "שדות משימה" with delete as a row, icon = the tasks/status-pills illustration; system: מערכת). NO redundant section title above the rows.
- Checkbox rows per category. Owner cells implied (owners bypass). Disclaimer line: advisory, not security. Note: multiple roles = union.
- **People-picker** (monday standard): search field with a magnifying-glass icon and NO placeholder text; groups labeled **"People"** / **"Teams"**; under People show only 2-3 by default and filter by typed characters; already-added rows show **"Already added"** (English, no checkboxes); Teams group has **"Everyone at yomsheni-il"** (team `-1`).
- Persist via `updateSettings({ permissions })` (whole-object write from modal state). Pre-fill from the LOCKED seed when enabling.

## Owners/Members + API (requires API version **2026-07**)
App is on 2026-04; bump to 2026-07 (needed for `photo_url { small }`). **Verify the bump does not break existing queries — especially `board_relation` — by running the full suite + build.** If it breaks, revert the bump and flag.
- List: `query { boards (ids: $id) { owners { id name photo_url { small } } subscribers { id name photo_url { small } } } }`
- Add: `mutation { add_subscribers_to_object(id: $id, user_ids: $ids, kind: SUBSCRIBER|OWNER) { subscribers { id name } } }`
- Remove: `mutation { delete_subscribers_from_board(board_id: $id, user_ids: $ids) { id } }`
- Everyone at account: `mutation ($bid: Int!) { add_teams_to_board(board_id: $bid, kind: subscriber, team_ids: [-1]) { id } }` — **no removal call** (one-way).
- GOTCHAS (verified live): these subscriber/team mutations use **`Int!`** ids, NOT `ID!` — passing an `ID!` variable fails with "Graphql validation errors". And the `kind` enum casing DIFFERS by mutation: `add_teams_to_board` (TEAMS) → lowercase `subscriber`; `add_subscribers_to_object` (USERS) → UPPERCASE `OWNER`/`SUBSCRIBER`. (The `boards(ids:)` READ query is normal `[ID!]`.)
New module `src/utils/mondayApi/subscribers.js` wraps these through `api()` + `assertNoGraphQLErrors` on writes.

## File map
- `src/utils/mondayApi/boards.config.js` — COLUMN_SCHEMA, ALIAS_MIGRATIONS, DEFAULT_PREFERENCES, board-config-store.js. ADD: DEFAULT_PERMISSIONS, CAPABILITY_DEFAULTS, CAPABILITIES catalog, PERMISSION_ROLE_SOURCES, DEFAULT_PERMISSION_SEED.
- `src/contexts/SettingsContext.jsx` — updateSettings (deep-merge done), expose `permissions`.
- `src/hooks/usePermission.js` — NEW (the resolver).
- `src/components/DiscussionCard/DiscussionCard.jsx` — replace inline `canEdit` (~line 68); `persistField` is the single discussion-field write choke point.
- `src/components/DiscussionList/DiscussionList.jsx` — `canEditItem` (~282); createDiscussion entry.
- `src/components/TasksTab/TasksTab.jsx` + `PreviousTasksTab/PreviousTasksTab.jsx` — granular caps; route both through `can()`.
- `src/components/TopicsTab/*` (SortableTopicSection, TopicPointRow) — add/edit/delete/check/responses.
- `src/components/SummaryTab/SummaryTab.jsx` — editable from `editSummary`.
- `src/hooks/useTasks.js` — `createTask` stamps `taskCreatorID`; gate field handlers + batch + bulk.
- `src/hooks/useTopics.js` — the topic/point handlers.
- `src/contexts/ColumnOrderContext`, `TemplatesContext` — reorderColumns / manageTemplates.
- `src/components/SettingsModal/SettingsModal.jsx` — the "הרשאות" tab + people-picker.
- `src/utils/mondayApi/subscribers.js` — NEW; `monday-client.js` — API version.

## Phases (sequential; each: implement → verify(tests+build+review) → fix → commit)
- **0 Plumbing** (inert, enabled:false): config additions + expose permissions. No behavior change.
- **1 Hook + parity**: `usePermission`; replace canEdit/canEditItem keeping a coarse boolean → identical behavior. Heavy parity tests.
- **2 Granular surfaces**: thread per-capability booleans into all tabs/rows/FAB; both task tabs share `can()`. Still legacy-driven → unchanged behavior.
- **3 Owner UI**: the "הרשאות" matrix tab (enable toggle, role list, category cards, checkbox rows, persist). 
- **4 Task fields + globals + stamping**: stamp `taskCreatorID` on create; gate task field handlers + batch + bulk; wire reorderColumns/manageTemplates/createDiscussion.
- **5 Owners/Members + API 2026-07**: subscribers module + people-picker + version bump (verify no breakage; revert+flag if it breaks).
- **Final QA**: full suite + build + whole-diff review against the golden rules.
