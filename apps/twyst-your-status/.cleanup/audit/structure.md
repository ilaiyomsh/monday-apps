# Audit — structure (twyst-your-status)

Scope: `apps/twyst-your-status/src` + `apps/twyst-your-status/server/src`. Read-only audit;
no source was modified. Thresholds used: component > 250 lines, file > 400 lines, function >
60 lines, prop drilling > 2 levels, location vs. the app's own convention (`domain/` pure
logic, `services/` API access, `hooks/`, `components/<Surface>/`, `utils/`).

Function/file sizes below were measured over `src/**` + `server/src/**` excluding
`*.test.*` (brace-depth scan). Test files are excluded from every action — they are locked,
so any split that would change a symbol's import path is specified with a re-export in the
original module instead.

Two standing constraints referenced by several findings:
- `scripts/lib/eager-graph.mjs` invariant: `@vibe/core` must never be statically reachable
  from `src/index.jsx`. `src/components/shared/{ErrorState,LoadingState}.jsx` carry
  WHY-comments saying exactly that. Any file moved into `components/shared/` must stay
  Vibe-free unless it is only reachable from a lazy chunk.
- `src/utils/logger.js` (697 lines) and `src/utils/globalErrorHandler.js` (209) exceed the
  file threshold but are the protected error/observability boot layer named in
  `.error-guard`; the cleanup guard blocks them, so they are **not** findings here.

---

### A-structure-01
- files: src/components/ColumnSettings/ColumnSettings.jsx:50-78, src/components/ColumnSettings/ColumnSettings.jsx:81-188, src/components/ColumnSettings/ColumnSettings.jsx:191-211, src/components/ColumnSettings/ColumnSettings.jsx:213-555
- issue: `ColumnSettings.jsx` is 1362 lines — 3.4× the 400-line file limit — because it holds six top-level units, four of which are private helper components with no relation to the settings surface's own logic.
- evidence: `wc -l` = 1362 (largest hand-written file in the app; next is `src/domain/columnFields.js` at 555). Units in the file: `OptionChecklist` 50-78, `SelectDropdown` 81-188, `ChevronUpIcon`/`ChevronDownIcon`/`TrashIcon` 191-211, `LabelCard` 213-555, `ColumnSettings` 557-1360. `grep -rn 'LabelCard\|SelectDropdown\|OptionChecklist' src --include=*.jsx --include=*.js` returns no hit outside this file (one unrelated comment mention in `transitionsEditorRefinement.test.jsx:60`), so none of the four is imported anywhere today.
- action: move, verbatim and in one batch: `LabelCard` (213-555) → new `src/components/ColumnSettings/LabelCard.jsx`; `OptionChecklist` (50-78) → new `src/components/ColumnSettings/OptionChecklist.jsx`; the three icon components (191-211) → new `src/components/ColumnSettings/inlineIcons.jsx`; `SelectDropdown` (81-188) → new `src/components/shared/SelectDropdown.jsx`. Add `export default`/named exports to each new file, and add the four imports to `LabelCard.jsx` (it is the only consumer of all three helpers: `OptionChecklist` at old line 471, `SelectDropdown` at 443, icons at 345/355/366) plus one `LabelCard` import in `ColumnSettings.jsx`. Keep `./ColumnSettings.css` imported by `ColumnSettings.jsx` only — the moved markup keeps using the same class names, so no CSS change. Do NOT add `@vibe/core` to `SelectDropdown.jsx` (it uses plain elements + `logger` today); it stays reachable only from the lazy ColumnSettings chunk. Importers to update: `ColumnSettings.jsx` only.
- risk: M
- confidence: high

