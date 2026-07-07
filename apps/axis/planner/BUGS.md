# Bug Log

Postmortems for non-trivial bugs in Planner. Each entry should capture **what the symptom looked like**, **why the root cause was easy to miss**, and **what we changed so it (or its lookalikes) won't bite again**.

Order: newest first. Keep entries terse — one entry should fit on a screen.

---

## Template

```
## YYYY-MM-DD — One-line title

**Symptom:** What the user saw.

**Root cause:** What was actually wrong (file:line if useful).

**Why it slipped:** What made detection / diagnosis hard. The interesting part.

**Fix:** Commit hash(es) + one-line description.

**Prevention:** Code, process, or doc change that makes this class of bug harder next time. Link to the actual change.
```

---

## 2026-06-15 — "Unknown Project" rows (root items(ids:) 25-item page cap)

**Symptom:** With "show past" ON, ~9 projects rendered as "Unknown Project" under the "אחר" (no-classification) section; with it OFF, ~3. The projects clearly existed and were named on the board.

**Root cause:** `mondayService.ts` — `fetchProjectsByIds` (and the `projects:` alias in `fetchCriticalBundle`) used monday's **root `items(ids:)`** query, which defaults to a **25-item page**. The code chunked ids by 100, so any allocation window with >25 distinct projects silently got names for only the first 25 — the rest had no `projectDataMap` entry → `allocation.projectName` empty → `groupAllocations` labels the group "Unknown Project" (`allocationUtils.ts:74`), and with no project there's no classification → bucketed under "אחר". The past window referenced 34 distinct projects → 9 unnamed; the merge/transform order surfaced 3 even with past hidden.

**Why it slipped:** (1) The demo's current/future set is 24 distinct projects — just under the 25 cap — so the critical path looked fine; only the wider past window (34) exceeded it. (2) Debugging via the API reproduced the SAME cap: `items(ids:[34])` returned 25, which read as "9 projects were deleted." Querying the 9 ids directly returned all 9 as `active` with names — proving truncation, not deletion. The tell: `items(ids:[...], limit:100)` returned all 34.

**Fix:** added `limit: 100` to both root `items(ids:)` queries in `mondayService.ts` (the chunk size is ≤100, and 100 is monday's max page). Introduced with the #90 batched-`items(ids)` project-metadata approach; surfaced once a window crossed 25 distinct projects.

**Prevention:** `CLAUDE.md` already mandates running new monday queries in the Playground — extended in spirit here: **root `items(ids:)` MUST carry an explicit `limit` (default page is 25, not "all the ids you passed")**. Comments added at both call sites. At 4× scale the current/future path would have hit this too.

**Symptom:** In future months the company-load row showed real utilization (e.g. `יועץ בטיחות` 101% in Q1 2027) but expanding the projects showed **no bars** for those allocations — "load with nothing underneath". Reproduced live in Demo 8.6; the data and the monday API were fine (a direct query returned all 12 future allocations with their project + role).

**Root cause:** `useAllocations.ts`. The Gantt loads in stages for fast startup — Stage 1 `fetchAllocations()` (allocations crossing TODAY) and a one-shot background Stage 2 `fetchFutureAllocations()` (`startDate > TODAY`). Stage 1 did a wholesale `setRawAllocations(filteredAllocations)` **replace**; Stage 2 did an **append**. Any Stage-1 run that landed *after* the append wiped the future allocations, and the one-shot guard (`backgroundFetchDoneRef`) meant Stage 2 never re-ran. Meanwhile the company-load row is fed by a *separate* date-range fetch (`fetchWorkloadItemsForRole`) that still counted them — hence load with no bars.

**Why it slipped:**
1. Two independent data sources for the same numbers: bars come from `rawAllocations` (current + future stages), the load row from a date-range workload fetch. Only the bars suffered the clobber, so the two disagreed silently.
2. `loading` initialises to `false`, so on the initial load Stage 2's effect (`if (loading || !settings) return`) fires on mount and — having fewer `await`s than Stage 1 — resolves *first*, appending to an empty array that Stage 1 then replaced. So it broke on a clean load with **no user action**, not just after edits.
3. `refresh()` (= `fetchAllocations`) runs after every create/edit/delete and on any settings change, re-triggering the same replace each time.

**Fix:** Added pure `mergeAllocationsById(existing, incoming)` to `allocationUtils.ts` (incoming wins per id, other windows preserved, idempotent). `useAllocations.fetchAllocations` now **merges** by id on the same board and only **replaces** on an actual board switch (tracked via `lastBoardIdRef`; the initial `undefined → board` is treated as merge so a raced-in future survives). The future and past stages merge with the same helper. Multi-stage fast startup is unchanged.

**Prevention:**
- Regression tests in `src/hooks/__tests__/useAllocations.futureClobber.test.tsx` exercise the real hook orchestration and lock in: append works, the initial-load race survives, `refresh()` preserves future, and a board switch still replaces. Plus unit tests for `mergeAllocationsById`.
- Rule of thumb captured here: **a multi-stage loader must merge, never replace** — any stage that owns one date window must not clobber another window's data.
- Known limitation (not a regression): switching the configured board at runtime clears future bars until a reload, because the one-shot future fetch is not re-armed on board change (re-arming would race the current-window replace).

---

## 2026-05-12 — Gantt loaded empty for every instance

**Symptom:** No allocations rendered in any instance. No error in console. `[useAllocations] Grouping with: { rawAllocationsCount: 0 }` even though boards had data.

**Root cause:** `mondayService.fetchCurrentAllocations` passed `compare_value: ["2026-05-12"]` to monday's date filter. The documented format is `["TODAY"]` or `["EXACT", "YYYY-MM-DD"]` — a bare date string is invalid. The bad pattern had been in the code since commit `2e49856` (2026-04-24).

**Why it slipped:**
1. For ~17 days monday returned **500 INTERNAL_SERVER_ERROR** on the malformed query. On 2026-05-11 the symptom was misdiagnosed as a transient monday outage; we added retry + `Promise.allSettled` (commits `9204a3d`, `6fb98c9`) which **masked** the bug instead of fixing it.
2. On 2026-05-12 monday silently switched to `success` with **0 items** instead of throwing 500. With no error to fall back on, the resilience layer happily returned an empty array. Gantt was blank with zero diagnostic signal.
3. The correct shape (`["TODAY"]`) was already in production in the sibling `apps/tracker` project — never copied over.

**Fix:** `mondayService.ts` — switched both `fetchCurrentAllocations` and `fetchFutureAllocations` to `compare_value: ["TODAY"]`. Also removed an unrelated `rawAllocations.length === 0` gate in `useAllocations.ts:380` that blocked the background future-fetch when `fetchCurrentAllocations` legitimately returned 0.

**Prevention:**
- `apiQueue.ts`: when monday returns `INTERNAL_SERVER_ERROR`, log the full `response.errors` payload + first 500 chars of the query before retrying. Validation-looking errors will now surface in the console instead of being swallowed by backoff.
- `CLAUDE.md` → "Adding a new Monday GraphQL query": grep sibling apps for an existing pattern, verify against the docs, run once in Playground, and never treat a `Graphql validation errors` 500 as transient before re-verifying the query.
- Memory: `feedback_monday_500_validation.md` — same rule for future Claude sessions.
