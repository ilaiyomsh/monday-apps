# Planner Load Refactor — State & Decisions (session handoff)

Written 2026-06-14. Purpose: hand off to a fresh session with minimal context.
Read this + `PERF-UNIFIED-LOAD-PLAN.md` first.

## 1. STATUS

- **Branch:** `perf/unified-load` (off `design-changes` @3c9acbb). NOT pushed / not merged.
- **Commits:** `f2c4214` (unified-load impl) → `d6bbe7f` (settings array-shape fix). Temp perf markers were added then fully removed; working tree clean.
- **change-tracker #90:** OPEN (not closed). Close with `/close_change` when done.
- **DEPLOYED TO PRODUCTION** (force): app `10787117`, client-side, version `13082844`, live. Clean build (no markers).
- **Migration confirmed live:** `timeLogsAllocationColumnId` auto-mapped to `board_relation_mm00yzj2`. Unified path ACTIVE in prod (verified: cfg=true, reportedKeys=140).

## 2. WHAT WAS BUILT (#90)

Unified critical-path load. Two GraphQL round-trips instead of ~6 sequential:
- **docA:** allocations(lean: geometry + `board_relation { linked_item_ids }` only) + employees + columns.
- **docB:** reported-hours aggregate `SUM(duration) GROUP BY ID(logs→alloc relation)` + projects `items(ids)` metadata.
- Reported hours (bar color source) now from the aggregate, joined by **id**; project metadata from `items(ids)`, not nested `linked_items`.
- New persisted setting **`timeLogsAllocationColumnId`** (the logs-board connect column back to allocations). Auto-detected at settings time from the reportedHours mirror's logs board, default-first when ambiguous, settings-UI dropdown, one-time migration in `useMondaySettings`.
- Gated by `USE_UNIFIED_LOAD` (constants.ts); legacy mirror path is the fallback when settings unmapped.

**Files changed:** `services/mondayService.ts` (resolveAggregateConfig, fetchReportedHoursByAllocation, fetchCurrentAllocationsLean, fetchProjectsByIds, findLogsAllocationColumns, fetchCriticalBundle, _drainItemsCursor, extractMirrorLogsConfig helpers), `services/allocationsApi.ts` (getCriticalBundle), `utils/mondayTransformers.ts` (linked_item_ids support, reportedByAllocId/projectDataMap opts, buildProjectDataMapFromProjects), `hooks/useAllocations.ts` (unified branch + reportedHoursRef), `hooks/useMondaySettings.ts` (migration), `components/Settings/SettingsDialog.tsx` (connect-col dropdown), `types/settings.types.ts`, `utils/constants.ts`.

**Critical bug found & fixed (d6bbe7f):** the `settings` field returns `displayed_linked_columns` as an ARRAY `[{board_id, column_ids}]`, while `settings_str` returns an OBJECT `{ "<boardId>": ["<colId>"] }`. Code assumed object → detection found 0 candidates → unified path silently never activated. `extractMirrorLogsConfig` now handles both shapes.

## 3. MEASURED RESULTS (live, marker-based, fresh tab)

