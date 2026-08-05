# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`discussions` (ניהול דיונים) is a monday.com **client-side board-view app** — React 19 + Vite 8,
served statically from monday's CDN (no server). It was exported from the monday Vibe builder
(`10387085`) and then rebuilt to follow the `Axis/tracker` app's architecture: one unified `src/`,
`@vibe/core` design system, a `monday-sdk-js` API layer wrapped in `safeApi`/`MondayApiError`, and a
single-funnel observability stack. The UI is **Hebrew-first and RTL**.

## Commands

```bash
npm run dev            # Vite dev server at http://localhost:5180
npm run build          # production build -> build/  (NOT dist/)
npm run preview        # preview the build/ output
npm test               # vitest in watch mode
npm run test:run       # run the whole suite once (CI)
npm run tunnel         # expose :5180 to monday for in-product testing (app 11457413)
```

Run a **single test**:
```bash
npx vitest run src/components/SettingsGate/__tests__/settingsGate.test.jsx   # one file
npx vitest run -t "renders the status text"                                  # by test-name pattern
```

There is **no separate `vitest.config.js`** — test config lives in the `test:` block of
`vite.config.js` (jsdom, `setupFiles: ./src/setupTests.js`, CSS modules `classNameStrategy:
'non-scoped'`). `setupTests.js` imports `./i18n` (so Hebrew strings resolve) and stubs
`matchMedia`/`ResizeObserver`/`IntersectionObserver` (jsdom lacks them; `@vibe/core` needs them).

**Deploy is manual — do not deploy unless explicitly asked.** Deploy via the mapps skill ship
procedure (one gated confirmation question; it rebuilds and force-pushes internally) — do not run
`npm run deploy`/`mapps code:push` directly. Because the app is client-side,
the monday-code server tooling (`code:logs`, `code:status`) does **not** apply — runtime
observability is client-side only (see below).

## Path aliases (`vite.config.js`)

`@generated` → `src` · `@components` → `src/components` · `@api` → `src/utils/mondayApi`.
These appear everywhere, including `index.jsx` importing the app as `@generated/App.jsx`.

## Architecture (the parts that span multiple files)

### Boot order is load-bearing — see `src/index.jsx`
`@vibe/core/tokens` → `index.css` → `init` (window.global polyfill) → `i18n` →
`setupGlobalErrorHandlers()` (before React mounts) → `<ErrorBoundary><MondayProvider>
<SettingsProvider><SettingsGate><TemplatesProvider><App/>`. **`SettingsGate`**
(`components/SettingsGate` — extracted from index.jsx in round337 so it is testable) **blocks
render** until settings are loaded and published to the SDK store, so every API call already has
its board/column mapping. Its branch ORDER is the point: `<Loader>` while loading; a **FAILED
load** (`loadError` from SettingsContext) shows `NetworkErrorScreen` with a retry — NOT the
first-run wizard (round337: before that, a transient storage failure at boot showed a configured
user the wizard, one click from provisioning duplicate boards); nothing stored → `SetupWizard`,
whose manual path **force-mounts `SettingsModal` with NO `onClose` prop at all** (a no-op function
is truthy and used to leave a dead X rendered — the modal now hides the X when `onClose` is
absent). `TemplatesProvider` sits *inside* the gate (it reads `monday.storage` but, unlike
settings, never blocks render — see below). Reordering or skipping a step breaks styling or SDK
init.

