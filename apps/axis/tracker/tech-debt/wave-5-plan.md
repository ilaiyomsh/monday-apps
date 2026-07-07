# Wave 5 Plan — `MondayCalendar.jsx` Decomposition (F005)

> **Status:** plan, seeded while Wave 4.1.5 is in review. See `STATUS.md` Wave 5 queue for sub-task tracking.
> Per-task contracts (In-scope / Out-of-scope / Verification baseline) live in `STATUS.md`. This file is the rationale + sequencing context.
> Source-of-truth for extraction *steps*: `ROADMAP.md` §4.1. This wave assigns those steps to numbered PRs.

---

## Context

`src/MondayCalendar.jsx` is 1,906 LOC and has been the central god-component since the project's first audit (F005). It mounts the calendar, owns 30+ pieces of local state, threads 7+ context values into approval handlers, and wires the swipe / selection / undo / approval flows inline. Every feature added since the audit lands here, and the file grows ~+300 LOC every four months. Wave 4 closed the API-layer work (F007 + F013) and the calendar didn't need to change — proof that god-files can shrink without big-bang refactors. Wave 5 is the riskiest decomposition because four of the six Wave-2 integration tests depend on `MondayCalendar` flows.

The safety net is real: `calendar.smoke`, `createTimedEvent`, `createAllDayEvent`, `dragEvent`, `filterByReporter`, `convertTemporary` all mount `<App />` under jsdom. `structureModeSwitch` is the one Wave-2 test that doesn't touch the calendar render. A regression in any extraction step will surface in jsdom before it ships to a tunnel — that's the explicit pre-condition for picking Wave 5 (per ROADMAP "iron rule" #1).

Existing primitives that the wave reuses (do **not** reinvent):

- `useApproval` (`src/hooks/useApproval.js`) — already exposes `approveEvent` / `rejectEvent` / `approveMultiple` / `approveAllPending`. The four `MondayCalendar` wrappers (`handleApproveSelected` / `handleApproveAllInWeek` / `handleApproveEvent` / `handleRejectEvent` at lines 1229–1305) layer toast + reload + selection-clear on top. Step 2 moves that glue into `useApproval` (or a thin sibling hook).
- `useUndoDelete` (`src/hooks/useUndoDelete.js`) — already owns the commit/undo state machine. Step 4's job is to extract the calendar-side wiring (banner ref, dismiss handler, restore-events bridge), not to rewrite the hook.
- `useEventSelection` / `useMultiSelect` — `MondayCalendar` already consumes both. Step 3 extracts the calendar-side glue (selection-mode toggles, exit-on-navigate effects), not new selection state.

This is important because the ROADMAP sequencing was written when those hooks didn't yet exist. Three of the five extraction steps are now "move the wrapper from `MondayCalendar` into the existing hook," not "create a new hook from scratch." That's a meaningful risk reduction vs. the original ROADMAP forecast.

---

## Scope of Wave 5

`src/MondayCalendar.jsx` only. After this wave the file targets ~1,200 LOC (per ROADMAP §4.1 step-5 estimate); deeper splits into child components (down to ~600 LOC) are deferred to **Wave 5.2** or later if Wave 5.1.x lands cleanly. Splitting the JSX render body is a different shape of refactor (component decomposition vs. hook decomposition) and benefits from being its own wave's worth of review attention.

Out of scope for Wave 5:

- `MappingTab.jsx`, `AllDayEventModal.jsx`, `EventModal.jsx`, `useMondayEvents.js` — Waves 6–8.
- `AdditionalTab.jsx` (F011) — Wave 6 absorbs it via `useColumnDiscovery`.
- New retry/queue knobs in the API layer — Wave 4 closed this.
- F004 vulnerabilities, F012 / F027, F023, F025, F030, F031 / F032 / F035 — Wave 9.
- Renaming any prop, state slice, or hook return value. Pure relocation.

---

## Wave 5 sub-tasks

Mirrors Wave 4's pattern: docs-only seed, then small mechanical PRs. Each follows the contract in `STATUS.md` with In-scope / Out-of-scope / Verification baseline, branches off `chore/tech-debt-sweep`, gets reviewed, merges, and promotes the next row.

| # | Sub-task | Branch | Touches | LOC ≈ |
|---|----------|--------|---------|-------|
| 5-plan | This plan + STATUS rows + Wave 4 archive (docs only) | `tech-debt/wave-5-plan` | `tech-debt/{STATUS,ANALYSIS,ROADMAP,wave-5-plan}.md` | — |
| 5.1.0 | Extract `useCalendarSwipe` hook (swipe state + finger-following + adjacent-date compute) | `tech-debt/wave-5.1.0-swipe` | `src/hooks/useCalendarSwipe.js` (new), `src/MondayCalendar.jsx` | −80 |
| 5.1.1a | Move approval-handler logic into `useApproval` (UI side-effects: toast + reload + selection-clear) | `tech-debt/wave-5.1.1a-approval-logic` | `src/hooks/useApproval.js`, `src/MondayCalendar.jsx` | −60 |
| 5.1.1b | Replace inline approval handlers in `MondayCalendar` with hook references; clean up unused state | `tech-debt/wave-5.1.1b-approval-wrappers` | `src/MondayCalendar.jsx` | −40 |
| 5.1.2 | Extract `useCalendarSelection` (selection-mode toggle + exit-on-view-change effects + duplicate/delete handlers) | `tech-debt/wave-5.1.2-selection` | `src/hooks/useCalendarSelection.js` (new), `src/MondayCalendar.jsx` | −120 |
| 5.1.3 | Extract `useUndoState` + integrate `UndoBanner` glue | `tech-debt/wave-5.1.3-undo` | `src/hooks/useUndoState.js` (new), `src/MondayCalendar.jsx` | −80 |
| 5.1.4 | Composition — `useMondayCalendarHooks()` wires the new hooks; render body uses one composite return | `tech-debt/wave-5.1.4-composition` | `src/hooks/useMondayCalendarHooks.js` (new), `src/MondayCalendar.jsx` | −120 |

Total expected reduction: ~500 LOC (1,906 → ~1,400). The ROADMAP §4.1 step-5 target of ~1,200 is reached if 5.1.4's composition pass also pulls helpers like `CustomEventWithProps` / `CustomToolbarWithProps` / `eventStyleGetter` into a `calendarRenderHelpers.js` module. **Decision (this plan):** keep that boundary inside 5.1.4 if the diff stays under 400 lines; otherwise defer to a Wave 5.2 row. The reviewer makes the call when the 5.1.4 diff lands.

### Why the approval extraction is two PRs (5.1.1a + 5.1.1b)

ROADMAP §4.1 step 2 explicitly flags this: "80 lines, but 7+ context values to thread through. Plan two PRs." 5.1.1a moves the *logic* — `useApproval` learns about toast (`showSuccess` / `showError` / `showWarning` / `showErrorWithDetails`), the loader ref (`loadEvents` + `currentViewRange` + `calendarFilter.filterRules`), and the selection ref (`approvalSelection`). The hook signature gains options for those collaborators. `MondayCalendar` still keeps the four wrappers but they're now thin call-throughs to the new hook returns, with one round of behavior-equivalence review. 5.1.1b deletes the wrappers and inlines the new returns at the consumer sites. Splitting the move from the cleanup means the diff under review is always either "logic moves" or "wrappers go away" — never both at once. Same shape as the Wave-4 client-bootstrap-then-carve pattern.

### Why selection (5.1.2) and undo (5.1.3) come before composition (5.1.4)

The composite hook in 5.1.4 wires existing hooks; it can't wire what doesn't exist yet. Each of 5.1.0 / 5.1.1 / 5.1.2 / 5.1.3 carves out one concern's worth of state + handlers; 5.1.4 then collects the four new hook calls into one composite. Reversing the order would mean rewriting the composition each time a new hook lands.

---

## Verification — every sub-task

After each sub-task lands on `chore/tech-debt-sweep`:

```bash
pnpm exec eslint src/ --ext .js,.jsx --max-warnings 34   # exit 0
pnpm run test:run                                        # 724 baseline; pre-existing featureFlags failure unchanged
pnpm run build                                           # clean
```

Wave 2 integration suite is the structural safety net — if any of the six calendar-mounting tests (`calendar.smoke`, `createTimedEvent`, `createAllDayEvent`, `dragEvent`, `filterByReporter`, `convertTemporary`) regress, the extraction has a bug regardless of unit-test coverage.

Manual smoke is **mandatory** for 5.1.0 (swipe — tests are weakest here under jsdom, since `react-big-calendar` DnD is mocked at the handler level), and **recommended** for 5.1.4 (composition — easiest place to introduce a stale-closure bug). Document the smoke result in the `**Fix applied:**` entry.

---

## Risks to flag

1. **Stale closures in moved handlers.** `MondayCalendar`'s `useCallback` deps are deep (the approval wrappers each list ~10 deps). When a handler moves into a hook, the dep list moves with it but its closure environment changes — what was a render-stable reference (e.g., `events` from `useMondayEvents`) becomes a hook-prop. Each extraction must re-validate that the dep list still drives the right re-render boundary. The simplest hedge: mirror the original dep array in the new hook, run the integration tests, then trim only after green.

2. **`useEffect` ordering.** The file has 14+ effects between lines 236 and 762. Some (e.g., the `setSelectedEventId(null)` on view change at lines ~620) implicitly synchronize selection with calendar state. Moving the handler doesn't move the effect — but if the effect references handler identity (it doesn't currently, but future edits might), the order matters. Each extraction reads the surrounding effects and notes any implicit ordering it assumes.