Metric = critical path: `fetch-start` → `critical-ready` (the spinner-blocking load).
- **Legacy:** ~6–8.6s. **Unified:** **4.4s** (docA 2.8s + docB 1.6s, sequential).
- In-browser the monday SDK proxy still serializes calls (overlaps=0). Win = fewer + leaner calls, NOT parallelism. (CLI PoC showed 2.4x; proxy caps in-browser.)
- Boot ~7–12s (variable, platform iframe+SDK) now dominates. Bundle 956KB → possible follow-up (#91: code-split to cut boot).
- The ~21s "waterfall" measured earlier was misleading: it included BACKGROUND calls (future, photos) AFTER the spinner cleared. The real blocking path is the fetch-start→critical-ready number.

## 4. 20-vs-23 PROJECTS — RESOLVED, NOT A REGRESSION

- Projects board 8492920955: 82 projects, all classified via `color_mm19gaez` ("סוג"): 73 external / 9 internal / 0 empty.
- 24 distinct projects have current allocations: 19 external / 5 internal. Only 1 future allocation (its project already in the current set).
- Gantt initially shows allocation-projects only (`activeProjects` loads lazily on "+" open). Once "+" is opened, `groupAllocations` (allocationUtils.ts:53) pre-populates an empty group per active project → active-no-allocation rows appear. **Existing behavior, unaffected by #90.**
- "+" dropdown (AddProjectDropdown.tsx) correctly shows active-without-allocation, excludes inactive, classified into sections.
- The 20↔23 difference was test-tab noise (activeProjects loaded in some tabs, not others).

## 5. PRODUCT SPEC — AGREED (target behavior)

1. **Helper table** (`projectDataMap`) = ALL active projects, with data for the project card.
2. **Fetch current + future allocations together** (single filter `endDate ≥ today`); the Gantt renders ONLY projects that have an active (current or future) allocation.
3. All active projects WITHOUT an active allocation → the **"+" add-project list**.
4. **Past allocations:** always loaded in the background; after they land → compute company load over the full window → THEN show the load circles.
5. **"Show past" toggle** = show/hide past **bars only**. Past DATA is always loaded (needed for the load calc).
6. When "show past" is ON → projects that have only past allocations also appear in the projects column.
7. **Future** loads with current (initial fetch), NOT background-after. Confirmed this does not materially slow first paint.

## 6. OPEN DECISIONS (decide before implementing the next phase)

1. ✅ **DECIDED (2026-06-14): Past allocations on INACTIVE/finished projects.** The LOAD CALCULATION (circles) must ALWAYS include ALL allocations — past + inactive-project allocations — independent of the "show past" toggle and independent of project active/inactive status; otherwise the circles are wrong. **Separate concern: bar render vs load calc.** When "show past" is ON, bars for inactive-project allocations ARE shown but **dimmed/muted**. `projectDataMap` must therefore include ALL projects (active + inactive that have allocations) for card metadata + dimming. The "inactive never shown" rule is overridden for this case: correctness of the load number wins.
2. ✅ **DECIDED (2026-06-14): Load window.** Forward = load EVERYTHING (all future, no cap). Backward = **1 year** on initial load, then **fetch-more on scroll** past the loaded window. The load-calc window = the actually-loaded window. On any recompute (new data landed) → show **skeleton** on the circles; never show partial/incorrect values. "Prefer showing data later over showing wrong data."
3. ✅ **DECIDED (2026-06-14): Company-load row during the gap** = skeleton (never partial/0%). Aligned with #2: skeleton on circles during any recompute.
4. ✅ **DECIDED (2026-06-14): Past-fetch failure fallback** = **error state + retry**, NOT compute-from-partial. Show an error/skeleton state on the circles (never a misleading number), auto-retry, plus a manual "try again". Honors "prefer data later over wrong data": if past can't load, circles stay in error state rather than showing a current+future-only number.
5. ✅ **DECIDED (2026-06-14): Employee view parity** = **YES, identical** in both `viewMode='projects'` and `viewMode='employees'` — same fetch/window/toggle/load-calc. Same underlying allocations; only the grouping differs.
6. ✅ **DECIDED (2026-06-14): Past at scale** = **1 year back as default** (windowed, NOT full-load-all-past). Backward fetch-more on scroll. Keeps initial background load to ~1 page; circles past >1yr fill only on scroll-back.

## 6b. FINAL DECISIONS — IMPLEMENTATION CONTRACT (2026-06-14)

The agreed target behavior, consolidated for the implementer:

1. **Fetch window.** Forward = ALL future (filter `endDate ≥ today`, no cap), in the initial critical/early fetch. Backward = **1 year** initial (background), then **fetch-more = +1 year per step, triggered near the edge** (debounced) on scroll-back.
2. **Load calc ≠ bar render (the core separation).** Company-load circles ALWAYS computed over the FULL loaded window across ALL allocations — including past and including allocations of INACTIVE/finished projects. Independent of the "show past" toggle and of project status. Bars are the only thing the toggle gates.
3. **"Show past" toggle** = show/hide PAST BARS only. Data + load calc unaffected.
4. **Inactive-project bars,** when "show past" is ON, ARE rendered but **dimmed/muted**.
5. **`projectDataMap` = ALL projects** (active + inactive that have any loaded allocation) — for card metadata + dimming. Merge with `ActiveProjectsContext` (already fetches active w/ columns); add inactive-with-allocations rather than double-fetching.
6. **Recompute → skeleton on circles.** Any time new data lands and load is recomputed, circles show skeleton until correct. Never show partial/incorrect values. "Prefer data later over wrong data."
7. **Past-fetch failure → error state + retry** on the circles (auto-retry + manual). Never fall back to a current+future-only number.
8. **Both view modes** (`projects` + `employees`) get identical fetch/window/toggle/load-calc behavior.

## 6c. IMPLEMENTATION PHASE — DONE + REVIEWED (2026-06-14, workflow `planner-unified-load-impl`)

The §6b contract was implemented via a workflow (understand → design → implement → 3 adversarial reviews). **COMMITTED `a0c9ac6` on `design-changes` (NOT pushed to origin) + DEPLOYED to PRODUCTION 2026-06-14** (app `10787117`, version `13082844`, force-override; live at cdn2.monday.app). (NOTE: #90 commits f2c4214+d6bbe7f also live on `design-changes` HEAD, not on the stale `perf/unified-load` branch which is parked at the pre-#90 base 3c9acbb.) `pnpm build` green; `useAllocations` tests 8/8. Live-API verified: forward(59)+backward(89)=148 board items, exact endDate partition, `between` not silent-zero. UI runtime (skeleton/dimming/fetch-more) NOT yet observed in-browser — verify post-deploy.

**Files changed (~23):** mondayService.ts (forward filter→`endDate>=TODAY`; new `fetchPastAllocationsWindow` lean `between`; deleted dead fetchFutureAllocations/fetchCurrentAllocationsLean/fetchPastAllocations), allocationsApi.ts (`getPastAllocations`→{allocations, projectDataMapDelta}), useAllocations.ts (pastLoadState/earliestLoadedRef/runPastWindow/fetchMorePast/retryPast/loadSettling + always-background-past + auto-retry), useCompanyLoad.ts (comment), GanttProvider.tsx (dataWindow memo, mergedProjectDataMap, toggle decoupled, fetch-more wired), useDataFlattener.ts (recomputing/loadError/isInactiveProject), useInfiniteTimeline.ts (debounced near-edge fetch-more), TrackRow/RowRenderer/TaskBar (isDimmed), LoadCell/CompanyLoadRow/EmployeeLoadRow (skeleton+error/retry), ActiveProjectsContext.tsx (eager bg load), FilterDropdown/GanttContext (toggle spinner removed), tokens.css (`--opacity-bar-inactive: 0.45`), gantt.types.ts, i18n he/en, futureClobber test rewrite.

**Review findings — FIXED in this session:**
- ✅ BLOCKER (hooks): LoadCell `useMemo(circleColor)` ran after the error/recomputing early-returns → crash on state flip. De-memoized to a plain call.
- ✅ BLOCKER (Rule 4/8): `isInactiveProject` mass-dimmed every bar in employees view (group.id=employeeId vs project-id set). Now gated `viewMode==='projects'`.
- ✅ MAJOR (Rule 2): `pastExhaustedRef` set on ANY empty window → a gap year truncated older history. Now requires 2 consecutive empty windows (`consecutiveEmptyPastRef`).
- ✅ MAJOR (race/Rule 1): background-past gated on the racy `loading` flag → raced the critical bundle + ran before `employees` set. Added `criticalDone` state gate (set false at fetch start, true after commit).
- ✅ MAJOR (Rule 6): partial number flashed (a) at first paint while idle and (b) when dataWindow extension triggered an absences refetch. `loadSettling` now covers `idle` (unified); GanttProvider passes `loadRecomputing = loadSettling || absencesLoading` to the flattener.
- ✅ MINOR: ActiveProjectsContext eager `doFetch` had no in-flight guard → duplicate fetch. Added `doFetchInFlightRef`.

**Review findings — STILL OPEN:**
- ✅ RESOLVED (2026-06-14, user decision): legacy fallback degradation ACCEPTED. When `useUnified=false` the legacy path loads ONLY crosses-today (no future/past). Rationale (user): there are no un-remapped old boards; if one exists the settings-validation surfaces the missing-config warning and the user maps the columns → unified. No code added; documented as a known limitation. (Option 2 of the 3 offered.)
- ✅ RESOLVED (#91, 2026-06-14): `mergedProjectDataMap` shadow — now tracks `patchedProjectIds` and overlays optimistic local PM/type edits over the board-fresh data, so an edit shows immediately in the filter options.
- ✅ RESOLVED (#91, 2026-06-14): the `TaskTrackRow`/`'TASK'` path was fully DEAD (no producer emits `'TASK'` rows) — removed entirely (component + RowRenderer case + `TaskRow` type) rather than wiring dimming into dead code.
- ✅ RESOLVED (#91, 2026-06-14): stale `useAvailability.dayoff` test fixed — assertion `capacity 16→8` to match the deployed #88 behavior (personal absence excluded from the role denominator). Full suite now 324/324.
- follow-up: smoke-test the new backward `between` query in monday Playground; validate forward=ALL-future vs 4.4s critical path on the largest board; `REPORTED_HOURS_AGG_LIMIT=500` truncation risk as distinct-alloc count grows.

## 6d. SKELETON-TOO-LONG HOTFIX (2026-06-14, post-deploy, browser-verified)

User reported the load-circle skeleton lingered ~10s after the Gantt was already interactive. Root cause: the Rule-6 skeleton was a SINGLE GLOBAL flag (`loadRecomputing = past-window-pending OR absencesLoading`), so every circle — incl. the visible 2026 ones — stayed grey until the background past window AND the wide-window absence fetch both landed. But a per-period circle for month M only depends on M's data.

Two follow-up commits (deployed to prod, force, same version slot):
- `ef11f3f` — replaced the global flag with a PER-PERIOD `LoadGate` (settledFromTs/pastPending/pastError/onRetry). Each circle skeletons only if ITS periodStart < the loaded-back bound and the past window is still in flight.
- (next commit) — dropped `absencesLoading` from the gate entirely. Live measurement showed it was the real long pole (all circles filled together when absences landed, masking the per-period scoping). A not-yet-loaded absence only nudges the denominator slightly and self-corrects; missing PAST allocations (the large error) are still guarded by the per-period skeleton.

**Browser-verified (clean single tab):** Gantt renders ~20s in (platform/iframe boot dominates, NOT our code) with ALL visible company-load circles already populated (69/82/73/64/73/32/14/0…) — no grey tail. (An earlier 43s-blank run was contention from 3 simultaneously open heavy app tabs, not a regression.)

## 7. GAP: CURRENT CODE vs AGREED SPEC (what the next session must change)

- **Future:** currently background-after-critical (`useAllocations` future effect gated on `loading`). Spec wants it in the initial fetch → change the lean allocations filter from `start≤today≤end` to `endDate ≥ today` (covers current+future in one query); drop/ fold the separate future-background fetch.
- **Past:** currently ON-DEMAND (`loadPastAllocations` fires on toggle). Spec wants ALWAYS background + toggle only hides bars.
- **Company load:** currently computed from whatever is loaded (can show misleading partial/0% for unloaded buckets). Spec wants compute-after-past + window = loaded window. See `useCompanyLoad.ts`.
- **projectDataMap:** currently = allocation projects only (built in `fetchCriticalBundle`/`buildProjectDataMapFromProjects`). Spec wants = all active projects (for cards). `ActiveProjectsContext` already fetches all active projects with columns (incl classification) — reconcile/merge rather than double-fetch.

## 8. KEY IDS (this demo / system)

- Allocations board `18397378295`; project relation `board_relation_mkzc6g38` → projects board `8492920955`.
- Logs relation (alloc→logs) `board_relation_mkzynqjs` → time-logs board `18390430440`; reverse (logs→alloc) connect `board_relation_mm00yzj2`; duration col `numeric_mky7eqsf`; reportedHours mirror `lookup_mkzym6b7`.
- Classification col `color_mm19gaez` ("סוג"); employees board `18397378999`.
- Planner view (custom object) URL: `https://yomsheni-il.monday.com/custom_objects/18401684584`.

## 9. AGGREGATE REFERENCE
Full cookbook: `Axis/AGGREGATE-COOKBOOK.md`. Key gotchas: `group_by.column_id` references a select element's `as` alias; use `function: ID` on a board_relation to get the linked id (NOT `LABEL` which gives the name); `PERSON` 500s — use `LABEL`. Always join by id, never name.
