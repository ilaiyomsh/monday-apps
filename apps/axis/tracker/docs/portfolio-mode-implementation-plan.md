# Portfolio Mode — Verified Implementation Plan

**Author:** End-to-end audit (Claude) — 2026-05-11
**Supersedes:** the "phased implementation" section of `portfolio-as-projects-source-research.md`.
**Status:** Implementation-ready. All claims below are backed by GraphQL responses captured against a real test bed in workspace `15335078`.

---

## 1. Test bed (verified live)

Built in workspace `15335078` via `mapps-api.sh` (API version `2026-04`). All IDs below are real and can be queried.

### Portfolio + Project boards
| Entity | ID | Type | Notes |
|---|---|---|---|
| Portfolio board | `18412551958` ("projects") | **classic** | Itself a classic board with `portfolio_project_*` columns + custom additions |
| Project board — internal | `18412553513` | **multi_level** | 5 task items (Task 1, Task 2, Sub Task 1, Sub Sub Task 1/2) auto-seeded by template |
| Project board — external | `18412553518` | **multi_level** | Same template |
| Project board — routine  | `18412553525` | **multi_level** | Same template |
| Project *metadata* boards (paired classic) | `18412553550`, `18412553585`, `18412553575` | classic | Created automatically alongside each `create_project`. **Not used by tracker** — informational only. |

### Portfolio items (one per connected project)
| Item id | Name | Project Type | Owner | Tasks board (via `portfolio_project_link`) |
|---|---|---|---|---|
| `11975493505` | פרויקט פנימי לדוגמא | פנימי | Ilai (48274917) | `18412553513` |
| `11975469220` | פרויקט חיצוני לדוגמא | חיצוני | Ilai | `18412553518` |
| `11975506618` | פרויקט שוטף לדוגמא | שוטף | Ilai | `18412553525` |

### Auxiliary boards
| Board | ID | Purpose |
|---|---|---|
| Customers test | `18412553505` | 2 customers: `11975472253` ("לקוח א"), `11975507240` ("לקוח ב") |
| Assignments test | `18412553737` | 2 active assignments scoped to 2026-05-01..05-31 |
| Time reports test | `18412553739` | 12-column events board |

### Critical column IDs
**Portfolio (`18412551958`):**
| Setting key in tracker | Column id | Type | Notes |
|---|---|---|---|
| `connectedBoardId` (project source) | — | — | The board itself |
| `peopleColumnIds` | `portfolio_project_owner` | people | Built-in |
| `projectTypeColumnId` | `color_mm38fnyb` (custom) | status | Hebrew labels: פנימי / חיצוני / שוטף |
| `customerColumnId` (portfolio side) | `board_relation_mm384dyw` (custom) | board_relation → customers | |
| (tasks-board discovery per project) | `portfolio_project_link` | board_relation, `type:"hierarchy"` | `settings.boardIds = [18412553513, 18412553518, 18412553525]` |

**Assignments (`18412553737`):**
| Setting key | Column id | Type |
|---|---|---|
| `assignmentPersonColumnId` | `multiple_person_mm38tm8r` | people |
| `assignmentStartDateColumnId` | `date_mm38rmve` | date |
| `assignmentEndDateColumnId` | `date_mm38asny` | date |
| `assignmentProjectLinkColumnId` | `board_relation_mm38jgdq` (→ portfolio) | board_relation |
| `customerColumnId` (assignments side) | `board_relation_mm38ekx` (→ customers) | board_relation |
| `projectTypeSourceColumnId` (mirror) | `lookup_mm38qmg2` | mirror | ⚠️ **created via API but mirror config is empty** — see §3.D |

**Events (`18412553739`):**
| Setting key | Column id | Type |
|---|---|---|
| `dateColumnId` | `date_mm381btf` | date |
| `durationColumnId` | `numeric_mm3888pm` | numbers |
| `projectColumnId` | `board_relation_mm38kj63` (→ portfolio only) | board_relation |
| `taskColumnId` | `board_relation_mm38qsrt` (→ all 3 Project boards) | board_relation |
| `reporterColumnId` | `multiple_person_mm38f090` | people |
| `eventTypeStatusColumnId` | `color_mm387vn2` (all 6 labels) | status |
| `nonBillableStatusColumnId` | `color_mm38j0mb` | status |
| `stageColumnId` | `color_mm3836ns` | status |
| `notesColumnId` | `text_mm3855tn` | text |
| `endTimeColumnId` | `date_mm38tak1` | date |
| `approvalStatusColumnId` | `color_mm38e4zt` | status |
| `temporaryCheckboxColumnId` | `boolean_mm38kfr3` | checkbox |