### A-structure-02
- files: src/components/ColumnSettings/ColumnSettings.jsx:557-1360, src/components/ColumnSettings/ColumnSettings.jsx:989-1058, src/components/ColumnSettings/ColumnSettings.jsx:1240-1285
- issue: the `ColumnSettings` component function is 804 lines, and ~120 of them are one self-contained concern (the guard connection/enrollment panel: its own state, its own probe effect, two handlers and two rendered blocks).
- evidence: measured 804 lines for `ColumnSettings` (557-1360) — the longest function in the app by 461 lines. The guard concern is `guardConn`/`enrolling` state 989-993, `refreshGuardStatus` + focus effect 995-1012, `handleAuthorizeGuard` 1017-1024, `enrollmentProblem` 1032-1037, `handleEnrollNow` 1047-1058, `enrolledState` 1122-1124, and the two rendered blocks 1240-1258 + 1260-1285.
- action: create `src/components/ColumnSettings/GuardConnectionPanel.jsx` holding the two rendered blocks and the state/handlers listed above, receiving `{ boardId, columnId, saving, autoRevert, isPrimaryOwner }` as props. `enrollmentProblem` (1032-1037) is called from BOTH the panel and `handleSave` (line 955), so move that pure status→Hebrew mapping to a new `src/domain/guardEnrollmentMessage.js` and import it in both files — do not duplicate it. Keep the `refreshGuardStatus` effect inside the new component (it only feeds the panel's own display) and keep the `window.addEventListener('focus', …)` registration verbatim, including the `void` calls. Importers to update: `ColumnSettings.jsx` only. Cross-check with the `patterns` audit before executing: it also touches this area.
- risk: L
- confidence: medium

### A-structure-03
- files: src/components/ColumnSettings/ColumnSettings.jsx:827-973
- issue: `handleSave` is 147 lines and serialises five separable steps (draft validation, live-revision label mutation + re-seed, prune/owners assembly, schema+type validation, storage write + enrollment + dismissal).
- evidence: measured 147 lines (827-973); second-longest function in the SPA after the component that contains it. The label-mutation step alone is 45 lines (863-907) and performs three `mondayService.query` round trips.
- action: extract lines 863-907 into a new `src/services/statusLabelsSync.js` exporting `syncStatusLabels({ boardId, columnId, labelsDraft, labelsBaseline })` that returns `{ activeLabelIds, reseededDraft }` (or `null` when `hasPendingLabelEdits` is false, so the caller keeps its current `activeLabelIds`). The two `setLabelsDraft`/`setLabelsBaseline` calls (905-906) stay in `handleSave`, applied to the returned `reseededDraft`; the `throw new Error('חסר revision …')` at 870-872 moves with the block so the existing catch (960) still produces the same message path. Preserve call order exactly: the pending-edits check before `renumberDraftIndexes` (the comment at 874-879 states why). Importers to update: `ColumnSettings.jsx` only.
- risk: L
- confidence: medium

### A-structure-04
- files: src/components/ColumnSettings/ColumnSettings.jsx:1167-1225, src/components/ColumnSettings/ColumnSettings.jsx:1227-1238
- issue: the owners editor is ~70 lines of JSX plus three inline `setDraft` mutators inside the same 804-line component, mixed with the guard panel in one `<section>`.
- evidence: `<section className="twyst-owners">` spans 1167-1286; the owners-specific part is the heading/note/picker 1168-1192, the owner list `<ul>` 1193-1225, and the auto-revert switch 1227-1238. Its mutators `addOwnerId`/`removeOwnerId`/`makePrimaryOwner` are one-liners at 692-694.
- action: create `src/components/ColumnSettings/OwnersEditor.jsx` with the markup from 1168-1225, taking `{ draftOwners, users, saving, onAddOwner, onRemoveOwner, onMakePrimary }`; pass the three existing mutators as those props. Leave the auto-revert switch (1227-1238) and `handleGuardToggle` in `ColumnSettings.jsx` (it writes `draft.autoRevert` and triggers the OAuth open — see A-structure-02). Keep every `aria-label`/`title` string byte-identical: `guardEnrollOnSave.test.jsx`, `newLabelPermissions.test.jsx` and `defaultLabelCard.test.jsx` query this subtree by accessible name. Importers to update: `ColumnSettings.jsx` only.
- risk: M
- confidence: high

### A-structure-05
- files: src/components/ColumnSettings/ColumnSettings.jsx:213-555
- issue: `LabelCard` is a 343-line component (threshold 250) with 19 props, and more than a third of it is the permissions accordion body.
- evidence: measured 343 lines; props destructured at 214-232 count 19 (`label, hidden, rule, users, teams, teamsAvailable, columns, peopleColumns, usedColors, transitionTargets, saving, isFirst, isLast, onRename, onRecolor, onRemove, onMove, onToggleHidden, onChangeRule`). The `{open && (…)}` accordion body is 415-551 (137 lines).
- action: after A-structure-01, split the accordion body (the `<div className="twyst-permissions">` at 416-550) into `src/components/ColumnSettings/LabelPermissions.jsx` taking `{ label, rule, users, teams, teamsAvailable, columns, peopleColumns, transitionTargets, saving, onChangeRule }`; move `selectedActors` (239-253), `peopleGateOptions` (257-260), `gatePeopleColumnId`/`gatePeopleTitle` (255-256) and the transitions helpers `restricted`/`allowedNext`/`isTargetChecked`/`toggleTarget` (267-279) with it. `summaryBits` (281-289) must stay in `LabelCard` — it renders in the collapsed bar (394-402) — so recompute `gatePeopleTitle` there or pass it down; keep the round321 WHY-comment (262-266) with `restricted`. Importers to update: `LabelCard.jsx` only.
- risk: M
- confidence: high

### A-structure-06
- files: src/components/OnClickDialog/OnClickDialog.jsx:27-368
- issue: the picker component is 342 lines because it owns eight pieces of fetch state plus the whole load/supersede/retry machinery inline, alongside its rendering.
- evidence: measured 342 lines for `OnClickDialog` (27-368) and 68 for `loadDialogData` (89-156). The fetch machinery is states 36-49 (`labels`, `currentValue`, `peopleByColumnId`, `actor`, `columnsById`, `error`, `savingLabelId`, `loadedKey`, `reloadToken`, `runIdRef`), `columnIdsKey` 69-74, `fetchKey` 76, `dataPending` 87, `loadDialogData` 89-156, its effect 158-160 and `retryDialogData` 165.
- action: extract into a new `src/hooks/useStatusPickerData.js` returning `{ labels, currentValue, peopleByColumnId, actor, columnsById, error, setError, dataPending, retry }`: move states 36-41 + 45-49, `columnIdsKey`, `fetchKey`, `dataPending`, `loadDialogData`, its effect and `retryDialogData`. Leave `savingLabelId` (42) and everything from `pickerModel` (167) down in the component. The hook call must be placed immediately after `useColumnSettings` and BEFORE the boot-overlay effect (293-295) so effect registration order is unchanged — the comment at 78-86 documents that the overlay effect must run after the fetch effect in the same commit. Move the WHY-comments 44-49, 57-68, 78-86, 105-112 and 143-154 with the code; the `logger.warn` for a superseded run (147) and the `logger.error` (150) must both survive verbatim (error-guard). Importers to update: `OnClickDialog.jsx` only. If the `patterns` finding about the write-only `columnsById` lands first, drop it from the hook's return.
- risk: L
- confidence: medium

### A-structure-07
- files: src/components/shared/PersonPicker.jsx:36-54
- issue: a component file owns an API-access service — module-level roster cache, a single-flight promise and a GraphQL query string — while every other monday read in the app lives under `src/services/`.
- evidence: lines 36-54 hold `rosterCache`, `rosterPromise` and `async function loadRoster()` with the inline document `query AccountUsers($limit: Int) { users(limit: $limit) { id name photo_thumb } }`; `src/services/teamsAccess.js` (108 lines) is the app's precedent for exactly this shape (module-level fetch + graceful degradation). `PersonPicker.jsx` is 374 lines, the largest file in `components/shared/`.
- action: move lines 36-54 verbatim into a new `src/services/rosterAccess.js` exporting `loadRoster` (keep the cache and `rosterPromise = null` retry reset, and keep the `logger.error('PersonPicker', …)` call sites' behaviour — retag to `'rosterAccess'` only if you also accept a log-tag change; if in doubt keep the string). `PersonPicker.jsx` imports `loadRoster` from `../../services/rosterAccess`. The query text must move byte-identical: `guardEnrollOnSave.test.jsx:89`, `guardWebhookIndicator.test.jsx:91` and `newLabelPermissions.test.jsx:107` branch on `query.includes('AccountUsers')`. Importers to update: `PersonPicker.jsx` only. Overlaps the `patterns` finding that wants this document registered in `services/graphqlQueries.js` — pick one destination, not both.
- risk: M
- confidence: high

### A-structure-08
- files: server/src/guard/handleStatusChangeEvent.js:94-253
- issue: the guard's per-delivery `process` is a 160-line function inside a 209-line factory, running six sequential phases (identity, rules, loop guard, context gathering, verdict, revert + bypass record) with no internal seams.
- evidence: measured `createStatusChangeHandler` 62-270 (209 lines) and the inner `process` 94-253 (160) — the largest server function. The phases are already labelled by the module docblock's numbered list (lines 8-27) and by the two `// ---- …` banners at 190 and 230.
- action: split `process` into four named async helpers declared inside the same factory closure (so `pendingReverts`, `now`, `TAG` and the injected deps stay in scope, and the module's export surface is untouched): `resolveGuardIdentity(event)` → `{ readToken, rules, owners, primaryToken, boardReadToken }` (101-138), `gatherVerdictInput(...)` → `{ labels, teamIds, peopleByColumnId, requiredFieldValues }` (140-164), `maybeRevert(...)` → `boolean` (190-228), `recordBypass(...)` (230-252). Keep the loop-guard block (117-126) and the verdict + trace log (166-188) inline in `process`. Every `logger.*` call must survive as-is, including the nested notification catch at 218-225 (error-guard). Do not change the exported names `createStatusChangeHandler`, `REVERT_NOTIFICATION_TEXT`, `REVERTABLE_REASONS` — `server/tests/handleStatusChangeEvent.test.js` imports exactly those three. Importers to update: none.
- risk: L
- confidence: medium

### A-structure-09
- files: server/src/routes/guard-routes.js:33-224
- issue: one 192-line router factory carries four HTTP surfaces with different auth models — the unsigned-handshake/JWT webhook and three sessionToken-authed JSON endpoints.
- evidence: measured `createGuardRouter` 33-224 (192 lines) in a 224-line file. Routes: webhook 36-92, enroll 108-144, bypasses 148-180, status 182-221, with shared helpers `requireSession` 94-98 and `isBoardOwner` 100-106.
- action: move the webhook route (36-92) into a new `server/src/routes/guard-webhook.js` exporting `createWebhookRouter({ handleEvent, env, logger })`; `createGuardRouter` mounts it with `router.use(createWebhookRouter(deps))` as its first statement, before the sessionToken routes, so path resolution order is unchanged. Keep the challenge echo before the JWT check and the `res.status(202)`-then-`setImmediate` ordering verbatim (both are documented contracts in the file's docblock, lines 4-14), and keep the `.catch` funnel at 82-90. `server/src/app.js` and `server/tests/httpSurface.test.js` both reach this only through `createApp`/`createGuardRouter`, so no import path changes. Importers to update: none.
- risk: M
- confidence: high

### A-structure-10
- files: server/src/services/stores.js:26-266
- issue: four unrelated storage factories plus two shared helpers live in one 266-line module, so any consumer of one store loads all four.
- evidence: `wc -l` = 266; `createTokenStore` 61-159 (99 lines, the OAuth refresh state machine), `createRulesStore` 164-182, `createBypassLog` 194-250, `createEnrollmentStore` 256-266, over the shared `unwrapStoredValue` 26-32 / `validToken` 34-38.
- action: create `server/src/services/stores/` with `unwrapStoredValue.js` (26-38 + `REFRESH_CUSHION_MS`), `tokenStore.js`, `rulesStore.js`, `bypassLog.js`, `enrollmentStore.js`, and keep `server/src/services/stores.js` as a re-export barrel (`export { … } from './stores/…'`). The barrel is mandatory, not optional: `server/tests/services.test.js:2-7` imports `unwrapStoredValue, createTokenStore, createRulesStore, createEnrollmentStore` and `server/tests/bypassLog.test.js:10` imports `createBypassLog`, both from `'../src/services/stores.js'`, and tests are locked. `server/src/index.js:44` keeps working through the barrel too. Move the module docblock (1-23) to the barrel and the per-factory docblocks with their factories — the round322 identity model and the apps-sdk 0.1.4 wrapping incident note (20-22) are load-bearing.
- risk: M
- confidence: high

### A-structure-11
- files: src/domain/columnFields.js:466-555, src/domain/columnFields.js:59-70
- issue: a 555-line domain module carries two concerns — the read/write/control registry and the write-payload sanitizer — with only a comment banner between them.
- evidence: `wc -l` = 555 (over the 400 limit). `/* ---- write-payload sanitizer */` at 466 separates `sanitizeArrayField` (468-475), `sanitizeColumnValue` (485-545, 61 lines) and `sanitizeColumnValues` (548-555) from the registry above; the sanitizer's only dependencies inside the file are the three scalar helpers `trimmedString`/`isBlankString`/`entryList` (59-70).
- action: create `src/domain/valueCoercions.js` with `trimmedString`, `isBlankString`, `entryList` (moved verbatim from 59-70) and import it in `columnFields.js`; then move 466-555 into a new `src/domain/columnValueSanitize.js` that imports the same three helpers. `columnFields.js` must re-export `sanitizeColumnValue` and `sanitizeColumnValues` (`export { sanitizeColumnValue, sanitizeColumnValues } from './columnValueSanitize.js';`) because `src/domain/columnFields.test.js:2-14` — locked — imports both from `'./columnFields.js'`, and `src/domain/columnValueFormats.js:9` imports `sanitizeColumnValues` from there. Keep every probe-verified comment with the code it explains (notably the `item_ids`/NaN note at 510-513). Importers to update: none, thanks to the re-export.
- risk: M
- confidence: high

### A-structure-12
- files: src/domain/statusLabelDraft.js:302-371
- issue: a 489-line domain module mixes label-draft row editing with `pruneSettingsForActiveLabels`, which is a settings-blob transform sharing no helper with the rest of the file.
- evidence: `wc -l` = 489 (over the 400 limit); `pruneSettingsForActiveLabels` is 70 lines (302-371) and its only imports are `migrateSettings` (from `settingsSchema.js`) and `RESERVED_EMPTY_LABEL_ID` (from `statusColors.js`) — neither used by the draft-row builders around it, and it calls none of them.
- action: move 302-371 verbatim into a new `src/domain/pruneSettings.js` (importing `migrateSettings` and `RESERVED_EMPTY_LABEL_ID` directly, so no cycle with `statusLabelDraft.js`), and re-export it from `statusLabelDraft.js` (`export { pruneSettingsForActiveLabels } from './pruneSettings.js';`). The re-export is mandatory: four locked tests import it from `'./statusLabelDraft.js'` — `statusLabelDraft.test.js:10`, `statusTransitions.test.js:29`, `statusTransitionsCanonical.test.js:23`, `statusTransitionsRefinement.test.js:29`. `ColumnSettings.jsx:23` keeps its current import through the re-export. Carry the round321 two-keep-sets comment (308-322) and the canonical-form comment (345-355) with the function. Importers to update: none.
- risk: M
- confidence: high

### A-structure-13
- files: src/components/ColumnSettings/BypassMonitor.jsx:170-219
- issue: a 43-line JSX-returning `renderEvent` function sits below the component and is called from `.map`, so an event row is a function call rather than a component — the one place in the app that renders a list this way.
- evidence: `renderEvent` 177-219 returns JSX and is invoked at 156-160 as `events.map((e, i) => renderEvent(e, i, {…}))` with the React `key` set inside the returned markup (185); `fmtWhen` 170-175 is its only helper. Every other list in the app maps to a component element (e.g. `labelsDraft.map(… <LabelCard key=… />)` in `ColumnSettings.jsx:1316-1344`).
- action: move `fmtWhen` + `renderEvent` into a new `src/components/ColumnSettings/BypassEventRow.jsx` as a component `BypassEventRow({ event, open, onToggle, labelsById, columnsById, usersById })` with the same markup, and change the call site to `events.map((e, i) => <BypassEventRow key={i} event={e} open={openIdx === i} onToggle={…} … />)` — keep `key={i}` (index) so list identity is unchanged. The `SURFACE` map (32-35) is used only by `renderEvent`, so it moves too. Rendered DOM must stay identical; no test currently mounts `BypassMonitor` directly. Importers to update: `BypassMonitor.jsx` only.
- risk: M
- confidence: high

### A-structure-14
- files: src/components/ColumnSettings/ColumnSettings.jsx:752-812, src/components/OnClickDialog/FieldControl.jsx:34-187, src/components/OnClickDialog/DateFieldControl.jsx:37-192, src/components/OnClickDialog/BoardRelationFieldControl.jsx:39-192, src/components/OnClickDialog/RequiredFieldsModal.jsx:32-208
- issue: five more units sit just over the 60-line function limit but under the 250-line component limit — worth listing so the executor does NOT chase them, and so the long tail is explicit rather than silently dropped.
- evidence: measured `addLabel` 61 (752-812), `FieldControl` 154 (a flat 10-branch dispatcher, 34-187), `DateFieldControl` 156, `BoardRelationFieldControl` 154, `RequiredFieldsModal` 177. All five are single-concern: one round-trip creation flow, one type→control switch, and three self-contained controls/surfaces.
- action: no change. Do not split these in this cleanup; they are recorded here as measured-and-accepted so a later pass does not re-litigate them. If any is touched for another reason, leave its size alone.
- risk: S
- confidence: high
