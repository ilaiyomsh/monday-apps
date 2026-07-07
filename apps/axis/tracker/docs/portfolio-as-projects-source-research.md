# Research: Monday.com Portfolio as a Projects Source

**Author:** Research draft (Claude) — 2026-05-11
**Status:** Research / Pre-design. Not approved scope.
**Scope:** Evaluate whether the tracker app can let users pick a **Portfolio solution Project board** (multi-level board) instead of a classic board for `connectedBoardId` ("projects board"), and what changes are required to keep the app stable.

---

## 1. What "Portfolio" actually is on monday.com

The Portfolio solution is **Enterprise-only** and is built out of two new board kinds plus the existing classic boards:

| Concept | Description | API hierarchy_type |
|---|---|---|
| **Portfolio board** | A roll-up board that connects multiple Project boards via Connect Boards + Mirror columns. Provides cross-project overview. | `classic` (it is itself a regular board with connect-boards columns), but created via `create_portfolio` |
| **Project board** | The board users actually work in. **Multi-level board** — supports up to **5 levels of subitems**, all sharing the same board ID and column structure. | `multi_level` |
| **Classic board** | Today's default. Subitems live on a separate hidden subitems board with a different ID and columns. | `classic` |

Key API facts (from `ask_developer_docs` + monday changelog/docs):

- **`create_portfolio` mutation** — available since 2025-08-18, API `2025-10`. Args: `boardName`, `boardPrivacy`, `destinationWorkspaceId`. Returns `success / message / solution_live_version_id`.
- **`create_project` mutation** — available from API `2026-04`+ (`CreateProjectInput`: `name`, `board_kind`, `workspace_id`, `folder_id`, `template_id` *or* `companions: ["resource_planner"]`, optional async `callback_url`). Returns `CreateProjectResult { success, message, error, process_id }`.
- **`ConvertBoardToProjectInput`** — converts an existing board into a Project board. Requires `column_mappings { project_owner, project_status, project_timeline }`.
- **Querying projects** — there is **no dedicated `projects` root query**. Project boards are queried via the standard `boards(...)` query, **but** they are **not returned by default** — you must pass `hierarchy_types: [multi_level]` (or `[classic, multi_level]` to get both).
- **Reading items on a Project board** — `items_page` returns **only top-level items by default**. To get all depths flattened, pass `hierarchy_scope_config: "allItems"`. `parent_item` field reconstructs the tree. The `subitems` field returns **all descendants flattened**, not just direct children.
- **Same board ID at every depth.** Mutations on subitems still use the parent Project board's id.
- **Same column structure at every depth.** A `status`/`people`/`text` column applies to items at every level.