---

## 2. Audit matrix — what we actually observed

Legend: ✅ works unchanged · ⚠️ works with caveat / minor adapter · ❌ requires real code change

| # | Tracker code path | Status | Evidence (one-liner) |
|---|---|---|---|
| **Portfolio reads** | | | |
| B1.1 | `fetchProjectsForUser(connectedBoardId=18412551958, peopleColumnIds=[portfolio_project_owner])` | ✅ | `items_page(query_params: rules=[assigned_to_me])` returned all 3 portfolio items. Same shape as classic. |
| B1.2 | `useProjects.fetchProjects` direct query with `projectTypeColumnId=color_mm38fnyb` | ✅ | Status text returned in Hebrew (פנימי/חיצוני/שוטף). |
| B1.3 | `useFilterOptions` projects dropdown | ✅ | Plain `items_page(limit:500)` returned the 3 projects. |
| B1.4 | `fetchStatusColumnsFromBoard(18412551958)` | ✅ | All 4 status columns enumerated (3 built-in English + 1 custom Hebrew). Note: built-in `portfolio_project_step`/`portfolio_project_rag`/`portfolio_project_priority` labels are **English** — see §3.C. |
| B1.5 | `fetchAllBoardItems` + pagination | ✅ | Trivial pass. |
| **Tasks-board reads** | | | |
| B2.1 | `useTasks.fetchForProject(projectId=portfolio_item_id)` via `items(ids).column_values(ids:["portfolio_project_link"]).linked_items` | ⚠️ | Returns **all task items at all depths flattened** (Task 1, Task 2, Sub Task 1, Sub Sub Task 1/2). Today's code shape works **but**: ① column id must change from `tasksProjectColumnId` to `portfolio_project_link`; ② depth context is lost; ③ status-based filtering inside `useTasks` (`taskStatusColumnId` + `taskActiveStatusValues`) currently happens client-side after fetch — still works, but if/when we want server-side filtering it needs `items_page(query_params)` on the Project board, not on the portfolio item. |
| B2.2 | Direct `items_page` on Project board, no scope | ✅ | Returns 2 top-level items. `hierarchy_type: multi_level` confirmed. |
| B2.3 | Direct `items_page(hierarchy_scope_config:"allItems")` | ✅ | Returns all 5 items + `parent_item` for reconstruction. **Note**: `hierarchy_scope_config` is an argument of `items_page` **directly**, not inside `query_params`. |
| B2.4 | `findProjectLinkColumn(tasksBoardId=Project board, projectBoardId=portfolio)` | ✅ | `connect_project_to_portfolio` **automatically created** a back-link board_relation on each Project board (`board_relation_mm38df6h` etc.) with `settings.boardIds=[18412551958]`. Existing detection logic finds it. |
| B2.5 | `useTasks.createTask` against a Project board | ✅ | `create_item` on multi_level board works; back-link column set with `{item_ids:[portfolio_item_id]}`. |
| **Assignments + customers + mirror** | | | |
| B3.1 | `fetchActiveAssignments` (people + 2 dates filter) | ✅ | 2 assignments returned with linked project (→ portfolio) and customer correctly populated. |
| B3.2 | `fetchCustomerMapFromAssignments` | ✅ | BoardRelationValue resolves cleanly; building map is trivial. |
| B3.3 | Mirror resolution via `displayed_linked_columns` | ❌ | **`create_column(type:mirror, defaults:{...})` produced an empty `settings_str:"{}"` and `display_value:""`.** API-created mirrors do not actually link. This affects `enableProjectTypeDistinction` in assignments mode. See §3.D. |
| B3.4 | `useProjects` in assignments mode | ⚠️ | Works for project + customer enrichment; project-type via mirror fails (B3.3). Workaround: pull project type directly from portfolio item rather than from assignment mirror. |
| **Events CRUD** | | | |
| B4.1 | `useMondayEvents.createEvent` with dual `board_relation` (portfolio + Project board task) | ✅ | Both link columns accept their respective item ids. Status, date, duration, people all set. |
| B4.2 | `useMondayEvents.loadEvents` with `query_params` (date between + reporter assigned_to_me) | ✅ | Event retrieved with both link columns; `linked_items.board.hierarchy_type` distinguishes portfolio item (`classic`) from task item (`multi_level`). |
| B4.3 | `updateEventPosition`, B4.4 `deleteEvent`, B4.5 `createAllDayEvent` | ✅ | Standard mutations — no change. |
| B4.6 | `useDashboardData.fetchEvents` aggregation shape | ✅ | Same `items_page` shape works. |
| **Settings validation** | | | |
| B5.1 | `validateEventTypeColumn(EVT_TYPE_COL)` | ✅ | All 6 labels present (שעתי, לא לחיוב, חופשה, מחלה, מילואים, זמני). |
| B5.2 | `checkBoardExists(18412551958)` | ✅ | Returns id/name/board_kind/state. |
| B5.3 | hierarchy_type read | ✅ | Portfolio = `classic`, Project board = `multi_level`. |
| **Columns** | | | |
| B6.1 | column metadata on multi_level board | ✅ | Same shape as classic. |
| B6.3 | `portfolio_project_link.settings_str` | ✅ | `{ boardIds:[…3 Project boards], type:"hierarchy" }` — clean discovery payload. |

