# CLEANUP_PLAN — twyst-your-status
generated: 2026-08-05T14:47:22+00:00 | target: apps/twyst-your-status | base: 4380d775342ee540041dd3ff4f7f9195d5b34dc2 | app: apps/twyst-your-status

Gate per batch (from `.cleanup/baseline.json`, all must be green before the next batch):
`node scripts/error-wiring-audit.mjs` → `node scripts/lib/eager-graph.mjs` →
`pnpm --filter "./apps/twyst-your-status" run type-check` →
`pnpm --filter "./apps/twyst-your-status" lint && pnpm --filter "./apps/twyst-your-status/server" lint` →
`pnpm --filter "./apps/twyst-your-status" build && pnpm --filter "./apps/twyst-your-status/server" build` →
`pnpm --filter "./apps/twyst-your-status" test && pnpm --filter "./apps/twyst-your-status/server" test` →
`pnpm --filter @mapps/error-kit test`.
Baseline metrics: 15,223 LOC / 90 source files / 716 KB bundle / 6 clones (0.38%) / tests green.

**Nothing here is approved.** Every batch is `status: pending`; only the human operator writes
`approved`. Batches are independent unless a finding says otherwise (batch 5 → 6 → 7 have
stated ordering dependencies inside `ColumnSettings.jsx` and `PersonPicker.jsx`).

## Summary
| batch | category | findings | risk | status |
|---|---|---|---|---|
| 1 | comments | 9 | S | done |
| 2 | dead files | 3 | M | approved |
| 3 | unused exports | 5 | M | approved |
| 4 | unused deps | 1 | M | approved |
| 5 | duplication consolidation | 10 | L | pending |
| 6 | pattern alignment | 4 | L | approved |
| 7 | structure | 13 | L | pending |

**Approval record.** Batches 1, 2, 3, 4 and 6 were approved by the repo owner (ilai@twyst.co.il)
by explicit in-session instruction ("אני רוצה שתתחיל ליישם", 2026-08-05), after being shown the
refutation pass and the recommendation to hold 5 and 7 back. The agent transcribed that decision
into this file; it did not make it. Batches **5 and 7 remain `pending`** — 7 carries two findings
struck as unexecutable and depends on a gate that cannot detect a `ReferenceError` in this
workspace (`no-undef` is off), and 5 shares `ColumnSettings.jsx` with 7. They stay available for a
second round after this one lands.

## Pre-approval refutation pass — READ BEFORE APPROVING ANYTHING

Six independent agents were given the opposite mandate to the ones that wrote this plan: **try
to REFUTE every finding**, default to WRONG when a claim cannot be reproduced. Result over the
findings examined: **52 SOUND · 17 RISKY · 3 WRONG**. Two guard defects and one gate weakness
came out of it. What it changed is marked inline below — `⛔ STRUCK` and `⚠ AMENDED` — so a
batch executor reading only its own section cannot miss it.

**Plan-wide rule this pass forced (overrides the "batches are independent" claim above):**
**relocate every finding by SYMBOL, never by the line numbers quoted here.** Batches shift each
other's anchors — batch 1 adds/removes comment lines in files batches 3, 5, 6 and 7 cite by
line; K-016 shifts `A-structure-12`'s range by 4; `A-dependencies-01` shifts `A-patterns-04`'s
onto a different function; batch 4 shifts `A-dependencies-05`'s two targets by one. Every line
number in this plan was correct at base `4380d77` and at no point after.

**Struck — not executable as written (do not approve):**
- `A-structure-02` — leaves `handleGuardToggle` in the parent while moving the state it reads
  and the handler it calls → **ReferenceError on the switch that arms the guard**, and the gate
  cannot see it (see the gate weakness below). Also silently relocates the guard-status probe
  and the window `focus` refresh below the parent's early returns, changing when they fire.
- `A-structure-08` — its stated extraction ranges contradict each other (the loop-guard block
  it says to keep inline sits inside the range it says to extract) and three early returns
  cannot be expressed by a value-returning helper.
- `A-structure-10` — amended, not struck: as sequenced after batch 5's `A-patterns-04` the moved
  `rulesStore.js` sits one directory deeper, where `../../../src/domain/…` resolves to a
  directory that does not exist, and the **build gate fails**.

**Gate weakness the human should know before approving any L-risk batch:** the SPA's ESLint
config lives in `apps/twyst-your-status/package.json → eslintConfig` and does **not** extend
`eslint:recommended`. Its only rules are `no-console`, `no-empty`, the error-guard catch rule
and `promise/catch-or-return` — so **`no-undef` is off**. A free identifier left by a botched
extraction passes lint, passes the esbuild/vite build (which does not resolve free
identifiers), and passes tests wherever no test exercises that control. For batches 5-7 the
gate proves "nothing I can see broke", not "nothing broke".

**Also corrected below:** `A-comments-01` (its own retained conclusion contradicted the
corrected number), `A-comments-03` (two wrong line refs + a missing key), `A-comments-06`
(nesting and shape unspecified — could have written a NEW false contract), batch 3's header
sentence (a literal reading would have deleted two live components), `A-dependencies-03`'s
false "React is genuinely used" claim, and `A-patterns-14`'s snippet (double-send).

Verified sound and approvable as written: **all of batch 2** (an independent static-import walk
over 2,005 files across the monorepo found exactly one inbound edge, the intra-pair CSS import
this plan already accounts for), **all of batch 6**, and the technical premise of **batch 4**
(the automatic JSX runtime was confirmed by actually running an esbuild transform of all 19
files with the import line rewritten — compiles clean, emits `react/jsx-runtime`, zero
remaining `React` references).

---

45 actionable findings, of which **2 are struck** by the refutation pass (43 remain).
32 non-actionable entries in the appendix (20 verified knip false
positives + 11 auditor/scanner entries that are guard-blocked, superseded or owner decisions).

---

## Batch 1 — comments: stale factual claims in comments only
risk: S | status: done

Comment text only — zero behaviour change, no code line touched. This app has **no**
commented-out code and **no** TODO/FIXME markers (see appendix `A-comments-10`), so this batch
is narrow by construction: every entry is a comment that makes a claim the code no longer
supports.

### A-comments-01
- files: src/components/OnClickDialog/OptionFieldControls.jsx:19-20
- action: ⚠ **AMENDED BY THE REFUTATION PASS — the original action would have left a NEW self-contradicting claim.** Replace `184px for one` with `276px for one` and `548px at the 8-field cap` with `588px at the 8-field cap`, **and** rewrite the retained conclusion: `FORM_MIN_ROWS = 2` floors the height, so a one-field modal is 276px — byte-identical to a two-field modal. The original instruction kept "220 leaves room … **from two fields up**" verbatim while asserting it "still holds against 276px", but 276px *is* the one-field height, so the block would have stated 276px for one field next to a conclusion that excludes one field: the same class of internally-stale claim this batch exists to remove. Say "from one field up (one field is floored to two rows)" or drop the qualifier. Nothing else in the block changes.
- evidence: independently reproduced twice — the auditor and the refuter each executed `src/utils/requiredFormModalSize.js` read-only: 0→276, 1→276, 2→276, 3→328, 8→588, 9→588. ⚠ The original causal story was also wrong and is corrected here: 548 + `FORM_HEADER_TOP_PX`(16) + `MODAL_CHROME_PX`(24) = 588 exactly, so the 8-field number needs no row-height change at all; and 184 + 40 = 224, not 276 — the remaining 52px is `FORM_MIN_ROWS = 2` (one extra 40px row + a 12px gap), which the original never named. A `FIELD_ROW_HEIGHT_PX` 48→40 change would have *lowered* the number.
- source: auditor:comments

### A-comments-02
- files: server/src/services/monday-oauth-client.js:12
- action: in the header comment only, narrow line 12 from "this module NEVER logs" to "this module never logs TOKEN MATERIAL — machine codes only, through the optional injected `logger` (see the DELIBERATE DIVERGENCE note on `decodeJwtExpMs`)". Keep lines 13-14 verbatim; do not touch lines 30-32 and do not touch any `logger.debug` call.
- evidence: the header states an absolute the module deliberately breaks — `logger.debug` at :48, :152, :191, all `if (logger)`-guarded and passing machine codes only (`oauth_jwt_exp_undecodable`, `oauth_refresh_error_body_unparseable`, `oauth_revoke_network_error`), with lines 30-32 documenting the divergence as an error-guard requirement. Acting on the header as written would delete mandated logging.
- source: auditor:comments

### A-comments-03
- files: server/src/app.js:26-31
- action: ⚠ **AMENDED BY THE REFUTATION PASS — the original correction was itself incomplete.** In the `@param` type literal add `rulesStore: object, bypassLog: object, oauthClient: object,` **and `now?: () => number`** — `createOauthRouter` destructures `now` from that same deps object (`routes/oauth.js:40`), and omitting it would leave this batch internally inconsistent with `A-comments-04`, which adds exactly that key for the analogous case. Delete `fetchImpl?: typeof fetch,`. Comment text only — do not change the signature or the `deps` pass-through. Note for the human, not an action: `server/tests/httpSurface.test.js:58` (locked) still injects `fetchImpl` into `createApp`, so after this edit the app's own fixture passes a key the docblock no longer lists — harmless at runtime, but it is why the key was documented in the first place.
- evidence: ⚠ **two line refs corrected:** the guard-routes destructure is at `server/src/routes/guard-routes.js:33` (the plan originally said :32) and the oauth destructure at `server/src/routes/oauth.js:40` (originally :41); `server/src/index.js:95` is correct. `guard-routes.js:33` destructures `{ handleEvent, tokenStore, enrollmentStore, rulesStore, bypassLog, api, env, logger }`, `oauth.js:40` destructures `{ tokenStore, api, oauthClient, env, logger, now }`, and `index.js:95` passes `rulesStore, bypassLog, oauthClient`; `fetchImpl` exists only on `createMondayApi` (monday-api.js:82) and `createMondayOauthClient` (monday-oauth-client.js:72), never in `app.js` or either router.
- source: auditor:comments