Sources:
- developer.monday.com — [Portfolio Other Types](https://developer.monday.com/api-reference/reference/portfolio-other-types)
- developer.monday.com — [Working with multi-level boards](https://developer.monday.com/api-reference/docs/working-with-multi-level-boards)
- developer.monday.com — [Changelog: create_portfolio](https://developer.monday.com/api-reference/changelog/new-create_portfolio-mutation)
- support.monday.com — [The portfolio solution](https://support.monday.com/hc/en-us/articles/13337066797202)
- support.monday.com — [Project boards](https://support.monday.com/hc/en-us/articles/22598441769746)

---

## 2. What "use a Portfolio as the projects source" should mean for tracker

There are two distinct user intents. They are **not the same** and need to be disambiguated before implementation:

**Option A — Use a single Project (multi-level) board as `connectedBoardId`.**
The user picks one Project board; tracker treats its items (top-level or all depths, configurable) as the project list. *Cheapest path, closest to today's model.*

**Option B — Use a Portfolio board as `connectedBoardId`, and resolve the actual projects from the linked Project boards.**
The user picks the Portfolio board. Tracker walks the portfolio's connect-boards column to discover the linked Project boards, then lists the items from each. This is what most enterprise customers will *expect* from "choose a portfolio". *Much more complex — fan-out queries, board-of-boards.*

Recommend implementing **Option A first** (it covers ~80% of the value and is incremental on today's architecture), then adding Option B as a follow-up if there's demand.

---

## 3. Touchpoints in the tracker codebase — where it assumes a classic board

(From a codebase audit; line numbers approximate.)

### 3.1 Projects list & filtering
| File | Concern |
|---|---|
| `hooks/useProjects.js:174` — `boards(ids: ${connectedBoardId}) { items_page(...) }` | No `hierarchy_scope_config`. On a multi-level Project board this returns **only top-level items**. Likely wrong if the user expects sub-projects as "projects". |
| `utils/mondayApi/items.js:128` — `fetchProjectsForUser` | Same: `items_page` without hierarchy scope; relies on `query_params` filtering on people columns. Subitem-level people columns won't be reached. |
| `hooks/useFilterOptions.js:206,238` — projects dropdown | Same flat assumption. |
| `hooks/useMondayEvents.js` `rulesToGraphQL` | Filters on the **reporting (events) board**, not the projects board. **Not affected** by portfolio change — leave as is. |

### 3.2 Tasks ↔ Projects link
| File | Concern |
|---|---|
| `utils/mondayApi/items.js:175` — `findProjectLinkColumn` | Searches `tasksBoardId` columns for a `board_relation` whose `settings.boardIds` contains `projectBoardId`. **Should still work** if the tasks board genuinely connects to the project board; needs verification that `board_relation.settings.boardIds` is populated when linking a classic board to a Project board (it is; connect-boards is type-agnostic). |
| `utils/mondayApi/items.js:210` — `createTask` | Sets `{ item_ids: [projectId] }` on the link column. Compatible with Project boards. |

### 3.3 Project type distinction (פנימי/חיצוני)
| File | Concern |
|---|---|
| `utils/eventTypeMapping.js` + `mondayApi/mirror.js:45-65` — resolves `projectTypeColumnId` either as a status column on the projects board, or as a mirror column on the assignments board pointing to a status column on the projects board. | Column reads via `boards(ids).columns(ids).settings` are **type-agnostic**: status columns exist at every depth of a Project board with the **same id and settings**. ✅ Should work as-is. |

### 3.4 Settings, validation, wizard
| File | Concern |
|---|---|
| `contexts/SettingsContext.jsx:50` | `connectedBoardId: null` default — neutral. No schema migration needed. |
| `components/SettingsDialog/MappingTab.jsx` | Board picker calls `fetchPeopleColumns`/`fetchProjectTasksColumns` etc. against `connectedBoardId`. These queries are column-list queries and work on Project boards too — but the picker UI doesn't currently let the user **discover** Project boards, because nothing passes `hierarchy_types: [multi_level]` when listing boards. **Needs change.** |
| `components/SettingsWizard/useBoardBuilder.js` + `constants.js` | Templated board creation flow assumes classic boards. Out of scope for Phase 1 — wizard can simply opt-out of Project boards (or just not offer to create one). |
| `utils/settingsValidator.js:24,66` | `boards(ids).columns` / `boards(ids){id,name}` — type-agnostic. ✅ |
| `components/SettingsDialog/useSettingsValidation.js` | Doesn't gate on board kind. Fine. |

### 3.5 Filter board, employees board
| File | Concern |
|---|---|
| `hooks/useFilterOptions.js` (filter projects + employees boards) | Treated the same as `connectedBoardId`. Same fix (pass `hierarchy_scope_config` if a multi-level board is selected). |

### 3.6 Assignments mode
| File | Concern |
|---|---|
| `utils/mondayApi/items.js:516` — `fetchActiveAssignments` | Operates on the **assignments board**, which is independent — typically classic. If users put assignments on a Project board this would also need scope config, but that's a corner case. |
| Project link inside assignments (`assignmentProjectLinkColumnId`) → resolves to source items via `BoardRelationValue.linked_items` | board_relation linking *to* a Project board returns linked items normally (Monday flattens this server-side). ✅ Should work. |

### 3.7 Dashboards / misc
| `components/Dashboard/Dashboard.jsx`, `hooks/useBoardOwner.js`, `hooks/useColumnOptions.js` | All read columns or owner, type-agnostic. ✅ |

---

## 4. Concrete API changes required

These are the *minimum* changes to make Option A work safely:

### 4.1 Make Project boards selectable in the picker
Any place that **lists boards for the user to pick** (Mapping tab, Filters tab, Wizard) must request `hierarchy_types: [classic, multi_level]`. Without it, Project boards simply don't appear.

### 4.2 Add `hierarchy_scope_config` to `items_page` queries against the projects board
Two queries to change:
- `fetchProjectsForUser` (`items.js`)
- `useProjects.js` direct query at line ~174
- `useFilterOptions.js` projects dropdown query

Decision needed (UI setting): does the user want **top-level only** (default — closest to today) or **all depths flattened** (`allItems`)? Suggest a new setting `projectsHierarchyScope: 'topLevel' | 'allItems'` defaulting to `topLevel`, surfaced in Mapping tab only when the chosen board is `multi_level`.

### 4.3 Detect and store the board's `hierarchy_type` on selection
When a user picks `connectedBoardId`, fetch `hierarchy_type` once and cache it in settings (`connectedBoardHierarchyType`). Use it to:
- Decide whether to expose the scope setting above.
- Decide whether `useProjects` should add `hierarchy_scope_config`.
- Drive validation messages.

### 4.4 Validation
`settingsValidator.checkBoardExists` should also return `hierarchy_type`. If Phase 1 only supports `classic` and `multi_level`, anything else (none expected today) should produce a clear Hebrew error.

### 4.5 Column reads — no change required
All existing `boards(ids).columns(ids){...settings}` queries work identically on Project boards (same column ids/settings across depths). No change in `mondayColumns.js`, `mirror.js`, `useColumnOptions.js`, or column-type validators.

### 4.6 Mutations — no change required
- `createBoardItem` on the **events board** is untouched (events live on the classic reporting board, not the projects board).
- The events board's `projectColumnId` (board_relation) links to the projects board. Linking *to* a Project board uses the same `{ item_ids: [projectId] }` shape. ✅ Verified via docs.

### 4.7 Assignments mode
No change for the common case. If we later support **assignments stored on a Project board**, `fetchActiveAssignments` will also need `hierarchy_scope_config`.

---

## 5. Risks and open questions

1. **`items_page` filter rules + `hierarchy_scope_config: allItems`** — docs state "matching subitems appear alongside their parent items in results". We need to verify that the existing `query_params` people-column filter still works correctly when items at deeper levels do not have the same people column populated (they always have the *column*, but the *value* may be empty). Empty values may be filtered out as expected; needs a manual test.
2. **Pagination cost** — multi-level boards can be much larger. Today's `fetchProjectsForUser` paginates with a cursor; verify nothing assumes a single page.
3. **Permissions** — Project boards have their own visibility model (board_kind: private/public/share). The current user may have read access to the Portfolio but not to some of the linked Project boards. Validation must distinguish "board not found" from "no access".
4. **Hierarchy semantics for "project"** — if a Project board has Programs → Projects → Phases, the user's intent for "project" varies. The `projectsHierarchyScope` setting alone is too coarse; a future improvement is a **depth-picker** (e.g. "use level 2 items as projects"). Out of scope for Phase 1.
5. **Project type distinction via mirror** — when `projectTypeColumnId` is a mirror on the **assignments** board mirroring a status from a **Project board**, `displayed_linked_columns[0]` should still return the source column id; needs a smoke test because mirror resolution paths on multi-level boards are not explicitly documented.
6. **`create_project` / `create_portfolio`** — out of scope for tracker (we never create boards programmatically from runtime). The Settings Wizard's templated-board flow should refuse to operate on `multi_level` boards in Phase 1.
7. **Enterprise gating** — Portfolio is Enterprise-only. Free / Pro accounts will never see Project boards in the picker, so the change is a no-op for them.
8. **Filters board separate from projects board (`filterProjectsBoardId`)** — same multi-level treatment applies; remember to apply Section 4.2 there too.

---

## 6. Recommended phased plan

**Phase 1 — "Project board as projects source" (Option A).** Estimated 1 small wave (≈4–6 PRs):
1. Add `hierarchy_types: [classic, multi_level]` to board pickers in `MappingTab` and `FiltersTab`.
2. Add `connectedBoardHierarchyType` to settings; populate it when `connectedBoardId` changes; persist via `monday.storage.instance`.
3. Add `projectsHierarchyScope` setting (`topLevel` default), shown only when board is `multi_level`.
4. Thread the scope through `fetchProjectsForUser`, `useProjects` direct query, and `useFilterOptions` projects dropdown.
5. Update `settingsValidator.checkBoardExists` to return + validate `hierarchy_type`.
6. Smoke test matrix: classic board (regression), Project board top-level, Project board all-depths; with and without `enableProjectTypeDistinction`; with and without assignments mode.

**Phase 2 — "Portfolio board as projects source" (Option B).** Larger:
- Detect Portfolio board by presence of a connect-boards column listing Project boards.
- Fan-out `fetchProjectsForUser` across each linked Project board.
- Cache the discovered board list.
- New settings UX explaining the relationship.

**Phase 3 — Depth picker.** Allow "use level N items as projects" rather than the all-or-nothing scope toggle.

---

## 7. TL;DR

Yes, this is feasible and **mostly low risk**, because:
- Project boards are queried via the same `boards(...)` query.
- Column ids/settings are stable across depths.
- Board-relation links to Project boards use the same value shape.

The required code changes are concentrated and bounded:
- 3 `items_page` call-sites (`fetchProjectsForUser`, `useProjects`, `useFilterOptions`).
- 2 board-picker call-sites (`MappingTab`, `FiltersTab`).
- 1 validator + 1 settings field (`connectedBoardHierarchyType`, optional `projectsHierarchyScope`).

The biggest *product* question is the one nothing in the code can answer for us: **at what depth is a "project"?** Default to top-level and ship that first; everything else is optional polish.