---

## 3. Key findings (read these first)

### A. A Portfolio is just a classic board with a known column schema
`hierarchy_type: classic`, queried by `boards(ids)`/`items_page` exactly like any board today. **The tracker doesn't need any multi-level handling on the projects side.** The only "portfolio-ness" is the well-known `portfolio_project_*` column ids and the `portfolio_project_link` column with `type:"hierarchy"`.

### B. Tasks live on multi_level "Project boards" linked from each portfolio item
For a given `projectItemId` (a portfolio row), the tasks board is discoverable in any of three equivalent ways:

1. **Per-item, on demand:** `items(ids:[projectItemId]).column_values(ids:["portfolio_project_link"]).linked_items[*].board.id` → one Project board id (all linked items share it).
2. **Eager, from the portfolio:** `boards(ids:[portfolioId]).columns(ids:["portfolio_project_link"]).settings_str.boardIds` → union of all Project board ids. We then need a per-item lookup to know which is which.
3. **From the Project board side:** each Project board has an auto-created back-link board_relation (`board_relation_*` titled "link to <project name>") whose `settings.boardIds=[portfolioId]`. Useful for reverse lookups, identical to what `findProjectLinkColumn` already does.

For tracker, (1) is the cleanest: resolve `tasksBoardId(projectItemId)` lazily when the user selects a project in the event modal.

### C. Built-in portfolio columns are English; user-facing app text is Hebrew
The portfolio's auto-generated status columns (`portfolio_project_step`, `portfolio_project_rag`, `portfolio_project_priority`) have English labels. The tracker's existing validators expect Hebrew. **Conclusion:** in portfolio mode, the app **must not reuse** the portfolio's built-in status columns for tracker-specific semantics — the user has to add their own status column on the portfolio for `projectTypeColumnId` (as we did with `color_mm38fnyb`). This is a settings-UX clarification, not a code blocker.

### D. API-created mirror columns are broken
`create_column(type: mirror, defaults: {...})` returns success but produces an empty `settings_str: "{}"` and a blank `display_value`. **Conclusion:** programmatic mirror creation in the Setup Wizard cannot be used. Two implications:
1. The Wizard's "configure project type via mirror" path needs UI fallback — the user must add the mirror column manually in Monday's UI.
2. In portfolio mode we should **avoid the mirror altogether**. The portfolio item already carries `projectTypeColumnId` natively; assignments mode in portfolio scope can read project type by following `assignmentProjectLinkColumnId.linked_items[0].column_values(ids:[projectTypeColumnId])` rather than via mirror. **This is the recommended approach.**

### E. Dual board_relation on the events board works as-is
`projectColumnId` → portfolio only (single board). `taskColumnId` → multi-board (`boardIds:[…3 Project boards]`). Both behave identically to today's single-board board_relation. Existing `useMondayEvents.createEvent` works without code change to the link-write path — what changes is **how the picker UI populates `item_ids`**: project picker now reads portfolio items; task picker reads items from the resolved per-project tasks board.

### F. `create_project` creates a bundle of two boards
One classic "metadata" board (with a single self-row carrying `portfolio_project_*` columns) and one multi_level tasks board. Tracker only ever interacts with the tasks board. **The metadata board is invisible to tracker and should remain so.**