### Settings-driven board/column mapping — the central idea
Nothing hardcodes board or column IDs. The code refers to columns by per-board **aliases** that
follow a uniform convention — descriptive English camelCase + an UPPER `ID` suffix
(`discussionDateID`, `detailsID`, `topicsLinkID`, `responsibilityID`, `statusID`, …), namespaced
per board (so `discussionLinkID` legitimately exists on both tasks and topics). The real monday IDs
(e.g. `date_mkz5k0wf`) live **only** in `src/utils/mondayApi/boards.config.js` (`COLUMN_SCHEMA`,
`BOARD_CLASS_TO_KEY`). These aliases were renamed from the original Vibe generic names
(`column1`, `tasksLink`, …); the OLD→NEW map is `ALIAS_MIGRATIONS` in the same file, and
`SettingsContext.load` calls `migrateColumnAliases()` once to re-key any stored mapping so renames
never lose an instance's config. **To rename an alias, edit BOTH `COLUMN_SCHEMA` and
`ALIAS_MIGRATIONS`.** To **retire** one, deleting the schema entry is NOT enough — stored
settings are merged OVER the schema, so add it to **`RETIRED_COLUMN_ALIASES`** and
`pruneRetiredSettings` (called from `SettingsContext.load`, after the rename migration and
before `reconcileColumns`) clears its three traces: the column mapping, the
`permissions.roles['<board>:<alias>']` row, and the `preferences.accessRoleSources` key.
It deliberately never touches the monday board column itself. Retiring a **capability**
has the same trap one level down: dropping it from `CAPABILITIES` hides the matrix row but
leaves the boolean in every instance's stored `capabilities` map, so list it in
**`RETIRED_CAPABILITIES`** too — the same prune clears it from every role (round343 retired
`editResponses` that way).
Flow:
- `boards.config.js` is the seed/default mapping. **To fix a wrong mapping, edit it HERE.**
- `SettingsContext` loads a per-instance override from `monday.storage` (key
  `discussions_settings_${instanceId}`, falling back to `boardId`/`'default'`), merges it over
  the defaults, and calls `setActiveConfig(...)` to publish into the module-level singleton
  `board-config-store.js`.