3. **`approvalSelection` is shared across the swipe / selection / approval boundaries.** `useEventSelection` returns a single object; multiple new hooks consume it (5.1.1 needs it; 5.1.2 owns its toggle effects). Either thread it as a prop into both new hooks (verbose call sites) or keep `approvalSelection` instantiated inside `MondayCalendar` and pass it down (simpler). **Decision:** keep instantiated in `MondayCalendar`, pass into `useApproval` (5.1.1a) and `useCalendarSelection` (5.1.2). The composite hook in 5.1.4 will own the instantiation if the math works out.

4. **`exhaustive-deps` ESLint warnings.** F033's known-debt list cites several `MondayCalendar.jsx` warnings as "god-file structural" — they exist because the file *is* a god-file, and Wave 5 is the wave that resolves them. Each extraction should aim to reduce the count. If a sub-task drops 2+ warnings, the post-row ESLint count drops below 34 and the `--max-warnings` threshold in CI can ratchet down (separately, not in the extraction PR — keep the diff focused).

5. **Hook test coverage gap.** None of the existing hooks have unit tests for their UI side-effects (toast/reload). Wave 2's integration suite covers the user flow, which is sufficient for verification. Adding hook unit tests is a parking-lot decision — flag during builder review per sub-task whether to write any new unit tests, default to "no" unless the diff is large enough to warrant isolation.