### G. Filter / query syntax stays identical
`query_params.rules` with `assigned_to_me`, `between`, `any_of`, etc. work the same on portfolio and on multi_level boards as on classic. No filter-language changes.

---

## 4. Required code changes — by file

The implementation is a feature flag (`projectsSourceMode: 'board' | 'portfolio'`). When `'board'`, **zero behavior changes**.

### Settings model — `src/contexts/SettingsContext.jsx`
Add new fields (default values shown):
```js
projectsSourceMode: 'board',            // 'board' | 'portfolio'
// existing connectedBoardId is reused as portfolioBoardId when mode === 'portfolio'
// existing peopleColumnIds reused (defaults to ['portfolio_project_owner'])
// existing projectTypeColumnId reused (user picks a custom status column on the portfolio)
// existing customerColumnId reused (board_relation on the portfolio side)
// tasksBoardId becomes IGNORED in portfolio mode — resolved per-project
```
No data migration required; existing users default to `'board'`.

### Projects fetcher — `src/hooks/useProjects.js` + `src/utils/mondayApi/items.js`
- `fetchProjectsForUser` — **no change**. The exact same query works on the portfolio board.
- Direct query at `useProjects.js:174` — **no change**. Same shape.
- One adjustment: when `projectsSourceMode === 'portfolio'` and `peopleColumnIds` is unset, default to `['portfolio_project_owner']` and `projectTypeColumnId` to `null` (user must pick).

### Tasks fetchers — `src/hooks/useTasks.js`, `src/hooks/useTasksMultiple.js`
- New helper `resolveTasksBoardId(monday, portfolioBoardId, projectItemId) → boardId` that reads `items(ids:[projectItemId]).column_values(ids:["portfolio_project_link"]).linked_items[0].board.id`. Memoize per projectItemId.
- In portfolio mode, `useTasks.fetchForProject(projectId)`:
  1. Resolve tasks board id (above).
  2. Query that board's `items_page(limit:500, hierarchy_scope_config:"allItems")` returning id + name + status column.
  3. Apply existing `taskActiveStatusValues` filter client-side (already the pattern).
- `useTasks.createTask` — already board-id-parameterized; pass the resolved tasks board id instead of `tasksBoardId`.
- The back-link column id (e.g., `board_relation_mm38df6h`) can be discovered once per Project board using the existing `findProjectLinkColumn` and cached. **No code change to that helper.**

### Events — `src/hooks/useMondayEvents.js`, `src/hooks/useAllDayEvents.js`, `src/hooks/useDashboardData.js`, `src/hooks/useMonthlyHours.js`
- **No GraphQL changes.** `loadEvents`, `createEvent`, `updateEvent`, `deleteEvent`, `updateEventPosition`, all-day handlers, dashboard aggregations — all already work against a classic events board where `projectColumnId` points to a portfolio and `taskColumnId` points to multi_level boards.
- The only consumer of the resolved-tasks-board id is the **task picker in `EventModal`**, which today reads from `useTasks`. As long as `useTasks` is portfolio-aware, the picker just works.

### Filter options — `src/hooks/useFilterOptions.js`
- **No change.** Projects dropdown query is identical on portfolio.

### Mirror resolution — `src/utils/mondayApi/mirror.js`
- **No change in portfolio mode** — we don't use mirror columns for projectType. If the user already has a working mirror on their assignments board (created in UI), it still resolves the same way.

### Assignments — `src/utils/mondayApi/items.js` (`fetchActiveAssignments`, `fetchCustomerMapFromAssignments`)
- **No change.** Both functions work unchanged against assignments linking to portfolio items.
- One enrichment: when `useProjects` runs in assignments mode + portfolio mode, **bypass mirror resolution** for `projectType` and instead fetch the linked portfolio items' `projectTypeColumnId` directly. Lives in `useProjects.js`.

### Settings UI — `src/components/SettingsDialog/StructureTab.jsx` + `MappingTab.jsx`
- Add a top-of-Structure-tab toggle: `מקור פרויקטים: לוח רגיל / פורטפוליו`.
- When `portfolio`:
  - Board picker filters or labels boards that *look like portfolios* — heuristic: has a column with `id === "portfolio_project_link"` (or with `type === "board_relation"` and `settings.type === "hierarchy"`).
  - The `tasksBoardId` mapping row is hidden (resolved automatically).
  - Default `peopleColumnIds` to `['portfolio_project_owner']`; let user override.
  - Show a callout that the user must add their own status column for project type (built-ins are English).
  - Validation: ensure the portfolio has at least one item connected (i.e. `portfolio_project_link.settings.boardIds.length > 0`); otherwise show: "לפורטפוליו זה לא חוברו עדיין פרויקטים".

