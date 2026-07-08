# Planner — Unified Load Performance Plan

**Branch:** `perf/unified-load` (off `design-changes` @3c9acbb)
**Goal:** cut first paint from ~29s to ~10–12s.
**Principle:** fewer round-trips + leaner queries. No data lost, bar color preserved. No hardcoded ids, no blind cache.

## Background (measured 2026-06-14)

- Live demo (5 employees, 23 projects, ~100 active allocations) loads in **~29s**: ~7s iframe/SDK boot + ~21s of **fully sequential** `/v2` calls (0 overlap; avg ~4s each).
- Sequencing is the APP's await chain, not the framework (complexity budget 10M/min; heaviest query 12,296 = 0.12%). The monday SDK proxy adds per-call latency but does not hard-serialize (a light call overlapped).
- Heavy `fetchCurrentAllocations` complexity = 12,296. Breakdown: geometry 3,424 (28%); nested `linked_items` project metadata +4,346 (35%, redundant — project-level data fetched per allocation); `BoardRelation{id name}` +2,750; `MirrorValue` +1,480; People +296.
- Mirror "סה״כ שעות בפועל" (`reportedHoursColumnId`) sums `numeric_mky7eqsf` from time-logs (board 18390430440) via relation; `display_value` returns the FULL per-log list (e.g. 70 values for one allocation), summed in JS at `mondayTransformers.ts:64`. Cost grows with logs-per-allocation over time. It is CRITICAL: sets the allocation bar COLOR (`TaskBar.tsx:258`).

## Three levers

1. **Reported hours: mirror → aggregate by id.** One `aggregate` on the time-logs board: `SUM(durationCol) GROUP BY ID(logsAllocationRelationCol)` → `Map<allocationId, hours>`, server-summed, complexity ~122. Covers ALL windows (current/future/past). Join by id.
2. **Project set + metadata: drop nesting.** "Projects with active allocations" = distinct `linked_item_ids` from the active-allocations result (the projects board is not consulted to decide the set). Project name/PM/type/classification come from one batched `items(ids:[distinct projectIds])` (~30 for 5 ids). Lean allocations query (geometry + `linked_item_ids` only) = 3,128 vs 12,296.
3. **Unify independent queries into ONE document.** allocations(lean) + employees + columns + reported(aggregate) + projects → single `monday.api()` call = one round-trip = one proxy hop. Verified valid (boards aliases + aggregate coexist). PoC: 2.4x faster on API layer (7,575→3,151ms); browser gain expected larger.

## Resolving the logs→allocations connect column (DECIDED)

The reverse connect column on the time-logs board is NOT derivable from the allocations-side column `settings` (both sides expose only `boardIds`; no reflection/partner id — verified). Resolution happens at SETTINGS time and is persisted:

- New persisted setting: **`timeLogsAllocationColumnId`**.
- When user selects `reportedHoursColumnId` (mirror): read its `settings` (parsed JSON `settings` field, NEVER `settings_str`) → logs board id + duration col. Query the logs board's `board_relation` columns; filter those whose `settings.boardIds` includes the allocations board id.
  - 1 candidate → auto-map it.
  - 2+ candidates → default to first, show a dropdown to switch.
  - 0 candidates → warn; aggregate path disabled, fall back to mirror.
- **Migration:** installs with `reportedHoursColumnId` set but no `timeLogsAllocationColumnId` auto-populate the first match once on load.
- **Load path:** read the persisted id only — no runtime discovery/guessing. Empty ⇒ fallback to legacy mirror path.

Logs board id + duration col are DERIVED from the mirror `settings` at runtime (single source of truth, stays in sync). Only the non-derivable connect column is persisted.

## Implementation phases

### Phase 0 — guardrails
- `USE_UNIFIED_LOAD` flag to switch new/legacy.
- Keep existing `allocationsApi.getAllWithProjectData` try/catch fallback.

### Phase 1 — additive service functions (no behavior change)
`mondayService.ts`:
- `resolveAggregateConfig(settings)` → `{logsBoardId, durationColId, allocRelationColId}` from mirror `settings` + `settings.timeLogsAllocationColumnId`; null if unresolvable.
- `fetchReportedHoursByAllocation(cfg)` → aggregate → `Map<allocId, hours>`. Handle >500 groups (paginate/loop) — OPEN ITEM.
- `fetchCurrentAllocationsLean(settings)` → current-window items_page, geometry + `board_relation { linked_item_ids }` only.
- `fetchProjectsByIds(projectsBoardId, ids, metaColIds)` → `items(ids)` chunked ~100.

### Phase 2 — unified call + transformers
- `allocationsApi.getCriticalBundle(settings)` → one aliased document; parse to `{allocations, employees, columns, reportedByAllocId, projectDataMap}`.
- `transformMondayItemToAllocation` → `reportedHours` from `reportedByAllocId.get(item.id)` (mirror fallback if map absent).
- Build `projectDataMap` from the `projects` result keyed by projectId (replaces `extractProjectDataFromItems` nesting).

### Phase 3 — wire into `useAllocations.ts`
- Replace sequential `getAllWithProjectData` + `Promise.allSettled([employees, columns])` with one `getCriticalBundle`.
- Store `reportedByAllocId` in a ref so background future + on-demand past join the same map (bar color in all windows).
- Future/past stay background / on-demand.

### Phase 4 — settings UI + migration + validation
- `settings.types.ts`: add `timeLogsAllocationColumnId`.
- `SettingsDialog.tsx`: auto-detect on `reportedHoursColumnId` change; dropdown when 2+ candidates.
- Migration: one-time auto-populate on settings load.
- `useSettingsValidation.ts`: validate the column still exists and targets the allocations board (fail-loud).

### Phase 5 — measure & clean
- Build, load in browser, measure `/v2` via `performance.getEntriesByType('resource')`. Target: ≤2 critical calls, first paint ≤ ~14s.
- If validated: remove mirror from the critical path, keep fallback, drop the flag.

## Open items / risks
- `aggregate` pagination beyond 500 groups (4x scale + past allocations).
- `items(ids)` id-count cap → chunk.
- Aliased-boards complexity reporting returns 0 (cosmetic; budget irrelevant).
- Correctness verified: aggregate 110.4 == display_value sum for alloc 11219055578.
- Join by id only.
