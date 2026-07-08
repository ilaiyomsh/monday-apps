# Wave 4 Plan — God-File Decomposition (Split per File)

> **Status:** plan, awaiting build kickoff. See `STATUS.md` Wave 4 queue for sub-task tracking.
> Per-task contracts (In-scope / Out-of-scope / Verification baseline) live in `STATUS.md`. This file is the rationale + sequencing context for the **entire decomposition phase** (Waves 4–8).

---

## Context

Wave 3 closed F013 + F014 at merge `be4fab6` on `chore/tech-debt-sweep`. Both API wrappers (`safeApi`, `wrapMondayApiCall`) now share one retry implementation via `executeWithRetry`. The decomposition phase is unblocked on the API-layer side. Wave 2 (integration harness + 6 golden-flow tests) is the safety net for any extraction that touches user-flow code.

Six god-files remain (F011 `AdditionalTab.jsx` 786 LOC is deferred per ROADMAP §5.2 — it absorbs the `useColumnDiscovery` extraction from F006 and naturally drops to ~500 LOC):

| Finding | File | LOC | Risk profile |
|---|---|---|---|
| F005 | `src/MondayCalendar.jsx` | 1,906 | Highest — central to every user session; multi-step extraction |
| F006 | `src/components/SettingsDialog/MappingTab.jsx` | 1,540 | Medium — visually pre-sectioned; reuses F005 patterns |
| F007 | `src/utils/mondayApi.js` | 1,460 | Low — pure structural moves after Wave 3 |
| F008 | `src/components/AllDayEventModal/AllDayEventModal.jsx` | 1,213 | Medium — modal state machine |
| F009 | `src/hooks/useMondayEvents.js` | 929 | High — load-bearing memoization, optimistic updates |
| F010 | `src/components/EventModal/EventModal.jsx` | 871 | Medium — paired with F008 |

**Decision (2026-05-08):** rather than running F005–F010 as one giant Wave 4, each god-file gets its own wave. Reasons:

1. **Reviewability.** Wave 2 + Wave 3 demonstrated that a wave with ≤4 sub-tasks reviews cleanly. Bundling 6 god-files into one wave produces 20+ sub-tasks and a queue too long for the methodology.
2. **Independent revertability.** A god-file split that goes sideways shouldn't block the next file. Per-wave isolation lets us land what works, defer what doesn't.
3. **Pattern propagation.** Each wave concludes with a "what we learned" entry in `ANALYSIS.md`; the next wave starts by reading it. Patterns harden across waves rather than getting buried in one mega-wave.
4. **Live signal.** Each wave is its own `STATUS.md` "Active wave" block — builders/reviewers always have one queue to scan.

---

## Wave map

| Wave | Closes | Why this order |
|---|---|---|
| **Wave 4** — `mondayApi.js` split | F007 | Unblocked by Wave 3 (one shared retry loop). Pure structural, no behavior change. Smallest blast radius — moves exports across 6 module files; the 18 importer files re-import via a barrel. Best wave to validate the per-file methodology before touching UI files. |
| **Wave 5** — `MondayCalendar.jsx` decomposition | F005 | The biggest structural problem. Wave 2 has 4 of the 6 integration tests covering `MondayCalendar` flows — strong safety net. Sequenced per ROADMAP §4.1: swipe → approval → selection → undo → composition. ~5 sub-tasks, one extraction per PR. |
| **Wave 6** — `MappingTab.jsx` decomposition | F006 + F011 | Reuses Wave 5's extraction patterns (custom-hook + section-component). Extracts `useColumnDiscovery` which `AdditionalTab.jsx` (F011) consumes — closes both findings together. |
| **Wave 7** — modal pair (`AllDayEventModal` + `EventModal`) | F008 + F010 | Paired per ROADMAP §4.4 — they share state-machine and validation patterns. Extract `useEventModalState` once, apply to both. Wave 2 has 3 modal-flow integration tests as safety net. |
| **Wave 8** — `useMondayEvents.js` decomposition | F009 | Last per ROADMAP §4.5 — riskiest (load-bearing `eslint-disable react-hooks/exhaustive-deps`, optimistic updates, ref-based subscriptions). Only attempt after Waves 5–7 confirm the extraction patterns hold under regression pressure. |