### A-comments-04
- files: server/src/guard/handleStatusChangeEvent.js:56-61
- action: in the `@param` type literal add `bypassLog: object,` and `now?: () => number,`. Comment text only.
- evidence: the signature at :62 is `({ api, tokenStore, rulesStore, bypassLog, logger, evaluate, now = () => Date.now() })` and `bypassLog.append(...)` is called unconditionally at :240 on every non-allowed verdict, while the doc lists only `api, tokenStore, rulesStore, logger, evaluate?`.
- source: auditor:comments

### A-comments-05
- files: server/src/services/stores.js:192
- action: add `logger?: object` to the `@param` type literal, matching the wording already used at :162. Comment text only.
- evidence: signature at :194 is `createBypassLog({ secureStorage, maxEvents = 1000, logger })`, and `logger?.error?.(...)` fires at :209 ("corrupted bypass log — treated as empty") and :233 ("bypass log append failed"); the sibling factories document `logger` at :59 and :162.
- source: auditor:comments

### A-comments-06
- files: src/domain/settingsSchema.js:4-16
- action: ⚠ **AMENDED BY THE REFUTATION PASS — as originally written this could have documented a NEW false contract in the app's single written settings contract.** The three keys are NOT at the same nesting level: `nextLabelIds` is produced by `normalizeLabelRule` (:87-89), i.e. it lives **inside `labels[labelIndex]`**, while `owners` (:151) and `autoRevert` (:154) are **top-level** keys of the blob. Calling them "the three optional keys" of one shape block invites a flat insertion that puts `nextLabelIds` at the wrong level. Document the nesting explicitly, and use the real owners shape — `owners?: { ownerIds: string[], primaryOwnerId: string }` (`src/domain/columnOwners.js:37`, invariants at :17-22), not the `{...}` placeholder. Keep each key's existing conditional rule: `nextLabelIds?: string[]` — "present ONLY as an array; key-absence is the unrestricted default (round321, see normalizeLabelRule)"; `owners` — "carried only when a valid record is present (round322)"; `autoRevert?: true` — "carried only when strictly true (round323)". Do not edit the inline comments at 79-86, 142-144 or 152-153.
- evidence: the header is the app's single written settings contract and documents only `version`, `hiddenLabelIds`, `labels[id]{…}`, while the same file emits `nextLabelIds` (:87-89), `owners` (:151) and `autoRevert` (:154).
- source: auditor:comments

### A-comments-07
- files: src/services/guardStatus.js:1-31, src/services/guardAuthorize.js:1-32, src/services/guardEnroll.js:1-42
- action: per file, split the one block in two without rewording any sentence — keep the prose (module purpose, statuses table, round-numbered notes) as the file-top block, and move only the `@param` and `@returns` lines into a new `/** … */` immediately above the exported function. In `guardStatus.js` the round327 prose at :19-28 stays with the file-top block, not between the tags.
- evidence: in all three files the tags sit in the module header, separated from the function by a blank line and the imports, so they document nothing: `guardStatus.js` `@param` :14, prose :19-28, `@returns` :30, block ends :31, imports :33, `export async function getGuardStatus` :41; same layout in `guardAuthorize.js` (:26/:31/:32/:34-35/:37) and `guardEnroll.js` (:34/:41/:42/:44-45/:50).
- source: auditor:comments

### A-comments-08
- files: src/domain/statusPolicy.js:123
- action: change "Kept for legacy restricted-label-only callers/tests." to "No production callers remain; kept only for the restricted-label-only cases pinned in statusPolicy.test.js." Comment text only — do **not** remove the export (its test is locked; removal is out of scope).
- evidence: `grep -rn buildStatusPickerModel src server/src` returns the definition (:125) and eight references inside the locked `src/domain/statusPolicy.test.js` — no production import in either workspace, so the `@deprecated` note overstates what would break.
- source: auditor:comments

### A-comments-11
- files: src/components/shared/PersonPicker.jsx:123, src/components/shared/Popover.jsx:83, src/hooks/useMondayContext.js:57, server/src/services/stores.js:225
- action: delete these four comment lines and nothing else. Do not extend to any other comment.
- evidence: the only four comments in the app that restate the next statement without adding a rule, quirk or history — `// Close on click-outside / Escape.` (identical in PersonPicker.jsx:123 and Popover.jsx:83, the only duplicated non-banner comment line in the app), `// Listen for context changes (theme switches, language changes).` above `monday.listen('context', …)`, `// Keep the newest maxEvents; drop the oldest overflow.` above the slice.
- evidence (caveat): auditor confidence **medium** and flagged as lowest priority — each currently labels an otherwise anonymous effect/branch, so the human may reasonably reject this one finding while approving the rest of the batch.
- source: auditor:comments

---

## Batch 2 — dead files: three unreferenced modules
risk: M | status: approved

All three verified dead by an independent adversarial pass (not just knip): no importer, no
dynamic/lazy import, no barrel, no string/route reference in `vite.config.js:23`, no
`import.meta.glob`, no test usage. Cross-repo hits are only the `monday-scaffold` templates and
`team-people-column`'s own separate copies — neither is this app.

### K-001 (= A-patterns-06)
- files: src/hooks/useQuery.js (whole file, 71 lines)
- action: delete `src/hooks/useQuery.js`. No importers to update. Do **not** migrate any existing fetcher onto it — the 15 hand-rolled fetch sites carry surface-specific stale-run and overlay-handoff logic (`runIdRef`, `loadedKey`/`fetchKey`) this hook cannot express.
- evidence: the only occurrences of `useQuery`/`useMutation` in the app are the definitions themselves (:4, :47); no import of `hooks/useQuery` anywhere in the repo; not lazy-loaded (`src/App.jsx:9-12`), not in the route/fallback string list (`vite.config.js:23`), no barrel, no test import (`knip.jsonc` lists tests/test-utils/dev-harness as entries). Also the only place in the app that stores `error` as a string message instead of the Error.
- source: knip + auditor:patterns

### K-003
- files: src/components/shared/DateRangeDisplay.jsx (whole file, 52 lines)
- action: delete `src/components/shared/DateRangeDisplay.jsx`. No CSS or other file is orphaned (it imports no stylesheet).
- evidence: grep of the whole app for `DateRangeDisplay` and `formatDateRange` returns only :24, :42, :46, :51 inside the file itself; no importer, no dynamic import, not in the `vite.config.js:23` route list, no barrel, no test reference. Outside the app only `.claude/skills/monday-scaffold/templates/shared/components/DateRangeDisplay.jsx.template` and `team-people-column`'s own copy.
- source: knip

### K-004
- files: src/components/shared/StatusChip.jsx (25 lines), src/components/shared/StatusChip.module.css (19 lines)
- action: delete both files. `StatusChip.module.css` is imported only by `StatusChip.jsx:7`, so it is orphaned by the deletion and must go in the same commit. Supersedes `A-comments-09` (a provenance-comment fix in a file that no longer exists) — apply this, not that.
- evidence: grep of the whole app for `StatusChip` returns only src/components/shared/StatusChip.jsx:7, :11, :24 (self, including its own CSS import); no importer, no lazy/dynamic import, no string/route reference, no test usage; external hits are only the monday-scaffold template and team-people-column's own copy. `grep -rn 'StatusChip.module'` returns the single import line.
- source: knip + auditor:comments (A-comments-09 note)

---

## Batch 3 — unused exports: dead public surface
risk: M | status: approved

