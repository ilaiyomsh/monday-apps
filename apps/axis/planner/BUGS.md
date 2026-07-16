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

## 2026-07-16 — Focus card drifts ~½ row on the SECOND focus (virtualizer size cache keyed by index)

**Symptom:** After the px-height fix (below), the focus card STILL sat ~½ row (~14–17px) below its allocation bars — but ONLY after you focused one project, then focused a DIFFERENT one. First focus after load was fine; every focus-SWITCH broke it. The focused header row rendered at 48px (a collapsed height) instead of 65px, squishing its content to 31px and dropping the card ~17px.

**Root cause:** `VirtualRowList.tsx` — `useVirtualizer` had no `getItemKey`, so @tanstack/react-virtual keyed its size cache by ARRAY INDEX. Focusing a project rewrites `flattenedRows` (other classification sections collapse → rows removed; the focused project expands → track rows appear), so a given index maps to a different-height row before vs after. With index keys the stale sizes stuck: the focus-block heights (65 header / 48 track / 55 last-track) landed one row off — the focused header got 48, a track got 65, the collapsed neighbour got 55 — and the card's absolute `top` (which assumes a 48px header content box) dropped ~17px below the bars.

**Why it slipped:** (1) Reproduces ONLY on a focus-SWITCH between projects; a single focus after load is clean, so it hid behind the more obvious px/rem bug and behind stale browser caches. (2) The app renders in a cross-origin monday iframe, so the DOM couldn't be measured from our side — the fix came from a real-DOM `getBoundingClientRect` dump the owner ran in the app-frame console, which showed the focused header at 48px with the height sequence shifted one row off the content. (3) The dev harness initially rendered a project ALREADY focused (no switch) and so showed perfect alignment; it only reproduced once extended to render unfocused → focus p2 → switch to p1.

**Fix:** `getItemKey: (index) => flattenedRows[index]?.id ?? index` on the virtualizer, so the size cache follows each row by its stable id across inserts/removals. Verified in the harness: the focus-switch that produced header=48 now yields header=65 with the card back on the bars.

**Prevention:**
- The harness (`src/harness/`) now renders TWO focusable projects (in a classified section) and exposes `window.__focus(id)`, so the focus-SWITCH path is reproducible for any future Gantt work.
- Rule: any tanstack virtualizer over a list whose contents/length change at runtime MUST set `getItemKey` to a stable id — index keys silently corrupt the size cache on reorder/insert/remove.

---

## 2026-07-15 — Focus-card rows drift below the allocation bars (rem `h-12` vs px 48-grid)

**Symptom:** In projects view, focusing a project showed the summary card's content — the PM/type row, then the hours row — sitting progressively BELOW the allocation bars it must line up with (row 1 slightly low, row 2 more so). Five design PRs (#134→#165) chased it without converging; each "fix" in one place reappeared in another.

**Root cause:** `:root { font-size: 20px }` in `index.css` (intentional, pre-existing) makes Tailwind rem units scale ×1.25. The card rows used `h-12` = **3rem = 60px**, while the whole row grid — `CONFIG.rowHeight = 48` (px literal) — drives the virtualizer, the card's absolute `top`, `cardHeight`, and the track rows. So each card row was 60px against a 48px grid: card and track0 START aligned, but every card row adds 12px, so the misalignment **compounds** downward (measured +6px row1, +18px row2, +30px row3…). The two `h-12` lines even carried comments claiming "48px height so the row lines up 1:1 with the Gantt track grid" — the intent was 48, the rem scale silently delivered 60.

**Why it slipped:** (1) Pure px/symbolic reasoning about the layout says it's aligned — the drift only exists because two unit systems (rem content, px grid) coexist and nothing in the card code reads as "rem". (2) No feedback loop: the app renders inside a cross-origin monday iframe, so the DOM couldn't be measured directly and diagnosis leaned on screenshots — which were themselves often a stale browser cache, hiding whether a given PR even shipped. (3) The 20px root sits four files from the card behind an approving comment, so it read as inert.

**Fix:** `ProjectSummaryCard.tsx` — both card rows now use `style={{ height: CONFIG.rowHeight }}` (px), tied to the same constant as the grid, instead of `h-12`. Verified in a dev-only harness (`src/harness/`, served at `/harness.html` OUTSIDE the iframe) that renders the REAL VirtualRowList/GroupHeaderRow/ProjectSummaryCard/TrackRow with mock data and measures `getBoundingClientRect`: offsets went +6/+18px → **0/0**.

**Prevention:**
- `src/harness/` gives real-DOM geometry feedback for any future Gantt layout work — reproduce-then-fix instead of screenshot guessing (`pnpm server` → `http://localhost:8301/harness.html`; `window.__measure()`).
- Rule captured: **the Gantt grid is px-based (`CONFIG.rowHeight`); anything that must line up with it must be px too — never a rem Tailwind height (`h-*`), because the 20px root makes `h-12` = 60px, not 48px.**
- Regression test in `src/components/Gantt/__tests__/ProjectSummaryCard.rowHeight.test.tsx` asserts the card rows carry an explicit `CONFIG.rowHeight` px height, not a rem class.

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