After Wave 8 the original ROADMAP §5 (low-priority / decision-blocked items: F004 vulnerabilities, F012, F023, F025, F030, F031, F032, F035) becomes **Wave 9** — separate from the decomposition phase.

ROADMAP §4.1–§4.5 stays the source-of-truth for extraction *steps*; this document and the per-wave plans assign those steps to numbered waves.

---

## Wave 4 — `mondayApi.js` split (this wave)

**Target layout** (per ROADMAP §4.2):

```
src/utils/mondayApi/
  client.js     — safeApi + wrapMondayApiCall + executeWithRetry + MondayApiError + retry helpers + validateQuery
  items.js      — fetchItemById, createBoardItem, deleteItem, updateItemColumnValues,
                  fetchAllBoardItems, fetchEventsFromBoard, fetchProjectsForUser, fetchProjectById,
                  findProjectLinkColumn, createTask, fetchCustomerMapFromAssignments, fetchActiveAssignments,
                  fetchItemsStatus, fetchItemsLinkedIds, fetchCurrentUser
  boards.js     — createBoardWithColumns, fetchConnectedBoardsFromColumn, fetchUniquePeopleFromBoard
  columns.js    — fetchColumnSettings, fetchStatusColumnSettings, fetchStatusColumnsFromBoard,
                  parseStatusLabels, createColumn, createEventTypeStatusColumn
  mirror.js     — resolveMirrorSourceColumn
  index.js      — barrel re-export of everything currently exported from `mondayApi.js`
```

`mondayApi.js` itself is removed at the end of the wave (replaced by `mondayApi/index.js`); 18 importer files keep importing from `'./utils/mondayApi'` via the barrel. Vite/Webpack resolve a directory's `index.js` automatically, so no caller path changes — the move is transparent.

### Approach — 6 task branches

Mirrors Wave 3's pattern: docs-only seed, then small mechanical PRs. Each follows the contract in `STATUS.md` with In-scope / Out-of-scope / Verification baseline, branches off `chore/tech-debt-sweep`, gets reviewed, merges, and promotes the next row.

| # | Sub-task | Branch | Touches |
|---|----------|--------|---------|
| 4-plan | This plan + STATUS rows + Wave 3 archive (docs only) | `tech-debt/wave-4-plan` | `tech-debt/{STATUS,ANALYSIS,ROADMAP,wave-4-plan}.md` |
| 4.1.0 | Create `mondayApi/` directory + barrel `index.js` (no exports moved yet); delete legacy `mondayApi.js` and replace with re-export shim | `tech-debt/wave-4.1.0-barrel-bootstrap` | `src/utils/mondayApi/`, `src/utils/mondayApi.js` |
| 4.1.1 | Move `client.js` (wrappers + retry + error class + query validator) | `tech-debt/wave-4.1.1-client-module` | `src/utils/mondayApi/client.js`, barrel, retry test imports |
| 4.1.2 | Move `columns.js` + `mirror.js` (settings parsing + mirror resolution) | `tech-debt/wave-4.1.2-columns-mirror` | `src/utils/mondayApi/columns.js`, `mirror.js`, barrel |
| 4.1.3 | Move `boards.js` (board-level fetchers) | `tech-debt/wave-4.1.3-boards-module` | `src/utils/mondayApi/boards.js`, barrel |
| 4.1.4 | Move `items.js` (item-level fetchers — the big one, ~14 functions) | `tech-debt/wave-4.1.4-items-module` | `src/utils/mondayApi/items.js`, barrel |
| 4.1.5 | Migrate the 27 internal `wrapMondayApiCall` callers in `items.js`/`boards.js`/`columns.js` to `safeApi`; delete `wrapMondayApiCall` | `tech-debt/wave-4.1.5-unify-wrappers` | `src/utils/mondayApi/{client,items,boards,columns}.js`, retry tests |