---

## Critical files

**Touched (production code):**
- `src/MondayCalendar.jsx` — the file under refactor; every sub-task edits it.
- `src/hooks/useCalendarSwipe.js` — new in 5.1.0.
- `src/hooks/useApproval.js` — extended in 5.1.1a (logic move-in).
- `src/hooks/useCalendarSelection.js` — new in 5.1.2.
- `src/hooks/useUndoState.js` — new in 5.1.3.
- `src/hooks/useMondayCalendarHooks.js` — new in 5.1.4.

**Touched (tests):**
- None expected. Wave 2 integration suite is the verification surface. If any sub-task adds hook-level unit tests, that's a builder judgment call documented in the `**Fix applied:**` entry.

**Read-only references during builds:**
- All other consumers of `useApproval` / `useEventSelection` / `useUndoDelete` (e.g., `Dashboard.jsx`). 5.1.1a's `useApproval` extension must remain backward-compatible — all current consumers continue to work without change. New options on the hook signature are *additive*, not breaking.

**Tracking docs:**
- `tech-debt/STATUS.md` — Wave 5 queue + 7 per-task specs (added in this plan branch). Wave 4 archived in the same branch once 4.1.5 merges.
- `tech-debt/ANALYSIS.md` F005 — `**Fix applied (Wave 5.1.x):**` entries per merged sub-task. Closing entry when 5.1.4 lands.
- `tech-debt/ROADMAP.md` — §4.1 stays as the source-of-truth for extraction *steps*; row 121 of the wave map updates from "TBD" to "Per-task contracts in `STATUS.md`. Design in `wave-5-plan.md`."

---

## Out of scope for Wave 5

- Anything covered in `Scope of Wave 5 → Out of scope` above.
- Splitting `MondayCalendar.jsx` render body into child components (deferred to Wave 5.2 or a later wave per the §"Why the JSX split is deferred" note above).
- Deleting `console.*` calls or re-routing through `logger` (CLAUDE.md rule, but not in scope of a structural refactor).
- ESLint `--max-warnings` ratchet — separate concern, lands in its own row when warnings drop.
- Adding hook unit tests as a discipline. If a sub-task warrants one, it's a one-off judgment call.

---

## Why split into 7 PRs (vs. one big Wave 5)

- Each ROADMAP §4.1 step is its own PR (steps 1, 2a, 2b, 3, 4, 5) plus the docs-only seed. Six extraction PRs maps cleanly to six concerns.
- Wave 4 ran six sub-tasks with consistently good throughput (one merged per session, no rollbacks). The methodology fits.
- A stalled hook extraction (most likely candidate: the approval move-in if the dep-array math is harder than expected) shouldn't block the others. Per-PR isolation lets us land what works, defer what doesn't.
- Each row's `**Fix applied:**` entry feeds the next row's plan: "approval extraction taught us X about thread-through props" → 5.1.2 reads that paragraph first. Pattern transfer is explicit.

---

## Sequencing constraint vs. Wave 4

Wave 5 cannot start until Wave 4.1.5 merges. Reasons:

1. The approval handlers in `MondayCalendar` call `updateItemColumnValues` (now in `mondayApi/items.js` after Wave 4.1.4). Pulling the wrappers into `useApproval` while the wrapper is mid-migration would conflict on the same call sites.
2. The Wave 2 integration suite has been verified against the post-Wave-4 module layout. Running it as the safety net for Wave 5 is meaningful only after Wave 4 closes — otherwise a Wave 5 regression could be misdiagnosed as a Wave 4 fallout.

**5-plan promotability:** committed to branch immediately; the 5-plan PR is reviewed and merged in parallel with 4.1.5's review since the docs are independent of the code change. **5.1.0 promotability:** only after both 4.1.5 and 5-plan have merged. The reviewer of 4.1.5 promotes 5.1.0 to 🟢 NEXT in the same handoff that flips 4.1.5 to ✅ MERGED.