- `BoardSDK.js` resolves aliases→IDs at query time via `getBoardId(boardKey)`/`getColumns(boardKey)`.
  Config changes are therefore instant (the store isn't cached per query).
- `components/SettingsModal` (gear button, owner-only) edits the mapping at runtime and persists
  via `updateSettings`. Each `COLUMNS[board][alias]` carries `verified`: `true` = confirmed write
  path; `false` = best-effort read-only/display field (formula/mirror) — safe to correct.

### monday API layer — every call goes through one boundary
`src/utils/mondayApi/`:
- `client.js` — **`safeApi`** is the single SDK wrapper: validates the query (warns on
  `undefined`/`null`/`NaN` ids), logs (`logger.api`/`apiResponse`/`apiError`), retries transient
  failures (`executeWithRetry`, ≤2 retries, 429/500/502/503 + rate-limit/complexity/network
  patterns, exponential 2s/4s), and wraps hard errors in **`MondayApiError`** (carries query,
  variables, response, duration, correlationId for log-once dedup). It returns the **raw response
  and does NOT throw on GraphQL soft-errors** — it only logs them.
- `monday-client.js` — exposes `api(query, vars, fnName)` which calls `safeApi` then
  `assertNoGraphQLErrors`, returning `res.data`; also `parseValue`/`formatValue` (the only place
  that (de)serializes monday `column_values` ↔ app shapes: date, status, dropdown, checkbox,
  people, `board_relation`, etc.) and the `monday` SDK singleton. Auth is seamless inside the
  monday iframe; for local dev set `VITE_MONDAY_TOKEN` in `.env.local`.
- `assertGraphQL.js` — `assertNoGraphQLErrors` throws on soft-errors **without re-logging**
  (inherits the soft-error's correlationId so one failure = one log = one toast).
- `BoardSDK.js` — fluent query/mutation builder reimplementing the Vibe API on top of `api()`.
  Board classes are **Hebrew-named** (`דיונים1Board`, `משימות1Board`, `נושאיםלדיון1Board`),
  imported from `@api/BoardSDK.js`. Supports `items_page` with `query_params` (server-side filter),
  `.orderBy()`, `.withPagination({limit|cursor})`, `.withColumns([...])` (narrows fetched columns),
  and `.withGroup()` (adds `group { id title }` per item — used by the My Tasks board grouping).
  **People-column filters MUST use the `"person-<id>"` compare_value form** — a bare user id is
  silently ignored by monday and matches nothing (verified against the live API + official docs);
  `"assigned_to_me"` is passed through. `_buildQueryParams` emits `person-<id>` for `people` columns.

### Domain model — three related boards
`discussions` (root) → `topics` (linked via a `board_relation`) → `tasks`; `tasks` also link back
to a discussion. The data hooks `useDiscussions` / `useTopics` / `useTasks` (in `src/hooks/`) drive
a `*Board` class each. `useTasks` is a SINGLE narrowed relation read (one `items(ids:[discussionId])`
query reading `linked_items` off `tasksBoardLinkID` with a lean column selection) — the old
"three fallback layers" description was stale and was corrected in round135.

### "My Tasks" tab + per-discussion edit permission
A top-level **`appView`** toggle in `App.jsx` (`'discussions' | 'myTasks'`, persisted to
localStorage `discussions_app_view`, rendered top-left) switches the whole view between the
discussions workspace and a personal **"המשימות שלי"** list. Shared toasts/error modals render for
both views; the discussions-only modals (Settings/Templates/Create) stay inside the discussions branch.

- **My Tasks** (`src/components/MyTasksView/` + `src/hooks/useMyTasks.js`) is **client-only** (no
  server): it reads the TASKS board directly (not a discussion relation), filtered **server-side** to
  the current user via the responsibility people column `responsibilityID` (`assigned-to-me`, `person-<id>`),
  with cursor pagination. **Filter / Sort / Group all run CLIENT-SIDE** over the loaded page so they
  never re-fetch (no skeleton flash). Grouping by discussion/status/priority lives in `grouping.js`;
  defaults are **EMPTY** (no sort/group/filter) unless a **shared saved view** exists — see below. The name column is **sticky-left
  (frozen)** and clicking the name (only) opens the item card on Updates
  (`monday.execute('openItemCard', { itemId, kind:'updates' })`). The toolbar is monday-style English
  pills (Search/Filter/Sort/Group by/Collapse) using **`@vibe/icons`**.
- **Shared saved views** — every builder panel (Filter/Sort/Group in My Tasks; Group in TasksTab;
  Filter/Group in PreviousTasksTab) has a **Save** button next to Clear that persists that control's
  current selection as the LOAD-TIME state for **all users** of the instance, under
  `settings.preferences.savedViews.{myTasks|tasksTab|previousTasks}` (hook `useSavedViews`; filters
  are JSON-safe via `serializeFilter`/`deserializeFilter` in `controls.js` — Sets/Date don't survive
  storage). In-session changes stay session-only (the old `my_tasks_group_by` localStorage
  persistence was removed). Save visibility is gated by the system capability **`saveViewDefaults`**
  (default owners-only; the owner can open it to all members via a checkbox in the permissions tab's
  "כללי" card).
- Two TASKS columns exist for this tab **ONLY** — added to `COLUMN_SCHEMA.tasks` +
  `TASKS_SETTINGS_FIELDS`, but deliberately NOT rendered in the existing TasksTab/PreviousTasksTab
  tables: **`priorityID`** (a SECOND status column whose label DISPLAY order defines priority) and
  **`taskNotesID`** (long_text, inline-editable notes). **Both are provisioned + auto-mapped
  since round340** (before that they were owner-mapped only, so on a fresh install neither
  column existed and both cells silently hid); the owner can still remap them in Settings.
  `useStatusOptions('tasks', alias)` is parameterized to read either status column's labels/order.
  `priorityID`'s provisioned label IDs are chosen for their COLOURS — `create_column` ignores
  `labels_colors` and binds colour to the label id (see `PRIORITY_DEFAULTS`).
  **The GRAY DEFAULT label (stable id 5) is the empty state (round353 §3):** provisioning writes
  "טרם החל"/"טרם נבחרה" onto label 5 itself (no extra labels), and `useStatusOptions` exposes its
  text as `emptyLabel` — every tasks status/priority surface renders that for an EMPTY value
  (falling back to the old "ללא סטאטוס"/"בחר סטאטוס" strings when label 5 has no text). monday
  never auto-assigns id 5, so the app-side rendering is what makes the gray label read as the
  default. Decision-board surfaces were deliberately left on the old strings.

### "Previous tasks" tab — three resolution modes
`PreviousTasksTab` resolves the tasks it shows in one of three modes, chosen by the owner in Settings
and stored under **`settings.preferences.previousTasksMode`** (`'linkedDiscussion'` |
`'discussionType'` | `'auto'` — **`'auto'` is the default since round340**; constants
`PREVIOUS_TASKS_MODES` / `DEFAULT_PREFERENCES` in `boards.config.js`). A single derived `byType` flag drives every downstream effect/branch in the tab
(and `CreateDiscussionModal.hidePreviousDiscussion`).
`settings.preferences` is a top-level settings key alongside `boards`/`columns` (merged by
`updateSettings`), NOT a board mapping.
- **`linkedDiscussion`** (original): reads the current discussion's `previousDiscussionID`
  board_relation → loads that discussion's tasks off its `tasksBoardLinkID` relation.
- **`discussionType`**: shows ALL tasks of the current discussion's TYPE, regardless of link. Backed
  by a THIRD TASKS status column **`taskTypeID`** ("סוג דיון") that MIRRORS the discussions board's
  `discussionTypeID` labels. `useTasks(discussionId, discussionTypeId)` stamps every newly-created
  task's `taskTypeID` with the parent discussion's type, bridging the two INDEPENDENT status columns
  **by label TEXT** (their label ids differ) via `useStatusOptions`. The tab then filters the TASKS
  board **server-side** with `BoardSDK.where({ taskTypeID })` (status `any_of`). Only NEW tasks are
  classified — existing tasks aren't backfilled. If `taskTypeID` is unmapped or has no same-text
  label, stamping/filtering degrade gracefully (no write, empty view). The owner maps `taskTypeID`
  in Settings (`TASKS_SETTINGS_FIELDS`); a managed column shares labels automatically.
- **`auto`**: a per-DISCUSSION hybrid — a discussion that HAS a type resolves by type (as
  `discussionType`), one WITHOUT a type falls back to the `linkedDiscussion` link path. Implemented
  purely by making `byType` also true when `mode === auto && discussion.discussionTypeID != null`; no
  new resolution code. `CreateDiscussionModal` shows "דיון קודם" only for untyped discussions in this
  mode (its `hidePreviousDiscussion` is derived from the live `discussionType` selection).

**Per-discussion edit gate** — now that the app is open to all users, discussion **content is
read-only** unless the current user is a board owner (`canManageSettings`), the discussion creator
(`discussionCreatorID`), or its lead (`discussionLeadID`). `DiscussionCard` computes a single `canEdit`
and threads it through every edit surface — `TasksTab`, `TopicsTab`/`TopicPointRow`, `SummaryTab`
(RichTextEditor `editable={false}`), `PreviousTasksTab`, the inline title edit, and the new-task FAB
— each degrading to read-only (mutation handlers omitted/no-op, add/delete/drag controls hidden, a
"צפייה בלבד" chip shown). `DiscussionList` enforces the same gate **per row** on the edit/delete
kebab (`discussionCreatorID`/`discussionLeadID` were added to its list query). The My Tasks tab **is
matrix-gated per task** (since 2026-07-03): status/priority/deadline/name edits + bulk delete each check
their task-tier capability (`editTask*`/`deleteTask`) against the TASK's own people columns
(creator/responsible) — there is no parent discussion in that surface, so `resolveCan` takes `{ item }`
alone (readiness + the fail-open path fall back to the task item; see `usePermission.js`). With the
permissions feature OFF this resolves to "creator/responsible edit their own tasks", which — because the
view only shows tasks assigned to me — reproduces the old ungated behavior. Notes stays ungated (no
matrix capability). Deadline is a `DatePickerPopover` cell; rename is a hover-pencil (name click still
opens the item card).

### Provisioning puts every board in one folder — "בסיס מידע" (round345)

`provisionAllBoards` (`utils/mondayApi/provisionBoards.js`) creates the folder **before** the
boards and ends with every board inside it. The order is load-bearing, not incidental:

1. workspace from the caller (`context.workspaceId`), else read off the host board;
2. folder created **first** when the workspace is already known — the discussions board of a
   custom-object install is then created inside it;
3. when the workspace is NOT known (custom object with no `workspaceId` in context, and no host
   board) the discussions board is created first and the workspace is read **off it** — the only
   reliable source in that install;
4. the remaining boards are created with `folder_id`;
5. anything that could not be born inside the folder — a board-view host board, a board reused
   from an existing mapping, a connected tasks board, or the board from step 3 — is **moved** in
   with `update_board_hierarchy` (`moveBoardsIntoFolder`). This is also what puts a pre-folder
   installation's boards in place: re-running the wizard is enough, since provisioning reuses a
   mapped board and never re-creates it.

**`ensureProvisionFolder(null)` refuses to do anything** — verified live: `folders(workspace_ids:
[null])` is not "the main workspace", it returns folders from an unrelated workspace, so the old
code searched the wrong place and then created "בסיס מידע" somewhere the app never looks. No
workspace ⇒ no folder, boards at the root, warning logged. Every step is fail-soft: folder
placement is cosmetic, the returned mapping is not, so nothing here may abort an install.

**The folder needs an OAuth SCOPE the app must declare: `workspaces:write`.** `boards:write`
does not cover `create_folder` — without it monday refuses every folder attempt, the fail-soft
path leaves the boards at the workspace root, and nothing looks broken. That is exactly what
happened across rounds 339/342/345, three "the folder still isn't there" reports against code
that was already correct. A probe with a personal token CANNOT reproduce it (full permissions).
round346 therefore makes the failure loud: `ensureProvisionFolder` returns
`{ folderId, reason }`, and provisioning emits ONE `logger.error` — which the funnel turns into
a Hebrew toast and ships to Axiom — naming `workspaces:write` when the platform answer looks
like an authorization refusal. The scope itself is a Developer Center setting; agents never
touch it.

**Adding the scope in the Developer Center is NOT enough (round352, fourth report).** Scope
edits land on the **draft version** only; they take effect when that version is **promoted to
live**, and then every installed account must **re-approve** the permissions (in-app banner /
reinstall) — official docs, confirmed 2026-08-05. The owner added the scope and the next
install still had loose boards precisely because of this. The failure toast now spells out the
whole path (scope → promote → re-approve). Promotion also consumes the draft: create a new
draft version right after (manifest export→import), or the next `deploy-draft` run fails.

There is **no settings button** for this any more (round345 removed the round342 one) — if you are
tempted to add one, make provisioning do it instead.

### An install seeds ONE discussion type + its template (round347)

`src/utils/defaultTypeTemplate.js` holds the shipped starting point — type **"דיון כללי"**
with a three-topic agenda — and `SetupWizard.handleCreate` seeds it right after
`updateSettings`. A type exists only when TWO stores agree: the **label** on the managed
"סוג דיון" dropdown (what a discussion stores) and the **type template** in `monday.storage`
(agenda + roles, keyed by the label TEXT). The installing user goes into BOTH `lead` and
`coordinator` — the two roles carrying the discussion-tier permissions.

Two rules that are easy to break:
- **Order:** the label add must run AFTER `updateSettings`, because `addDropdownLabel` resolves
  the board/column from the ACTIVE settings store, which `updateSettings` publishes.
- **Seed, never migrate:** `seedDefaultTypeTemplate` writes ONLY into an empty type-template
  store (a legacy bare-array store counts as non-empty), so a top-up run can never overwrite
  the types an account built itself.

Both steps are fail-soft and reported — the install has already succeeded by then, and a type
can be added by hand in תבניות.

**round348 — the wizard runs in TWO worlds, and it must know which.** First-run it is mounted by
`SettingsGate` ABOVE `TemplatesProvider`; in TOP-UP it renders inside the Settings modal, i.e.
INSIDE that provider, which has already loaded the type templates exactly once. So the wizard
reads `TemplatesContext` directly (`useTemplates()` returns a no-op empty store when unprovided
and therefore hides the distinction): provider mounted ⇒ seed via `upsertTypeTemplate` so the
in-memory list updates; no provider ⇒ the direct storage write, which the provider will read when
it mounts. Seeding a mounted provider through storage leaves the type selectable with no agenda
until a reload. And `seedDefaultTypeTemplate` distinguishes **`already-default`** (ours is in the
store ⇒ the LABEL is worth retrying, since a label that failed once would otherwise never be
retried) from **`skipped-existing`** (the account's own types ⇒ leave it alone).

### Two `monday.storage`-only subsystems — no board backing
monday's public API has no item-position mutation and no place to hang reusable presets, so two
features live entirely in `monday.storage` (each mirrors `SettingsContext`'s pattern: JSON value,
5s timeout, `instanceId`→`boardId`→`'default'` key fallback). They do **not** gate render and
start empty when storage is unavailable (local dev):
- **Templates** (`src/utils/templates.js` + `src/contexts/TemplatesContext.jsx`, available to all
  users). Two independent stores under separate keys: *topic* templates
  (`discussions_templates_${instanceId}`, shape `{id, name, topics:[{name, points:string[]}]}` —
  **names only, no monday ids**) and *participant* templates
  (`discussions_participant_templates_${instanceId}`, a named set of people matching the
  `PersonPicker` selection shape). `createTopicsFromTemplate()` reuses the **same**
  `create_item`/`create_subitem` paths as `useTopics.addTopic`/`addPoint`;
  `readDiscussionTopicsAsTemplate()` reads a discussion's topics back into template shape to power
  "duplicate discussion". Applied at creation (`CreateDiscussionModal`) or into an existing
  discussion (`ApplyTemplateMenu` in `TopicsTab`); edited in `TemplateManagerModal`.
- **Topic/point ordering** (`src/utils/topicOrder.js`). Drag-reorder can't persist as native board
  order, so an explicit per-discussion order map (`discussions_topic_order_${discussionId}`, shape
  `{topics:string[], points:{[topicId]:string[]}}`) is saved on drop and re-applied via
  `applyOrder()` on every read. Defensive: saved ids first, unknown ids keep API order at the end,
  deleted ids drop out.

### Cross-board permission roles (round341)
A decision's entitled managers (יוצר / מוביל / מרכז דיון) hold people columns on the
**discussions** board, but both the permissions matrix (`buildTierRoles`) and the resolver
(`boardRoleEntries`) are single-board by construction. **`TIER_EXTRA_ROLE_SOURCES`** in
`boards.config.js` is the declared exception: keyed by the ITEM board, listing
discussion-board aliases whose role keys stay `discussions:<alias>` — so one role has ONE
stored capabilities map, shared with its discussion-tier grants. The resolver reads those
people off `ctx.discussion` in the in-discussion tab and off the row's `__discussionRoles`
stamp in the personal views (`useMyDecisions.stampDiscussionRoles`, one query per page,
fail-soft). It is part of the role-scan UNION, not an early `return true` — that is what
makes an unchecked matrix box actually revoke. It replaced a hardcoded override that no
checkbox could revoke; **don't reintroduce one** — add to this map instead.

### Observability — one funnel, do not bypass it
Every error converges on **`logger.emit`** (`src/utils/logger.js`), which stamps `__loggedId` for
dedup and fans out to sinks. `useUiErrorSink` (mounted once) registers a sink that turns every
`ERROR`-level record into a Hebrew **toast** with a "details" action (`ErrorDetailsModal`).
Layered catches all feed the same logger: `ErrorBoundary` (render crashes), `globalErrorHandler`
(`window.onerror`/`unhandledrejection`), `safeApi` (API), and `SettingsContext` (storage — its
`loadError` drives `NetworkErrorScreen`, mounted by `SettingsGate` on a boot-time load failure;
until round337 that screen existed but was mounted by NOTHING). `lazyRetry` handles code-split chunk-load
failures with one sessionStorage-guarded reload. The remote `flush` transport is stubbed (no URL
wired yet).

### UI conventions
- One folder per component: `Component.jsx` + `Component.module.css` + `index.js` re-export.
  CSS Modules use `classNameStrategy: 'non-scoped'`, so class names are plain (`.root`, `.item`) —
  name deliberately to avoid collisions, and use `:global(...)` to reach `@vibe/core` internals.
- `@vibe/core` is **v4**: pass string literals (`kind="primary"`, `size="small"`), not the old
  enums; `Modal` needs `show` + `id`; `TextField` `onChange(value, event)` vs `TextArea`
  `onChange(event)`. `docs/vibe-core-api.md` is the v3→v4 quick reference.
- Domain colors come from `src/styles/theme-tokens.css` (`--status-*`, `--dept-*`), consumed inline
  (e.g. `hsl(var(--status-done))`) and keyed off **hardcoded Hebrew** status/department strings
  (`constants/deptConfig.js`) — a board schema label change breaks the color mapping.
- i18n (`react-i18next`, `he` default) — **deliberate scope, decided by the owner 2026-07-17
  (round150, closes audit stage 4's i18n item):** the app is Hebrew-first BY DESIGN and no full
  i18n migration is planned. The scaffold stays and serves ONLY the error/toast/network layer
  (ErrorDetailsModal, Toast, NetworkErrorScreen, My Tasks strings) — keep those going through
  `t()`; every other UI string is written as inline Hebrew, on purpose. Don't "helpfully" migrate
  inline strings to `t()`. Use `useStableT()` (memoized `t`) when `t` is in a hook's dependency
  array.
- Multi-select UX in task lists is intentionally monday-like and duplicated in both
  `src/components/TasksTab/TasksTab.jsx` and `src/components/PreviousTasksTab/PreviousTasksTab.jsx`:
  a floating selection bar (`left: selected count`, `center: actions`, `right: close/X`) plus
  a per-group header checkbox that selects/clears all tasks in that group. Keep behavior/style
  aligned between both tabs unless explicitly diverging product requirements.

## Pitfalls / don'ts

- **Never `console.*` in app code** — log through `logger.*` or the error is invisible to the toast
  funnel and skips dedup.
- **Write paths must call `assertNoGraphQLErrors` right after `safeApi`** — `safeApi` won't throw on
  soft-errors, so a skipped assert means a silent failure that looks like success.
- **`BoardSDK.withColumns([...])` now DOES narrow** the fetched columns (older comments claiming it
  is ignored are stale). When `.withColumns` is omitted it fetches every configured column so
  `mapItem` can deserialize; columns referenced in the `where`-filter are always included regardless.
- **People-column server filters need `"person-<id>"`**, never a bare user id (monday silently
  returns zero matches) — go through `BoardSDK` `where`, which formats it for you.
- **`manualChunks` in `vite.config.js` must stay a function** — Vite 8 / rolldown rejects the object
  form.
- **Stale comments reference files that don't exist**: `client.js` mentions
  `items.js/boards.js/columns.js/mirror.js` and `boards.config.js` mentions `board-sdk-core.js` —
  the real fetch/format logic lives in `BoardSDK.js` + `monday-client.js`. Don't go looking for
  those files.
- Build output is **`build/`** (deployed), while `dist/` may exist as a stale artifact — don't
  confuse them.
- App id used by the npm scripts/tunnel/deploy AND `.env` APPID is **`11457413`**; the Vibe
  builder URL id is `10387085` (not deployable). `11452469` is the OLD app 'ניהול דיונים'
  (an earlier iteration) — never deploy to it. (.env aligned to 11457413 on 2026-07-02.)