The 6-PR split (vs. ROADMAP §4.2's "1–2 days, one PR") is the same methodology choice as Wave 3: small reviews, per-PR revertability. 4.1.0 establishes the directory and proves the barrel works (zero exports moved). 4.1.1 lands the runtime infrastructure (the wrappers everything imports). 4.1.2–4.1.4 are mechanical moves grouped by concern. 4.1.5 closes F013's wrapper-unification step that Wave 3 explicitly deferred.

### Why bootstrap before any move (4.1.0)

The cheap insurance pattern. Creating the directory + barrel as a separate PR means:
- The directory exists in git history with one trivial commit, easy to revert.
- 4.1.1 ships purely as "move N functions" rather than "move N functions and also create the directory and also figure out the barrel" — three intertwined concerns in one diff.
- If the barrel resolution misbehaves with Vite/Vitest in any unexpected way, we find out before any actual move.

Implementation: create `src/utils/mondayApi/index.js` that does `export * from '../mondayApi'` (re-export from the legacy file). Then delete `mondayApi.js` and replace with a shim `export * from './mondayApi/index.js'` — wait, that's circular. Cleaner: make `index.js` the new file with all current exports re-exported from a temporary `_legacy.js` (renamed `mondayApi.js`). Then 4.1.1–4.1.4 move exports out of `_legacy.js` into the right module file, with the barrel updated each step. After 4.1.4, `_legacy.js` is empty and gets deleted.

Even cleaner: skip `_legacy.js`. In 4.1.0, create `mondayApi/client.js` containing **all** current `mondayApi.js` content (single move), then `mondayApi/index.js` re-exports from `client.js`, then delete `mondayApi.js`. 4.1.1–4.1.4 then carve `client.js` down by moving exports to dedicated module files.

**Decision: latter approach.** One physical move in 4.1.0, then progressive carving. Simpler diffs, easier reverts.

### Verification — every sub-task

After each sub-task lands on `chore/tech-debt-sweep`:

```bash
pnpm exec eslint src/ --ext .js,.jsx --max-warnings 34   # exit 0
pnpm run test:run                                        # 724 baseline + N new; pre-existing featureFlags failure unchanged
pnpm run build                                           # clean
```

Manual smoke after 4.1.0 and 4.1.5 (recommended):
- 4.1.0: `pnpm start`, calendar loads, one event creates, one event saves. Proves the barrel didn't break import resolution.
- 4.1.5: same smoke + DevTools throttling 429 forced on a `wrapMondayApiCall`-formerly site (e.g., `fetchProjectsForUser`). Proves the migration to `safeApi` didn't break retry coverage on those paths.

### Risks to flag

1. **Barrel + tree-shaking.** Vite's barrel handling has historically been fine but worth verifying that the production bundle doesn't regress. Compare `pnpm run build` output before 4.1.0 and after 4.1.4 — chunk sizes should match within ~1%.
2. **Circular imports.** `client.js` is the runtime base; `items.js`/`boards.js`/`columns.js`/`mirror.js` import from `client.js` (for `safeApi`, `MondayApiError`). They must not import from each other or from the barrel — that would create cycles. Each sub-task verifies via `madge --circular src/utils/mondayApi/` (or equivalent) before merging.
3. **Test imports.** `mondayApiRetry.test.js` and `safeApiRetry.test.js` import from `mondayApi.js`. After 4.1.1 they import from `mondayApi/client.js` (or via the barrel `mondayApi`). Update imports as part of 4.1.1.
4. **`_testHelpers` export.** Currently exposed at `mondayApi.js:1460`. Keep exposed via the barrel after the split — the retry tests rely on `_testHelpers.executeWithRetry`/`isRetryableError`/etc. Pin its location to `client.js` (where the helpers live) and re-export through the barrel.
5. **Wrapper unification (4.1.5) blast radius.** 27 callers change from `wrapMondayApiCall(name, request, fn)` to `safeApi(monday, name, query, options)`. Signatures differ — `wrapMondayApiCall` doesn't take `monday` or `query` directly, it takes a pre-built `apiCall` thunk and an `apiRequest` descriptor. The migration is mechanical but per-site: each call needs to extract the query and switch to the `safeApi` shape. Plan one verification pass per module file (items.js: ~13 sites; boards.js: ~3 sites; columns.js: ~5 sites; mirror.js: ~1 site; client.js itself: 0 — but `wrapMondayApiCall` is deleted at the end). Land 4.1.5 only after 4.1.1–4.1.4 prove the module structure is stable.

### Critical files

**Touched (production code):**
- `src/utils/mondayApi.js` — deleted at end of 4.1.0 (replaced by `mondayApi/`).
- `src/utils/mondayApi/client.js` — new in 4.1.0, carved in 4.1.1–4.1.5.
- `src/utils/mondayApi/items.js`, `boards.js`, `columns.js`, `mirror.js` — new in 4.1.2–4.1.4.
- `src/utils/mondayApi/index.js` — new in 4.1.0, updated in each subsequent sub-task.

**Touched (tests):**
- `src/utils/__tests__/mondayApiRetry.test.js` — import path update in 4.1.1.
- `src/utils/__tests__/safeApiRetry.test.js` — import path update in 4.1.1.

**Read-only references during builds:**
- 18 importer files across `src/hooks/`, `src/components/`, `src/contexts/`, `src/MondayCalendar.jsx`. None should need import-path changes (barrel keeps `'./utils/mondayApi'` working).

**Tracking docs:**
- `tech-debt/STATUS.md` — Wave 4 queue + 6 per-task specs (added in this plan branch).
- `tech-debt/ANALYSIS.md` F007 — `**Fix applied (Wave 4.1.x):**` entries per merged sub-task. F013 closing entry when 4.1.5 lands.
- `tech-debt/ROADMAP.md` — renumber §5 → §9 to make room for Waves 5–8 (decomposition phase).

### Reuse — DO NOT reinvent

- All retry helpers, `MondayApiError`, `validateQuery` — moved verbatim to `client.js` in 4.1.1, no semantic changes.
- Wave 2 harness (`renderCalendar.jsx`, `mondayMock.js`) — re-runs as part of every sub-task verification.
- Wave 3 unit tests (`mondayApiRetry.test.js`, `safeApiRetry.test.js`) — re-run as part of every sub-task; import paths update in 4.1.1.

The split is essentially: bootstrap the directory (4.1.0), carve exports into modules (4.1.1–4.1.4), unify wrappers (4.1.5). Zero behavior change until 4.1.5 — and even there, the user-visible behavior is unchanged (the migrated callers gain retry semantics they didn't have, which is the F013 closing step).

---

## Out of scope for Wave 4

- Any change to `MondayCalendar.jsx`, `MappingTab.jsx`, `EventModal.jsx`, `AllDayEventModal.jsx`, `useMondayEvents.js` — Waves 5–8.
- Deleting `mondayApi.js`'s 13 unused exports (F023). Pure cleanup, lands in Wave 9.
- New retry knobs / global request queue (deferred per Wave 3 §"Optional").
- Renaming any export. The barrel keeps every name stable.
- TypeScript migration of any moved file (F025 — Wave 9 / indefinite).
- Touching `useBoardBuilder.js` settings_str usage (F012 / F027 — blocked on Monday API verification).

---

## Out of scope for the decomposition phase (Waves 4–8)

- F004 vulnerabilities — Wave 9.
- F012 / F027 — blocked on Monday API answer.
- F023 — Wave 9.
- F025 — defer indefinitely.
- F030 — defer until next migration.
- F031 / F032 / F035 — style, never schedule.

---

## Why split per file (vs. one big Wave 4)

- A single Wave 4 with all 6 god-files → 20+ sub-tasks → review fatigue → quality drop.
- Per-file isolation → if Wave 5's `MondayCalendar` extraction stalls (likely — it's the hardest), Waves 6/7/8 still ship.
- Each wave concludes with a `**Wave N learnings:**` paragraph in `ANALYSIS.md` for the relevant finding. The next wave's plan reads that paragraph first. Pattern transfer is explicit, not implicit.
- The methodology has now run twice (Wave 2, Wave 3) with ≤4 sub-tasks per wave and consistently good throughput. Don't break what works.