⚠ **Header corrected by the refutation pass.** The original wording ("only exports whose
*binding* is dead are here") is false for `K-020` and `K-022`, and a literal reading of it would
have deleted two live components. Accurate statement: this batch removes either a dead binding
(`K-014`, `K-016`, `A-dependencies-01`) **or** a redundant `export default` line whose named
sibling is the live one (`K-020` `PersonPicker`, `K-022` `Popover` — delete ONLY the
`export default …;` line, never the component). Every knip hit where merely the `export` keyword
was unused while the value is live inside its own module is in the appendix.

### K-014
- files: src/services/graphqlQueries.js:141-159
- action: delete the `GET_ITEM_FORM_VALUES` constant together with its own docblock (:141-146). Keep the `ALL_COLUMN_VALUE_FIELDS` import at :1 — it is still interpolated at :187 by another operation. Leave `src/dev-harness/fixtures.js:155` (`match: 'GetItemFormValues'`) alone: it becomes unreachable but harmless, and pruning a dev-harness fixture is not needed for the gate; flag it to the human as a follow-up rather than editing it here.
- evidence: every `graphqlQueries` import site in the app omits it — ColumnSettings.jsx:31, OnClickDialog.jsx:14, RequiredFieldsModal.jsx:22 (which uses `GET_REQUIRED_FIELDS_CONTEXT` instead), BoardRelationFieldControl.jsx:22, teamsAccess.js:7, boardOwnerGate.js:17 and 4 tests; no namespace import, no dynamic import, no server/scripts/docs reference. The only string coupling is the harness fixture above, which can only fire if this very constant is sent.
- source: knip

### K-016
- files: src/domain/statusLabelDraft.js:26-29
- action: delete `__resetNewLabelSeqForTests` and its `/** Reset only in tests. */` comment. Keep `newLabelSeq` (:19) and `nextNewLabelClientId` (:21-24) — both live (see appendix K-015).
- evidence: despite the `ForTests` name, no test uses it: all six `statusLabelDraft.js` importers (ColumnSettings.jsx:26, statusLabelDraft.test.js, defaultStatusLabel.test.js, statusLabelRoundTrip.test.js, statusTransitions*.test.js) list only other symbols, and a repo-wide grep for `__resetNewLabelSeqForTests` finds only the definition. This is a source-file deletion, not a test edit — no locked file is touched.
- source: knip

### K-020
- files: src/components/shared/PersonPicker.jsx:374
- action: delete the line `export default PersonPicker;`. Do **not** collapse toward default-only — both consumers use the named export.
- evidence: `src/components/ColumnSettings/ColumnSettings.jsx:43` and `src/components/OnClickDialog/FieldControl.jsx:12` both `import { PersonPicker }` (used at ColumnSettings.jsx:420, :1178 and FieldControl.jsx:110). No barrel in `components/shared/`, no `React.lazy`/dynamic import of the module (App.jsx:9-12 lazily loads only SettingsLauncher, ColumnSettings, RequiredFieldsModal), no `vi.mock`, no vite `manualChunks`/alias reference; `scripts/lib/eager-graph.mjs:51`'s mention is prose inside a `why` string. `export function PersonPicker` confirmed at :70, `export default` at :374.
- source: knip

### K-022
- files: src/components/shared/Popover.jsx:129
- action: delete the line `export default Popover;`. Do **not** collapse toward default-only — all three consumers use the named export.
- evidence: `BoardRelationFieldControl.jsx:25` (rendered :132-189), `OptionFieldControls.jsx:13` (:63, :126) and `DateFieldControl.jsx:14` (:92) all `import { Popover }`. No barrel, no lazy/dynamic import, no `vi.mock`, no config/string reference (MANIFEST.md:133 is prose). `export function Popover` at :30, `export default` at :129.
- source: knip

### A-dependencies-01 (supersedes A-patterns-15)
- files: src/services/mondayService.js:5, :8-12, :73-76, :104-106, :135-146, :148-151
- action: delete these members from the `mondayService` object literal — `getSessionToken` (73-76), `openItemCard` (104-106), `getAppStorage` (135-146), `setAppStorage` (148-151) — then delete the two module-level helpers that become unreachable with them: `const STORAGE_RETRY_DELAY_MS = 350;` (:5) and `function wait(...)` (:8-12). Keep `safeStringify`, `describeStorageError`, `assertStorageWriteOk`, `assertStorageReadOk`, `parseStoredValue`, `columnConfigKey`, `getColumnConfig`, `setColumnConfig`, and keep the "ONE read, deliberately" comment block at :116-120 verbatim — it documents `getColumnConfig`, not the deleted code. No importer changes (`mondayService` is a default-exported object literal).
- evidence: knip cannot see object-literal members, so this is auditor-grepped: `getSessionToken` 0 callers (the other matches are local variables in the four guard services), `openItemCard`/`getAppStorage`/`setAppStorage` 0 matches outside their own definitions (vs `query` 26, `showNotice` 7, `closeDialog` 3); none is named in MANIFEST.md, CHANGELOG.md or docs/. `wait`'s only use is :140 inside `getAppStorage`. The deleted retry is the same false-empty retry `useColumnSettings.js:12-17` records as REMOVED from `getColumnConfig` for costing "4 reads and 1050ms", so keeping it documented two competing answers to one platform quirk. Ordering: this must land before/with batch 5's `A-patterns-02`, which explicitly refuses to route the guard services through `mondayService.getSessionToken`.
- source: auditor:dependencies (+ auditor:patterns A-patterns-15, subsumed)

---

## Batch 4 — unused deps: dead `React` default bindings
risk: M | status: approved

knip reports **zero** unused, unlisted or phantom dependencies in both workspaces, and both
ESLint reports are empty — so this batch is the one dependency-level finding that exists:
dead import bindings from the pre-automatic-JSX era. Five package-level dependency questions
are pre-declared in the appendix so no batch reopens them.

### A-dependencies-03
- files: src/App.jsx:1, src/components/ColumnSettings/BypassMonitor.jsx:1, src/components/ColumnSettings/ColumnSettings.jsx:1, src/components/ColumnSettings/SettingsLauncher.jsx:1, src/components/ColumnSettings/StatusColorPicker.jsx:1, src/components/OnClickDialog/BoardRelationFieldControl.jsx:16, src/components/OnClickDialog/DateFieldControl.jsx:11, src/components/OnClickDialog/FieldControl.jsx:10, src/components/OnClickDialog/FieldIcon.jsx:10, src/components/OnClickDialog/OnClickDialog.jsx:1, src/components/OnClickDialog/OptionFieldControls.jsx:9, src/components/OnClickDialog/RequiredFieldsForm.jsx:11, src/components/OnClickDialog/RequiredFieldsModal.jsx:13, src/components/shared/ErrorState.jsx:1, src/components/shared/LoadingState.jsx:1, src/components/shared/PersonPicker.jsx:8, src/components/shared/Popover.jsx:8 (+ src/components/shared/DateRangeDisplay.jsx:9, src/components/shared/StatusChip.jsx:6 **only if batch 2 has not run**)
- action: in each file drop only the default binding: `import React, { … } from 'react';` → `import { … } from 'react';`; delete the whole line where the import is `import React from 'react';` alone (FieldControl.jsx, FieldIcon.jsx, ErrorState.jsx, LoadingState.jsx — plus DateRangeDisplay.jsx and StatusChip.jsx if they still exist). Do **not** touch `src/index.jsx` or `src/components/ErrorBoundary/AppErrorBoundary.jsx`: React is genuinely used there, and the boundary is guard-blocked anyway (guard rule 5+6).
- evidence: all 21 non-test `.jsx` files were parsed — 21 import `React` by default and in exactly 19 of them `React` appears nowhere else after comment-stripping. ⚠ **Evidence corrected by the refutation pass:** the original text claimed "the two real users are `src/index.jsx:24` and `AppErrorBoundary.jsx:25`", and both halves were wrong. Those two lines are the `import` statements themselves; `src/index.jsx`'s real uses are :88 and :92 (`<React.StrictMode>`), and **`AppErrorBoundary.jsx` does not genuinely use React at all** — its only other occurrences are JSDoc type references (`@param {React.ReactNode}` :112, `{React.ComponentType…}`). The sole valid reason to exclude that file is guard rule 5+6 (it is the root boundary and the guard refuses it), not a live usage; leaving the false claim in place would invite a later batch to trust it. Automatic runtime confirmed twice over — against the built artifact (`dist/assets/index-C9JHKuqe.js` contains `jsx-runtime` and `.jsx(` call sites, no `@jsx`/`jsxImportSource` pragma, no `vi.mock('react')` anywhere) and independently by running an esbuild transform of all 19 files with the import line rewritten exactly as this action specifies: compiles clean, emits `react/jsx-runtime`, zero remaining `React` references. `@vitejs/plugin-react` 4.7.0 defaults to `jsx: 'automatic'` and vitest shares the same config file, so build, dev and test agree. No lint rule catches these because the SPA `eslintConfig` declares no `no-unused-vars`. Batch 2 deletes two of the listed files, shrinking this finding from 19 files to 17.
- ⚠ **ordering (added by the refutation pass):** run this batch AFTER batch 6's `A-dependencies-05`, or relocate that finding's targets by symbol — deleting line 1 of `ErrorState.jsx` and `LoadingState.jsx` shifts its quoted `:47` and `:18` to `:46` and `:17`.
- source: auditor:dependencies

---

## Batch 5 — duplication consolidation: one owner per duplicated rule
risk: L | status: pending

Covers all four actionable jscpd clones (clones 1, 4, 5, 6) plus the sub-threshold copies only
a human reader finds; clones 2 and 3 are in the appendix with reasons. Several findings touch
`ColumnSettings.jsx`, which batch 7 also restructures — **run batch 5 before batch 7** and
re-locate by symbol, not by the line numbers quoted here, if any earlier finding in the same
batch has already shifted the file.

### A-patterns-01 (= jscpd clones 5 and 6)
- files: src/domain/buildAvailableLabels.js:22-42, src/domain/statusPolicy.js:11-43
- action: in `src/domain/buildAvailableLabels.js` delete lines 22-42 and add `export { currentLabelIdFromValue } from './statusPolicy.js';` plus a value import for internal use at line 103. Keep the re-export — `src/domain/buildAvailableLabels.test.js:4` (locked) imports the symbol from this module and must keep resolving. No cycle: `statusPolicy.js` imports nothing.
- evidence: `normalizeNonNegativeInteger` + `currentLabelIdFromValue` exist as byte-identical copies in both modules and BOTH export `currentLabelIdFromValue`, so the load-bearing "monday `index` carries the label id" decoder has two divergence surfaces; production reads the statusPolicy copy (`src/domain/statusWriteResult.js:28`) while `buildAvailableLabels.js:103` reads its own. jscpd pairs `buildAvailableLabels.js 22-32 ↔ statusPolicy.js 11-22` (11 lines/116 tokens) and `32-44 ↔ 33-45` (13 lines/139 tokens).
- source: jscpd + auditor:patterns

### A-patterns-02 (= A-dependencies-04)
- files: src/services/guardEnroll.js:110-117, src/services/guardStatus.js:72-76, src/services/guardAuthorize.js:68-74, src/services/bypassMonitor.js:51-55, new src/services/sessionToken.js
- action: add `src/services/sessionToken.js` exporting one `getSessionTokenViaSdk()` whose body is the existing four lines **verbatim**, keeping the dynamic `await import('monday-sdk-js')`; carry one copy of the WHY comment (guardEnroll.js:111-113) into the new module. Then in each of the four services delete the local `defaultSessionTokenProvider` and use the imported function in the existing `deps.sessionTokenProvider ?? …` expression. Two auditors proposed this with different names (`guardSession.js`/`defaultSessionTokenProvider` vs `sessionToken.js`/`getSessionTokenViaSdk`) — use `src/services/sessionToken.js` + `getSessionTokenViaSdk`, one decision, no second module. Do **not** route through `mondayService.getSessionToken`: it would turn a dynamic import into a static one (breaking the documented "module stays inert for suites that stub the SDK" property) and that member is deleted by batch 3 anyway. Importers to update: those four files only.
- evidence: the four bodies are identical apart from comments — `const { default: mondaySdk } = await import('monday-sdk-js'); const response = await mondaySdk().get('sessionToken'); return response?.data;` — and sit below jscpd's threshold, so they are absent from the clone report. The precedent already exists in the same four files: each imports `resolveGuardBase` from `./guardBase.js` (guardEnroll.js:45, guardAuthorize.js:35, guardStatus.js:34, bypassMonitor.js:23).
- source: auditor:patterns + auditor:dependencies (one entry, deduplicated)

### A-patterns-04
- files: src/services/mondayService.js:46-49, server/src/services/stores.js:167, new src/domain/columnConfigKey.js
- action: add a pure module `src/domain/columnConfigKey.js` exporting `columnConfigStorageKey(boardId, columnId)` with the existing comment ("Column-view dialogs have no instanceId — use GLOBAL storage keyed by board+column"), then import it in exactly those two files. Do **not** let the server import anything under `src/services/` — that would pull `monday-sdk-js` into the server bundle. Auditor confidence: medium.
- evidence: the storage-key contract `twystStatus:<boardId>:<columnId>` — the one string that makes the SPA's write and the guard's read the same record — is written twice: `columnConfigKey()` in mondayService.js and a re-derived `` const key = `twystStatus:${boardId}:${columnId}` `` in `createRulesStore.getRules`. The import direction already has precedent: the server imports `../../../src/domain/{columnFields,statusPolicy,columnOwners,settingsSchema,bypassReason}.js`.
- source: auditor:patterns

### A-patterns-08
- files: src/components/ColumnSettings/ColumnSettings.jsx:97-131, src/components/ColumnSettings/StatusColorPicker.jsx:40-74, src/utils/overlayPlacement.js, new src/hooks/useDismissOnOutside.js
- action: extract only the two verbatim pieces — (a) `useDismissOnOutside(open, [refs], onClose)` in `src/hooks/` holding the mousedown + capture-phase keydown effect, (b) `clampOverlayLeft(anchorLeft, popupWidth, viewportWidth)` added to `src/utils/overlayPlacement.js` — and call them from both components. Do **not** migrate either component onto `Popover` (its flip/clamp math would move the menu — a visible behaviour change) and do **not** touch `PersonPicker.jsx`, whose header comment forbids rebuilding it. Auditor confidence: medium.
- evidence: the dismiss effect in `SelectDropdown` (ColumnSettings.jsx:97-114) and in StatusColorPicker (:40-57) is identical down to `document.addEventListener('keydown', onEsc, true)`, and both `openMenu`/`openPicker` compute `Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))`, while three field controls already use the shared `Popover` (BoardRelationFieldControl.jsx:25, OptionFieldControls.jsx:13, DateFieldControl.jsx:14).
- source: auditor:patterns

### A-patterns-09
- files: src/components/ColumnSettings/ColumnSettings.jsx:857-858, :1107-1108
- action: hoist one `useMemo` (`liveHasDefaultLabel`, dependency `[statusColumn]`) next to the `statusColumn` memo at :622 and use it in both places. It must sit ABOVE the early returns so `handleSave` can close over it — safe because `normalizeStatusLabels(undefined)` returns `[]` (statusPolicy.js:87) and `handleSave` is unreachable while `statusColumn` is null. Keep the round321 comment block at :1099-1106 attached to the memo. Auditor confidence: medium.
- evidence: `normalizeStatusLabels(statusColumn.settings).some((live) => !live.isDeactivated && String(live.id) === String(RESERVED_EMPTY_LABEL_ID))` appears verbatim twice in one component under two names (`defaultIsReal` in `handleSave`, `liveHasDefaultLabel` in render), each re-parsing `statusColumn.settings`.
- source: auditor:patterns

### A-patterns-10 (absorbs jscpd clone 4)
- files: src/components/shared/PersonPicker.jsx:144-166, :209-221
- action: extract a single `reposition` `useCallback` inside PersonPicker (same body, same args) and call it from the scroll/resize effect and from `toggleOpen`. Nothing else moves, so the ported markup and behaviour stay intact and the "do NOT rebuild this from scratch" header constraint is respected. **Human decision flagged by the auditor:** this file is a deliberate port of `apps/discussions`' picker — if keeping the two files textually in sync matters more than the duplication, strike this finding. The cross-file half of jscpd clone 4 (PersonPicker.jsx 159-166 ↔ Popover.jsx 74-81) is **not** actionable — see appendix. Auditor confidence: medium.
- evidence: both blocks pass `{ anchorRect: rect, preferred: 'bottom-start', popupWidth: Math.max(rect.width, 300), popupHeight: 430, offset: 4 }` to `computeFloatingPosition` and set `minWidth: Math.max(rect.width, 280)`; jscpd clone 4 (8 lines/79 tokens) pairs PersonPicker.jsx 159-166 with Popover.jsx 74-81, i.e. `Popover` was generalized from exactly this code.
- source: jscpd + auditor:patterns

### A-patterns-11
- files: src/App.jsx:56-59, src/components/OnClickDialog/OnClickDialog.jsx:292-295, src/components/OnClickDialog/RequiredFieldsModal.jsx:174-177, new src/hooks/useBootLoaderRelease.js
- action: add `src/hooks/useBootLoaderRelease.js` exporting `useBootLoaderRelease(held)` containing exactly that effect, and call it from the three surfaces with their existing predicates unchanged. **Move** (do not delete) the three WHY comments about who owns the overlay into the call sites they belong to — they name the incident ("a dismissal that never fires means a dialog stuck behind a spinner") and must survive. `bootLoader.js` is not touched, and the new hook imports nothing beyond React + bootLoader, so the `src/index.jsx` eager graph gains no `@vibe/core` reachability. Ordering: batch 7's `A-structure-06` requires the OnClickDialog boot-overlay effect to keep registering AFTER the fetch effect — preserve that position. Auditor confidence: medium.
- evidence: all three are `const <flag> = …; useEffect(() => { if (!<flag>) dismissBootLoader(); }, [<flag>]);` against the same `utils/bootLoader` import, differing only in the predicate name (`held`/`stillLoading`).
- source: auditor:patterns

### A-patterns-12
- files: src/components/shared/ErrorState.jsx, src/components/ColumnSettings/ColumnSettings.jsx:1084, src/components/OnClickDialog/OnClickDialog.jsx:298, src/components/OnClickDialog/RequiredFieldsModal.jsx:185
- action: export `SETTINGS_LOAD_ERROR_MESSAGE` from `src/components/shared/ErrorState.jsx` and reference it from the three call sites.
- evidence: all three render `<ErrorState message="טעינת ההגדרות נכשלה. נסו שוב." onRetry={reloadSettings} />` — identical string and identical prop, so the copy can drift per surface. House precedent for a user-facing message constant exported from a component module: `SettingsLauncher.jsx:20,26` (`NON_OWNER_MESSAGE`, `GATE_ERROR_MESSAGE`).
- source: auditor:patterns

### A-patterns-13
- files: src/components/ColumnSettings/ColumnSettings.jsx:677-691
- action: add a module-level helper in the same file — `const byIdMap = (list, valueOf) => Object.fromEntries((list ?? []).map((x) => [String(x.id), valueOf(x)]));` — and reduce the three memos (`labelsById`, `columnsById`, `usersById`) to one line each with unchanged dependency arrays. Keep the round323 comment on the first one.
- evidence: each memo is `const map = {}; (list ?? []).forEach((x) => { map[String(x.<id>)] = x.<name>; }); return map;` — 15 lines for one operation applied three times. Object key order is unchanged (insertion order either way) and every consumer reads by key.
- source: auditor:patterns

### A-patterns-14 (= jscpd clone 1)
- files: server/src/routes/guard-routes.js:119-123, :161-165
- action: add a local helper next to `requireSession` (:94) — `const requireReader = async (accountId, res) => { const reader = await tokenStore.getReaderToken(accountId); if (!reader) res.status(409).json({ error: 'not_activated' }); return reader; }` — and use it in `/api/guard/enroll` and `/api/guard/bypasses` **only**. ⚠ **Refutation-pass correction:** the helper returns a falsy `reader` after already sending 409, so each call site MUST be `const reader = await requireReader(...); if (!reader) return;` — a literal transcription without that `return` double-sends and throws `ERR_HTTP_HEADERS_SENT`. (`httpSurface.test.js:229-240`/`:518-526` would catch it, so this one is gate-covered — but write it correctly.) Leave `/api/guard/status` alone: it deliberately answers 200 with an all-false body instead of 409 (comment at :191). The parameter-validation step must stay BEFORE the reader lookup in both edited routes, to keep the documented 400-before-409 verdict order.
- evidence: jscpd clone 1 (11 lines/91 tokens) pairs `guard-routes.js 114-124 ↔ 156-166`; both routes run `const reader = await tokenStore.getReaderToken(session.accountId); if (!reader) { res.status(409).json({ error: 'not_activated' }); return; }` verbatim.
- source: jscpd + auditor:patterns

---

## Batch 6 — pattern alignment: deviations from the app's own dominant pattern
risk: L | status: approved

The dominant patterns were counted before any deviation was named (13 call sites through one
`monday.api` funnel, 13 named GraphQL ops vs 1 inline, 4-of-4 guard HTTP shape, 60+ SPA log
sites with no deviation). Only deviations that can be aligned with **zero** behaviour change
are here; six that cannot are recorded in the appendix.

### A-patterns-03
- files: src/components/OnClickDialog/OnClickDialog.jsx:40, :136-140
- action: delete the `columnsById` `useState` (:40) and the `setColumnsById(new Map(...))` block (:136-140). Leave `RequiredFieldsModal` as the single builder. No other file changes. Ordering: if batch 7's `A-structure-06` lands first, drop `columnsById` from the new hook's return instead.
- evidence: `grep -n "columnsById" OnClickDialog.jsx` returns exactly two lines — the `useState` (40) and the `setColumnsById` (136) — so the Map is write-only state left over from before the fill form became its own iframe; no render, handler or test references it (`grep columnsById` across `src/**/*.test.*` hits only requiredFieldsForm.test.jsx and columnValueFormats.test.js, i.e. RequiredFieldsModal's own copy at :51, :81-89).
- source: auditor:patterns

### A-patterns-05
- files: src/components/shared/PersonPicker.jsx:42, src/services/graphqlQueries.js
- action: move the inline document to `src/services/graphqlQueries.js` as `export const GET_ACCOUNT_USERS = …` (carry PersonPicker's `photo_thumb` / API-2026-04 comment from :34-35 with it) and import it in PersonPicker.jsx. The query text must move **byte-identical** — `guardEnrollOnSave.test.jsx:89`, `guardWebhookIndicator.test.jsx:91` and `newLabelPermissions.test.jsx:107` branch on `query.includes('AccountUsers')`. Eager-graph safe: `graphqlQueries.js` imports only `src/domain/columnFields.js` and is already reachable from `src/index.jsx` via App → OnClickDialog; PersonPicker stays lazy-only. Ordering with batch 7: `A-structure-07` then moves `loadRoster` into `src/services/rosterAccess.js` and keeps this `GET_ACCOUNT_USERS` import — the two compose, and neither auditor's "pick one destination" warning applies once they are sequenced this way.
- evidence: `mondayService.query('query AccountUsers($limit: Int) { users(limit: $limit) { id name photo_thumb } }', { limit: 500 })` is the only inline op text in the SPA, against 13 named ops in the registry.
- source: auditor:patterns (+ auditor:structure A-structure-07, sequenced)

### A-patterns-07
- files: src/components/ColumnSettings/ColumnSettings.jsx:656-661, :698-703, src/domain/settingsSchema.js:61-68
- action: add `emptyLabelRule` to the existing `../../domain/settingsSchema` import in ColumnSettings.jsx and replace both inline literals with `emptyLabelRule()`. Do **not** replace `getRule` with `getLabelRule` — `getRule` reads the unnormalized DRAFT on purpose, and `getLabelRule` would run `migrateSettings` over it.
- evidence: both inline objects are `{ allowedUserIds: [], allowedTeamIds: [], requiredColumnIds: [], requiredPeopleColumnIds: [] }` — key-for-key what the exported `emptyLabelRule()` returns, a fresh object per call, same as the literals.
- source: auditor:patterns

### A-dependencies-05 (first half only)
- files: src/index.css, src/components/shared/ErrorState.jsx:47, src/components/shared/LoadingState.jsx:18
- action: add one class to `src/index.css` alongside the existing `.twyst-loading-state` rules — `.twyst-center-column { display: flex; flex-direction: column; align-items: center; justify-content: center; padding-top: 3rem; padding-bottom: 3rem; }` (byte-equivalent to the five utilities; `py-12` = 3rem top+bottom) — then swap `className="flex flex-col items-center justify-center py-12"` → `className="twyst-center-column"` in ErrorState.jsx:47 and `className="twyst-loading-state flex flex-col items-center justify-center py-12"` → `className="twyst-loading-state twyst-center-column"` in LoadingState.jsx:18. **Stop there:** keep the `@tailwind base/components/utilities` directives (src/index.css:4-6) and the three devDependencies — the toolchain-removal half is guard-blocked and is in the appendix.
- evidence: every `className` token in `src/` was enumerated — the only Tailwind utilities in use are `flex flex-col items-center justify-center py-12`, in these two files, and there is no `@apply` anywhere, against an app that otherwise styles everything with hand-written `twyst-*` classes. Test-safe: no test file references these classes, and the only `toHaveClass` assertions in the suite are on `app-shell`/`is-modal`/`is-picker` (src/appRoute.test.jsx:85-109). Direction confirmed by history: CHANGELOG.md:485 records `ErrorState`'s Tailwind greys already being replaced by Vibe tokens.
- source: auditor:dependencies

---

## Batch 7 — structure: oversized modules split along existing seams
risk: L | status: pending

Thresholds: component > 250 lines, file > 400, function > 60. Every split is verbatim
movement; where a symbol's import path would change for a **locked** test, a re-export in the
original module is mandatory and is called out per finding. `src/utils/logger.js` (697) and
`src/utils/globalErrorHandler.js` (209) also exceed the file threshold but are guard-blocked
boot layer, so they are not findings.

This is the largest batch in the plan (13 findings, one commit). Recommended order is the one
below: `A-structure-01` first (it creates the files the next two edit), `A-structure-05` after
it, and the server-side findings (08-10) last since they share no file with the SPA ones. If
the human prefers a smaller blast radius, strike findings rather than reordering them.

### A-structure-01
- files: src/components/ColumnSettings/ColumnSettings.jsx:50-78, :81-188, :191-211, :213-555 → new LabelCard.jsx / OptionChecklist.jsx / inlineIcons.jsx / src/components/shared/SelectDropdown.jsx
- action: move, verbatim and in one batch: `LabelCard` (213-555) → `src/components/ColumnSettings/LabelCard.jsx`; `OptionChecklist` (50-78) → `src/components/ColumnSettings/OptionChecklist.jsx`; the three icon components (191-211) → `src/components/ColumnSettings/inlineIcons.jsx`; `SelectDropdown` (81-188) → `src/components/shared/SelectDropdown.jsx`. Add exports to each new file and the four imports to `LabelCard.jsx` (it is the only consumer of all three helpers: `OptionChecklist` at old :471, `SelectDropdown` at :443, icons at :345/:355/:366) plus one `LabelCard` import in `ColumnSettings.jsx`. Keep `./ColumnSettings.css` imported by `ColumnSettings.jsx` only — moved markup keeps the same class names, so no CSS change. Do **not** add `@vibe/core` to `SelectDropdown.jsx` (it uses plain elements + `logger` today); it must stay reachable only from the lazy ColumnSettings chunk.
- evidence: `wc -l ColumnSettings.jsx` = 1362 (3.4× the limit; next largest hand-written file is `src/domain/columnFields.js` at 555). Six top-level units, four of them private helpers; `grep -rn 'LabelCard\|SelectDropdown\|OptionChecklist' src --include=*.jsx --include=*.js` returns no hit outside this file (one unrelated comment mention in transitionsEditorRefinement.test.jsx:60), so no importer anywhere needs updating except `ColumnSettings.jsx`.
- source: auditor:structure

### A-structure-05
- files: src/components/ColumnSettings/ColumnSettings.jsx:213-555 (LabelCard.jsx after A-structure-01) → new src/components/ColumnSettings/LabelPermissions.jsx
- action: after `A-structure-01`, split the accordion body (`<div className="twyst-permissions">`, old :416-550) into `LabelPermissions.jsx` taking `{ label, rule, users, teams, teamsAvailable, columns, peopleColumns, transitionTargets, saving, onChangeRule }`; move `selectedActors` (239-253), `peopleGateOptions` (257-260), `gatePeopleColumnId`/`gatePeopleTitle` (255-256) and the transitions helpers `restricted`/`allowedNext`/`isTargetChecked`/`toggleTarget` (267-279) with it. `summaryBits` (281-289) must stay in `LabelCard` — it renders in the collapsed bar (394-402) — so recompute `gatePeopleTitle` there or pass it down. Keep the round321 WHY-comment (262-266) with `restricted`. Importers to update: `LabelCard.jsx` only.
- evidence: `LabelCard` measures 343 lines (threshold 250) with 19 destructured props (:214-232), and the `{open && (…)}` accordion body is 137 of them.
- source: auditor:structure

### A-structure-04
- files: src/components/ColumnSettings/ColumnSettings.jsx:1167-1225 → new src/components/ColumnSettings/OwnersEditor.jsx
- action: create `OwnersEditor.jsx` with the markup from :1168-1225, taking `{ draftOwners, users, saving, onAddOwner, onRemoveOwner, onMakePrimary }`; pass the three existing one-line mutators (`addOwnerId`/`removeOwnerId`/`makePrimaryOwner`, :692-694) as those props. Leave the auto-revert switch (:1227-1238) and `handleGuardToggle` in `ColumnSettings.jsx`. Keep every `aria-label`/`title` string byte-identical — `guardEnrollOnSave.test.jsx`, `newLabelPermissions.test.jsx` and `defaultLabelCard.test.jsx` query this subtree by accessible name. Importers to update: `ColumnSettings.jsx` only.
- evidence: `<section className="twyst-owners">` spans :1167-1286 inside the 804-line component; the owners-specific part is the heading/note/picker (1168-1192) and the owner list `<ul>` (1193-1225), ~70 lines of JSX plus three inline `setDraft` mutators.
- source: auditor:structure

### A-structure-02 — ⛔ STRUCK BY THE REFUTATION PASS, DO NOT EXECUTE
- **struck because:** `handleGuardToggle` (:1072-1078) is explicitly left in `ColumnSettings` by `A-structure-04`, but it reads `guardConnected` (:1075, derived at :992 from the `guardConn` state at :989-991) and calls `handleAuthorizeGuard` (:1076) — both of which this finding moves into `GuardConnectionPanel`. The proposed props `{ boardId, columnId, saving, autoRevert, isPrimaryOwner }` give the parent no channel back, so the round326 contract (primary owner flipping auto-revert ON without authorization must auto-open the OAuth tab) becomes a **ReferenceError on the one switch that arms the guard**. Nothing in the gate catches it: `no-undef` is off for this workspace, esbuild does not resolve free identifiers, and no test toggles that switch (zero hits for `twyst-autorevert` / the Hebrew label across `src/**/*.test.*`). Second, independent break: the `refreshGuardStatus` probe + window `focus` listener (:1006-1012) currently register ABOVE the early returns at :1082-1091, so the probe fires on mount and the focus refresh is live on the loading and error screens — the documented "owner returns from the OAuth consent tab" path. A child that mounts only after those returns delays the first probe by a full settings+metadata round trip and drops the focus refresh on those screens.
- **to revive it:** respecify with the connection state lifted or the toggle moved WITH it, keep the probe effect in the parent, and state the Fragment requirement (`.twyst-owners` is a flex column; a wrapper `<div>` collapses N flex items into one and silently changes the layout).
- files: src/components/ColumnSettings/ColumnSettings.jsx:989-1058, :1240-1285 → new GuardConnectionPanel.jsx + new src/domain/guardEnrollmentMessage.js
- action: create `src/components/ColumnSettings/GuardConnectionPanel.jsx` holding the two rendered blocks (1240-1258, 1260-1285) plus `guardConn`/`enrolling` state (989-993), `refreshGuardStatus` + focus effect (995-1012), `handleAuthorizeGuard` (1017-1024), `handleEnrollNow` (1047-1058) and `enrolledState` (1122-1124), receiving `{ boardId, columnId, saving, autoRevert, isPrimaryOwner }` as props. `enrollmentProblem` (1032-1037) is called from BOTH the panel and `handleSave` (:955) — move that pure status→Hebrew mapping to `src/domain/guardEnrollmentMessage.js` and import it in both files; do not duplicate it. Keep the `window.addEventListener('focus', …)` registration verbatim, including the `void` calls. Importers to update: `ColumnSettings.jsx` only. Cross-check batch 5's `A-patterns-09`/`A-patterns-13` before editing — they touch the same file. Auditor confidence: medium.
- evidence: `ColumnSettings` measures 804 lines (:557-1360) — the longest function in the app by 461 lines — and ~120 of them are one self-contained concern with its own state, probe effect, two handlers and two rendered blocks.
- source: auditor:structure

### A-structure-03
- files: src/components/ColumnSettings/ColumnSettings.jsx:827-973 (block 863-907) → new src/services/statusLabelsSync.js
- action: extract :863-907 into `src/services/statusLabelsSync.js` exporting `syncStatusLabels({ boardId, columnId, labelsDraft, labelsBaseline })` returning `{ activeLabelIds, reseededDraft }` — or `null` when `hasPendingLabelEdits` is false, so the caller keeps its current `activeLabelIds`. The two `setLabelsDraft`/`setLabelsBaseline` calls (905-906) stay in `handleSave`, applied to the returned `reseededDraft`; the `throw new Error('חסר revision …')` at 870-872 moves with the block so the existing catch (:960) still produces the same message path. Preserve call order exactly: the pending-edits check before `renumberDraftIndexes` (the comment at 874-879 says why). Importers to update: `ColumnSettings.jsx` only. Auditor confidence: medium.
- evidence: `handleSave` measures 147 lines (:827-973), second-longest function in the SPA, serialising five separable steps; the label-mutation step alone is 45 lines and performs three `mondayService.query` round trips.
- source: auditor:structure

### A-structure-06
- files: src/components/OnClickDialog/OnClickDialog.jsx:27-368 → new src/hooks/useStatusPickerData.js
- action: extract into `src/hooks/useStatusPickerData.js` returning `{ labels, currentValue, peopleByColumnId, actor, columnsById, error, setError, dataPending, retry }`: move states :36-41 + :45-49, `columnIdsKey`, `fetchKey`, `dataPending`, `loadDialogData`, its effect and `retryDialogData`. Leave `savingLabelId` (:42) and everything from `pickerModel` (:167) down in the component. The hook call must sit immediately after `useColumnSettings` and BEFORE the boot-overlay effect (:293-295) so effect registration order is unchanged — the comment at :78-86 documents that the overlay effect must run after the fetch effect in the same commit. Move the WHY-comments :44-49, :57-68, :78-86, :105-112, :143-154 with the code; the `logger.warn` for a superseded run (:147) and the `logger.error` (:150) must both survive verbatim (error-guard). If batch 6's `A-patterns-03` landed first, `columnsById` is already gone — drop it from the hook's return. Importers to update: `OnClickDialog.jsx` only. Auditor confidence: medium.
- evidence: `OnClickDialog` measures 342 lines and `loadDialogData` 68; the component owns eight pieces of fetch state plus the whole load/supersede/retry machinery inline, alongside its rendering.
- source: auditor:structure

### A-structure-07
- files: src/components/shared/PersonPicker.jsx:36-54 → new src/services/rosterAccess.js
- action: move :36-54 verbatim into `src/services/rosterAccess.js` exporting `loadRoster` (keep the module-level `rosterCache`, the single-flight `rosterPromise` and its `= null` retry reset). `PersonPicker.jsx` imports `loadRoster` from `../../services/rosterAccess`. Keep the `logger.error('PersonPicker', …)` tag string as-is unless you deliberately accept a log-tag change. If batch 6's `A-patterns-05` landed first, the GraphQL document is already `GET_ACCOUNT_USERS` in `graphqlQueries.js` — import it here rather than re-inlining the text; either way the query text must stay byte-identical because `guardEnrollOnSave.test.jsx:89`, `guardWebhookIndicator.test.jsx:91` and `newLabelPermissions.test.jsx:107` branch on `query.includes('AccountUsers')`. Importers to update: `PersonPicker.jsx` only.
- evidence: a component file owns an API-access service (module-level cache + single-flight promise + inline GraphQL document) while every other monday read in the app lives under `src/services/`; `src/services/teamsAccess.js` (108 lines) is the app's precedent for exactly this shape. `PersonPicker.jsx` is 374 lines, the largest file in `components/shared/`.
- source: auditor:structure (+ auditor:patterns A-patterns-05, sequenced)

### A-structure-13
- files: src/components/ColumnSettings/BypassMonitor.jsx:32-35, :170-219 → new src/components/ColumnSettings/BypassEventRow.jsx
- action: move `fmtWhen` (:170-175) + `renderEvent` (:177-219) into `BypassEventRow.jsx` as a component `BypassEventRow({ event, open, onToggle, labelsById, columnsById, usersById })` with the same markup, and change the call site to `events.map((e, i) => <BypassEventRow key={i} event={e} open={openIdx === i} onToggle={…} … />)` — keep `key={i}` (index) so list identity is unchanged. The `SURFACE` map (:32-35) is used only by `renderEvent`, so it moves too. Rendered DOM must stay identical. Importers to update: `BypassMonitor.jsx` only.
- evidence: `renderEvent` is a 43-line JSX-returning function invoked at :156-160 as `events.map((e, i) => renderEvent(e, i, {…}))` with the React `key` set inside the returned markup (:185) — the one place in the app that renders a list this way; every other list maps to a component element (e.g. ColumnSettings.jsx:1316-1344). No test currently mounts `BypassMonitor` directly.
- source: auditor:structure

### A-structure-11
- files: src/domain/columnFields.js:59-70, :466-555 → new src/domain/valueCoercions.js + new src/domain/columnValueSanitize.js
- action: create `src/domain/valueCoercions.js` with `trimmedString`, `isBlankString`, `entryList` (moved verbatim from :59-70) and import it in `columnFields.js`; then move :466-555 into `src/domain/columnValueSanitize.js` importing the same three helpers. `columnFields.js` **must** re-export: `export { sanitizeColumnValue, sanitizeColumnValues } from './columnValueSanitize.js';` — `src/domain/columnFields.test.js:2-14` (locked) imports both from `'./columnFields.js'`, and `src/domain/columnValueFormats.js:9` imports `sanitizeColumnValues` from there. Keep every probe-verified comment with the code it explains (notably the `item_ids`/NaN note at :510-513). Importers to update: none, thanks to the re-export.
- evidence: `wc -l` = 555 (over the 400 limit); the `/* ---- write-payload sanitizer */` banner at :466 already separates `sanitizeArrayField` (468-475), `sanitizeColumnValue` (485-545) and `sanitizeColumnValues` (548-555) from the registry, and the sanitizer's only in-file dependencies are the three scalar helpers at :59-70.
- source: auditor:structure

### A-structure-12
- files: src/domain/statusLabelDraft.js:302-371 → new src/domain/pruneSettings.js
- action: move :302-371 verbatim into `src/domain/pruneSettings.js` (importing `migrateSettings` from `settingsSchema.js` and `RESERVED_EMPTY_LABEL_ID` from `statusColors.js` directly, so no cycle with `statusLabelDraft.js`), and re-export from `statusLabelDraft.js`: `export { pruneSettingsForActiveLabels } from './pruneSettings.js';`. The re-export is **mandatory** — four locked tests import it from `'./statusLabelDraft.js'` (statusLabelDraft.test.js:10, statusTransitions.test.js:29, statusTransitionsCanonical.test.js:23, statusTransitionsRefinement.test.js:29) and `ColumnSettings.jsx:23` keeps its current import through it. Carry the round321 two-keep-sets comment (:308-322) and the canonical-form comment (:345-355) with the function. Importers to update: none.
- evidence: `wc -l` = 489 (over 400); `pruneSettingsForActiveLabels` is 70 lines and is a settings-blob transform sharing no helper with the label-draft row builders around it.
- source: auditor:structure

### A-structure-09
- files: server/src/routes/guard-routes.js:36-92 → new server/src/routes/guard-webhook.js
- action: move the webhook route (:36-92) into `server/src/routes/guard-webhook.js` exporting `createWebhookRouter({ handleEvent, env, logger })`; `createGuardRouter` mounts it with `router.use(createWebhookRouter(deps))` as its **first** statement, before the sessionToken routes, so path resolution order is unchanged. Keep the challenge echo before the JWT check, the `res.status(202)`-then-`setImmediate` ordering, and the `.catch` funnel at :82-90 verbatim (all documented contracts, docblock :4-14). Importers to update: none — `server/src/app.js` and `server/tests/httpSurface.test.js` reach this only through `createApp`/`createGuardRouter`.
- evidence: one 192-line router factory (:33-224 in a 224-line file) carries four HTTP surfaces with two different auth models — unsigned-handshake/JWT webhook (36-92) plus three sessionToken-authed JSON endpoints (108-144, 148-180, 182-221).
- source: auditor:structure

### A-structure-10 — ⚠ AMENDED BY THE REFUTATION PASS
- **amendment (mandatory, or the build gate fails):** batch 5's `A-patterns-04` adds the FIRST relative import to `stores.js` — `../../../src/domain/columnConfigKey.js`. This finding then moves `createRulesStore` one directory deeper, where that specifier resolves to `apps/twyst-your-status/server/src/domain/`, which does not exist; `server/build.mjs` bundles the `../src/domain` imports with esbuild, so a *verbatim* move (this batch's stated premise) fails `CLEANUP_BUILD_CMD`. Either rewrite the moved specifier to `../../../../src/domain/columnConfigKey.js`, or execute this finding BEFORE `A-patterns-04`. Second amendment: `REFRESH_CUSHION_MS` is filed into `unwrapStoredValue.js` only because it sits at :41 — its sole use is :72 inside `createTokenStore`, so it belongs in `tokenStore.js`.
- files: server/src/services/stores.js:1-266 → new server/src/services/stores/{unwrapStoredValue,tokenStore,rulesStore,bypassLog,enrollmentStore}.js
- action: create `server/src/services/stores/` with `unwrapStoredValue.js` (:26-38 + `REFRESH_CUSHION_MS`), `tokenStore.js`, `rulesStore.js`, `bypassLog.js`, `enrollmentStore.js`, and keep `server/src/services/stores.js` as a re-export barrel. The barrel is **mandatory**: `server/tests/services.test.js:2-7` imports `unwrapStoredValue, createTokenStore, createRulesStore, createEnrollmentStore` and `server/tests/bypassLog.test.js:10` imports `createBypassLog`, both from `'../src/services/stores.js'`, and tests are locked; `server/src/index.js:44` keeps working through the barrel too. Move the module docblock (:1-23) to the barrel and each per-factory docblock with its factory — the round322 identity model and the apps-sdk 0.1.4 wrapping incident note (:20-22) are load-bearing. Coordinate with batch 1 `A-comments-05` and batch 5 `A-patterns-04`, which also edit this file.
- evidence: `wc -l` = 266 with four unrelated factories plus two shared helpers — `createTokenStore` 61-159 (the OAuth refresh state machine), `createRulesStore` 164-182, `createBypassLog` 194-250, `createEnrollmentStore` 256-266 over `unwrapStoredValue` 26-32 / `validToken` 34-38 — so any consumer of one store loads all four.
- source: auditor:structure

### A-structure-08 — ⛔ STRUCK BY THE REFUTATION PASS, DO NOT EXECUTE
- **struck because:** the stated boundaries contradict each other and cannot preserve control flow. `resolveGuardIdentity(event)` is specified over :101-138 as a value-returning helper, but that range contains THREE early returns a return-shape cannot express — `if (!reader) { logger.info('event skipped: account not activated', …); return; }` (:102-105), `if (!rules) return;` (:109), and the loop-guard return (:122-126) — while the action ALSO says "keep the loop-guard block (117-126) inline in `process`", and 117-126 is inside 101-138. `previousLabelId`/`newLabelId` (:114-115) are computed in that range yet absent from the return shape, though the inline loop guard (:124), the verdict (:170-171), the revert (:209, :212) and the bypass record (:245-248) all need them. The natural resolution — resolving `primaryToken` (:135-138) before the loop guard — adds a `tokenStore.getOwnerToken` call on every revert echo, exactly the work the loop guard exists to skip; the echo test (`server/tests/handleStatusChangeEvent.test.js:182-207`) does not pin that call count, so it would **ship green**, while :142, :163, :421 and :525 DO pin `getOwnerToken` `not.toHaveBeenCalled()` for neighbouring paths. Same range is also wrong for `gatherVerdictInput`: `requiredColumnIds` (:144-146) is computed inside it and consumed at :235 by `collectEmptyFieldIds` in the bypass slice.
- **to revive it:** respecify with explicit sentinel returns, the full value set per helper, and non-overlapping ranges — or leave this function alone.
- files: server/src/guard/handleStatusChangeEvent.js:94-253
- action: split `process` into four named async helpers declared **inside the same factory closure** (so `pendingReverts`, `now`, `TAG` and the injected deps stay in scope and the module's export surface is untouched): `resolveGuardIdentity(event)` → `{ readToken, rules, owners, primaryToken, boardReadToken }` (101-138), `gatherVerdictInput(...)` → `{ labels, teamIds, peopleByColumnId, requiredFieldValues }` (140-164), `maybeRevert(...)` → boolean (190-228), `recordBypass(...)` (230-252). Keep the loop-guard block (117-126) and the verdict + trace log (166-188) inline in `process`. Every `logger.*` call must survive as-is, including the nested notification catch at :218-225 (error-guard). Do not change the exported names `createStatusChangeHandler`, `REVERT_NOTIFICATION_TEXT`, `REVERTABLE_REASONS` — `server/tests/handleStatusChangeEvent.test.js` imports exactly those three. Importers to update: none. Auditor confidence: medium.
- evidence: `createStatusChangeHandler` measures 209 lines (:62-270) and the inner `process` 160 (:94-253) — the largest server function — running six sequential phases already labelled by the module docblock's numbered list (:8-27) and the two `// ---- …` banners at :190 and :230.
- source: auditor:structure

---

## Appendix — non-actionable (not for execution)

Nothing in this table is batched. Rows 1-20 are knip hits that the verification pass killed;
rows 21-31 are auditor/scanner entries that are guard-blocked, superseded, below the value
threshold, or owner decisions. "Guard rule N" refers to `scripts/cleanup/guard-protected-paths.sh`
(rule 3 tests/test infra, rule 4 build output, rule 5+6 error/observability boot layer +
`src/components/ErrorBoundary/*`, rule 7 config/docs/lockfiles).

| id | verdict/reason | evidence |
|---|---|---|
| K-002 | FALSE_POSITIVE — also guard-blocked (rule 5+6, `src/hooks/useUiErrorSink.js` is in the protected file list) | Protected error/observability boot layer: named in `apps/twyst-your-status/.error-guard:6` as the one-logged-ERROR-equals-one-toast display path, documented as the wiring contract in `src/index.jsx:17-18`, hard-blocked by `guard-protected-paths.sh:76`. Reached from the platform/contract, not from an import. |
| K-005 | FALSE_POSITIVE — also guard-blocked (rule 5+6, `globalErrorHandler.js`) | Live inside its own module at `src/utils/globalErrorHandler.js:133` (`setupGlobalErrorHandlers` registers `options.handleChunkError`) and re-exported at :207; asserted structurally by `scripts/error-wiring-audit.mjs:99-105`. |
| K-006 | FALSE_POSITIVE — also guard-blocked (rule 5+6) | Called from the window listeners in the same module at `src/utils/globalErrorHandler.js:181` and :197, re-exported at :205; file listed at `guard-protected-paths.sh:74` and in `.error-guard:4`. |
| K-007 | FALSE_POSITIVE — also guard-blocked (rule 5+6) | The default export aggregates the platform-reached handler API (`globalErrorHandler.js:203-208`, incl. `setupGlobalErrorHandlers` used at `src/index.jsx:26,37`); exports here are reached from the platform, not from imports. |
| K-008 | FALSE_POSITIVE — also guard-blocked (rule 5+6, `logger.js`) | Used by `logger.track`/`logger.health` in the same module at `src/utils/logger.js:572` and :590; drift-relevant to `@mapps/error-kit`'s `encodeDims` contract. |
| K-009 | FALSE_POSITIVE — also guard-blocked (rule 5+6, `logger.js`) | `LOG_LEVELS` drives the whole level policy inside its own module — `src/utils/logger.js:73, 385-386, 396, 401, 503, 517, 533, 553` — and the export at :696 is part of the logger's published surface. |
| K-010 | FALSE_POSITIVE — also guard-blocked (rule 5+6, `axiomLoggerAdapter.js`) | Used by `makeAxiomLogger` in the same module at `src/utils/axiomLoggerAdapter.js:28-29`, and `makeAxiomLogger` is the Axiom sink bridge imported at `src/index.jsx:29`. |
| K-011 | FALSE_POSITIVE — also guard-blocked (rule 5+6, `src/components/ErrorBoundary/*`) | Documented catch-funnel API for routing non-render catches into the boundary (`AppErrorBoundary.jsx:151-172`, referenced in `src/index.jsx:15`); the whole boundary tree is the render-phase catch `error-wiring-audit.mjs:99-105` requires. |
| K-012 | FALSE_POSITIVE — also guard-blocked (rule 5+6) | The module is live via its named export (`src/index.jsx:31` imports `{ AppErrorBoundary }`, used at :89-91; also `AppErrorBoundary.componentStack.test.jsx:17`); the default export at :174 sits in the refused directory. |
| K-013 | FALSE_POSITIVE — also guard-blocked (rule 5+6) | The binding in the duplicate group is live: named import at `src/index.jsx:31`, rendered at :89-91 (`<AppErrorBoundary scope="root">`), plus `AppErrorBoundary.componentStack.test.jsx:17`. |
| K-015 | FALSE_POSITIVE | `nextNewLabelClientId` is called in its own module at `src/domain/statusLabelDraft.js:428` inside `buildCreateLabelPayload` (imported by `ColumnSettings.jsx:15` and 4 tests). Only the `export` keyword is unused — deleting the binding breaks label creation. |
| K-017 | FALSE_POSITIVE | `PICKER_OPTION_HEIGHT_PX` used in-file at `src/utils/pickerDialogSize.js:19` inside `pickerDialogHeightPx`, which `src/utils/pickerDialogSize.test.js:4` pins to 250 (8*2 + 6*34 + 5*6). |
| K-018 | FALSE_POSITIVE | `PICKER_OPTION_GAP_PX` used in-file at `src/utils/pickerDialogSize.js:20` (`Math.max(0, n-1) * PICKER_OPTION_GAP_PX`), exercised by `pickerDialogSize.test.js:10-20`. |
| K-019 | FALSE_POSITIVE | `PICKER_MENU_PADDING_PX` used in-file at `src/utils/pickerDialogSize.js:18` (`PICKER_MENU_PADDING_PX * 2`), exercised by `pickerDialogSize.test.js:10`. |
| K-021 | FALSE_POSITIVE | The duplicate group's live half is the named `PersonPicker` export, imported at `ColumnSettings.jsx:43` and `FieldControl.jsx:12` (used at ColumnSettings.jsx:420, :1178, FieldControl.jsx:110). Only the redundant default half is removable — that is K-020 in batch 3; collapsing toward default-only would break both importers. |
| K-023 | FALSE_POSITIVE | The group's named `Popover` half is live: `BoardRelationFieldControl.jsx:25` (:132-189), `OptionFieldControls.jsx:13` (:63, :126), `DateFieldControl.jsx:14` (:92). Only the redundant default half is removable — K-022 in batch 3. |
| K-024 | FALSE_POSITIVE | `MONDAY_API_URL` used in its own module at `server/src/services/monday-api.js:86` (`await doFetch(MONDAY_API_URL, …)`) inside `createMondayApi`, which `server/src/index.js:42` imports; `server/tests/services.test.js:429` asserts that exact URL. Deleting it breaks the guard's GraphQL funnel. |
| K-025 | FALSE_POSITIVE | `REFRESH_CUSHION_MS` used in-file at `server/src/services/stores.js:72` (`record.expiresAt - now() > REFRESH_CUSHION_MS` in `createTokenStore`'s `isFresh` gate). Only the `export` keyword lacks an external importer. |
| K-026 | FALSE_POSITIVE | `OAUTH_SCOPES` used in-file at `server/src/routes/oauth.js:78` (`scope: OAUTH_SCOPES` in the `/oauth/start` URLSearchParams); the router is mounted by string path via `server/src/app.js:19`. |
| K-027 | FALSE_POSITIVE | `AUTHORIZE_URL` used in-file at `server/src/routes/oauth.js:96` (fallback authorize base when `session.slug` is absent); reached by URL through `app.js:19`, so no static importer of the symbol is expected. |
| A-comments-09 | SUPERSEDED by K-004 (batch 2) | The finding fixes a dead `SOURCE:` provenance line at `src/components/shared/StatusChip.jsx:1` ("ported from apps/discussions/…/StatusBadge.jsx" — removed there in discussions round337, c1c5a9f / 9578d2e). Batch 2 deletes the whole file, so applying both is contradictory; the auditor itself said to skip this one if a file batch lands. |
| A-comments-10 | NOT A CHANGE — record-only (both raw scanner inputs empty) | All 11 `commented-code.txt` candidates are WHY-knowledge false positives (five of them in guard-blocked files): `server/src/app.js:55-57` error-middleware contract, `process-guards.js:8-10` vendored-template/exit policy, `monday-api.js:201-203` `change_status_column_value` requirement "verified live 2026-08-05", `monday-oauth-client.js:2-4`/:8-10 OAuth 2.1 notes, `src/index.jsx:43-45` `setAxiomContext` wiring, plus prose/banners in `globalErrorHandler.js` and `logger.js`. `todos.txt` is 0 lines; a direct `TODO|FIXME|XXX|HACK|WIP` grep finds nothing, and a code-shaped-comment regex across `src` + `server/src` + all 8 CSS files finds zero commented-out statements or rules. Delete nothing. |
| A-comments-11 (scope note) | PARTIALLY REJECTED by design | The finding itself is in batch 1, but it must not be extended: every other one-liner examined restated a platform fact or a fail-closed rule and was deliberately left alone. |
| A-dependencies-02 | OWNER DECISION — not a cleanup batch | Pinning the guard server's four caret deps to the lockfile's resolutions (`@axiomhq/js 1.8.0`, `@mondaycom/apps-sdk 0.1.4`, `express 4.22.2`, `jsonwebtoken 9.0.3`) changes what monday-code installs in production, so it is not behaviour-preserving and the batch gate cannot prove it — it needs a release, not a revertable cleanup commit. Real and worth doing: `server/build.mjs:5` states the platform installs from this file, the pushed archive carries no lockfile, and two code workarounds are written against an exact SDK build (`server/src/services/stores.js:19-22` PLATFORM TRAP incident 2026-07-15; `server/src/helpers/sdk-log-filter.js:2-13` matches apps-sdk 0.1.4 console output). If the owner wants it, the command is `pnpm add --filter twyst-your-status-guard @axiomhq/js@1.8.0 @mondaycom/apps-sdk@0.1.4 express@4.22.2 jsonwebtoken@9.0.3` (never hand-edit the lockfile — guard rule 7). |
| A-dependencies-05 (second half) | GUARD-BLOCKED (rule 7 — `postcss.config.js`, `tailwind.config.js`) + real visual change | Removing the Tailwind toolchain after the two class swaps would drop preflight from the eager stylesheet (~3.6 KB of `dist/assets/index-BS7mhOPz.css`, 26 generated utilities of which 21 are phantom matches from inline styles/comments) — a visual change — and requires editing two config files the guard refuses. Keep `@tailwind base/components/utilities` (src/index.css:4-6) and the three devDependencies; owner decision. |
| A-dependencies-06 | SKIPPED — owner decision, hazardous both ways | The app carries eslint 8 + eslint 9 and vitest 2 + vitest 3 (one pair per workspace, two config dialects). Converging needs edits the guard blocks (`server/eslint.config.js`, rule 7) or a lint-dialect migration of the SPA `eslintConfig` block. `src/setupTests.js:4-12` documents that a bare `vitest` specifier resolved from `@testing-library/jest-dom`'s context "walks up to a hoisted vitest" and kills every matcher ("Invalid Chai property: toBeInTheDocument"), with `src/test-utils/jestDomMatchers.test.jsx` as the tripwire; the lockfile also keys `@vibe/core` 3.88.3 on `vitest@2.1.9` as an optional peer. |
| A-dependencies-07 | PRE-DECLARED SKIPS — five dependencies that must not be proposed | (1) `@mapps/error-kit` — already in `knip.jsonc`'s `ignoreDependencies`; imported by subpath at `src/index.jsx:27` and `src/hooks/useMondayContext.js:4`, which knip 5 does not credit to the bare name. (2) `@axiomhq/js` (server) — only importer is `server/src/helpers/axiomServerSink.js:28`, guard-blocked (rule 5+6) and drift-locked by `packages/error-kit/test/drift.test.ts`. (3) `react-error-boundary` — only importer is `AppErrorBoundary.jsx:26`, guard-blocked (rule 5+6). (4) `@mondaycom/apps-cli` — no source importer; it backs the `start`/`expose`/`logs`/`logs:http`/`status` scripts (package.json:12,19,21,22,23). (5) `@testing-library/jest-dom` — single importer `src/setupTests.js:13`, test infrastructure (guard rule 3). |
| A-dependencies-08 | SKIPPED — hand-rolled overlay/loader UI is incident-driven, not duplication | `Popover.jsx:1-7` records that the body-portal pattern "replaced Vibe Dialog/Combobox after they clipped, double-rendered, and dropped clicks inside board-view tables"; `PersonPicker.jsx:1-4` forbids rebuilding from Vibe; `LoadingState.jsx:3-8` / `ErrorState.jsx:3-19` use plain elements + Vibe CSS custom properties because they sit on the eager path (`gate-eager.log`: "no static path to @vibe/core — 28 eager modules walked"). No consolidation in either direction, and never add a `@vibe/core` import to a module statically reachable from `src/index.jsx`. `@vibe/core` is not dead either (AttentionBox ×5, Button ×2, Heading, ColorPicker, Avatar, AvatarGroup behind lazy boundaries). Also ruled out: `@vibe/icons` IS tree-shaken (6/4/7/14/2 `viewBox` occurrences in the built chunks), and `monday-sdk-js`' `node-fetch` does not reach the browser bundle. |
| A-structure-14 | MEASURED AND ACCEPTED — no change | Five units sit just over the 60-line function limit but under the 250-line component limit and are single-concern: `addLabel` 61 (ColumnSettings.jsx:752-812), `FieldControl` 154 (a flat 10-branch dispatcher, :34-187), `DateFieldControl` 156, `BoardRelationFieldControl` 154, `RequiredFieldsModal` 177. Recorded so a later pass does not re-litigate them; if one is touched for another reason, leave its size alone. |
| A-patterns "observed, not proposed" | SKIPPED — each would change behaviour, not just shape | Six recorded non-items: `openAppFeatureModal` awaited in `SettingsLauncher.jsx:81-91` and deliberately unawaited in `OnClickDialog.jsx:220-233` (aligning changes visible button state); `ColumnSettings.dismiss` wraps both close calls in one `try` (:814-825) while `RequiredFieldsModal.close` (:113-124) splits them and explains the order; `BypassMonitor` keeps one `{ status, events }` object where six other fetchers use separate `loading`/`error`/`data`; three stale-run idioms (`runIdRef`/`cancelled`/`alive`) with three fetchers having none — adding a guard is a behaviour change; `API_VERSION = '2026-04'` pinned twice (`src/services/mondayService.js:6`, `server/src/services/monday-api.js:20`, the latter pinned by a server test) — sharing it would add a server → `src/services` import edge for one string; `statusPolicy.js`'s second settings schema (`STATUS_GUARD_CONFIG_VERSION`, `makeStatusGuardStorageKey`, `normalizeStatusGuardConfig`, `@deprecated buildStatusPickerModel`) whose only remaining callers are the locked `statusPolicy.test.js` — removal would require editing a test (guard rule 3). |
| jscpd clone 2 | BELOW THRESHOLD + area already covered | `server/src/routes/guard-routes.js 148-154 ↔ 182-189` (8 lines/103 tokens) is the `requireSession` + `String(req.query.boardId/columnId ?? '').trim()` prelude shared by `/api/guard/bypasses` and `/api/guard/status`. The patterns auditor examined exactly this area and deliberately limited extraction to the reader-token prelude (A-patterns-14, `/enroll` ↔ `/bypasses`) because `/status` diverges on purpose right after — it answers 200 with an all-false body instead of 409 (comment at guard-routes.js:191). Extracting the remaining four lines would touch the route the auditor ruled out for a helper wrapping two `.trim()` calls. |
| jscpd clone 3 | NOT ACTIONABLE — divergent near-duplicate across two CSS modules | `src/components/shared/PersonPicker.module.css 53-58 ↔ Popover.module.css 4-9` (6 lines/82 tokens). Verified not identical: the shared `.popover` block differs (`padding: 10px` vs `8px`, and Popover adds `box-sizing`, `overflow`, `max-height`). `Popover.module.css:1-2` records that it was generalized from the PersonPicker styles, i.e. the overlap is a deliberate port; consolidating would need a shared stylesheet imported by both, which defeats the per-component scoping CSS modules exist for and risks a visual change on the picker. |