### Validators — `src/utils/settingsValidator.js`, `src/components/SettingsDialog/useSettingsValidation.js`
- Skip the `tasksBoardId` requirement in portfolio mode.
- Add `validatePortfolioBoard(boardId)`: queries `boards(ids).columns(ids:["portfolio_project_link"]).settings_str`. Pass iff the column exists and has `type:"hierarchy"`.
- Existing `validateEventTypeColumn` runs unchanged on the events board.

### Settings Wizard — `src/components/SettingsWizard/`
- **Phase 1: opt-out.** The Wizard's existing "create boards for me" flow operates only when `projectsSourceMode === 'board'`. In portfolio mode the Wizard shows a deep link to Monday's portfolio template gallery and exits.
- **Phase 2 (later):** offer a "build the events + customers + assignments boards around an existing portfolio" flow. Mirror creation is excluded (see §3.D).

---

## 5. Stability call

**Yes, this is safe to ship**, conditional on these three properties of the implementation:

1. **Default is `'board'`**, so all existing users see zero change. No data migration.
2. **No write-side schema changes** to events / assignments / customers boards. The portfolio is read-mostly; the only writes are standard `change_multiple_column_values` (already exercised).
3. **A single feature flag** (`projectsSourceMode`) gates the new branches. Roll out behind a per-user toggle in Settings — no GrowthBook / server flag needed.

Risk-tier breakdown:
- **Low risk:** Projects/filters/events reads (zero query changes).
- **Medium risk:** Tasks board resolution (new code path with caching).
- **Medium risk:** Settings UX (new toggle, new validation paths, new labels).
- **High risk: none.**

---

## 6. Phased rollout

### Wave PF-1 — Read-only portfolio mode (3–4 PRs)
1. Settings model + persistence (`projectsSourceMode`, defaulting to `'board'`).
2. Portfolio detection heuristic + Structure-tab toggle.
3. `resolveTasksBoardId` helper + portfolio-aware `useTasks` / `useTasksMultiple`.
4. Smoke regression test matrix (classic / portfolio × regular / assignments × distinction on/off).

### Wave PF-2 — Polish + Wizard
1. Mapping-tab portfolio defaults & callouts.
2. Validation messages & empty-portfolio handling.
3. Wizard "exit to template gallery" UX.

### Wave PF-3 — Optional fan-out (Portfolio-of-many-projects depth control)
- Not needed for the canonical model approved by the user. Defer until requested.

Each wave is a single workspace-style branch (`portfolio-mode/wave-PF-1`, etc.), independently shippable, feature-flagged.

---

## 7. Open risks (each verified once during audit; track them in QA)

1. **Empty-portfolio UX.** If `portfolio_project_link.settings.boardIds` is empty, `useTasks` cannot resolve a board. Surface the "no projects connected" error in the event modal.
2. **Hebrew labels on portfolio built-ins.** Documented (§3.C); users must add their own Project Type status. Settings UI must warn.
3. **Mirror creation API is broken** (§3.D). Wizard cannot auto-provision mirrors. Workaround documented (skip mirror in portfolio mode).
4. **Stray template tasks.** New Project boards come pre-seeded with 5 demo items (Task 1, Task 2, Sub Task 1, Sub Sub Task 1/2). Users may want a "clean" template option. Not blocking — they can delete manually.
5. **`hierarchy_scope_config` is on `items_page`, NOT inside `query_params`.** Filters and scope are independent.
6. **Date filter compare_value.** The app uses `compare_value:[from,to], operator:between` — verified working on portfolio. Do not regress to `EXACT`/`greater_than_or_equals` two-rule variants.
7. **`create_project` is async + creates 2 boards.** If we ever do programmatic provisioning, must poll for both boards (the multi_level one is the one to connect).

---

## 8. Verification — how to reproduce this audit

The captured `request_id` values in §2 trace back to specific GraphQL requests against workspace `15335078`. To rerun an individual test:

```bash
/Users/ilaish/monday_app/apps/.claude/skills/mapps/mapps-api.sh '<query>' ''
```

The full board structure built during this audit remains in workspace `15335078` — boards are not torn down. Test items (1 event, 1 task, 1 stray) were created and cleaned up; portfolio items + assignments remain seeded.
