# Audit — comments (apps/twyst-your-status)

Scope read: 132 source files under `src/` + `server/src/` (21,153 lines), all `.css` in `src/`,
plus `.cleanup/raw/{todos,commented-code}.txt`, `jscpd/jscpd-report.json`, `eslint-{spa,srv}.json`.

Headline: this app's comments are unusually high-quality. There is **no commented-out code**
(JS or CSS), **no TODO/FIXME/XXX/HACK anywhere**, and ESLint is fully clean (0 messages in both
reports). Almost every comment is a WHY-comment carrying incident history, a monday platform
quirk, a round number, or a probe-verified fact — protected by the brief and left alone.

What is left is a narrow, verifiable band: **comments that make a factual claim the code no
longer supports** (stale pixel numbers, stale `@param` lists, a contradicted privacy claim, a
deleted cross-reference path, an incomplete schema header). Those are the findings below. All
are comment-text-only edits: zero behaviour change, no test touched, no protected path touched.

Protected paths excluded from every finding: `src/utils/{logger,globalErrorHandler,axiomLoggerAdapter}.js`,
`src/hooks/useUiErrorSink.js`, `src/components/ErrorBoundary/**`,
`server/src/helpers/{logger,process-guards,axiomServerSink}.js`, all tests, all config.

---

### A-comments-01
- files: src/components/OnClickDialog/OptionFieldControls.jsx:19-20
- issue: The comment justifying `OPTION_POPOVER_HEIGHT_PX` quotes two modal heights that the sizing module no longer produces, so the geometry argument it makes is anchored to wrong numbers.
- evidence: Comment reads "requiredFormModalSize.js — 184px for one field, 548px at the 8-field cap". Executed the real module (`node --input-type=module` importing `src/utils/requiredFormModalSize.js`): 1 field → `{"width":"658px","height":"276px"}`, 8 fields → `{"width":"658px","height":"588px"}`. The 184/548 pair predates `FORM_HEADER_TOP_PX` (16) and `MODAL_CHROME_PX` (24) plus the row-height change.
- action: In `src/components/OnClickDialog/OptionFieldControls.jsx`, replace `184px for one` with `276px for one` and `548px at the 8-field cap` with `588px at the 8-field cap`. Change nothing else in the block — the "220 leaves room … from two fields up" conclusion still holds against 276px and must stay.
- risk: S
- confidence: high

### A-comments-02
- files: server/src/services/monday-oauth-client.js:12-14 (claim), :30-32 (documented divergence), :48, :152, :191 (the calls)
- issue: The module header states as an absolute that the module never logs, while the module deliberately emits three machine-code `logger.debug` lines — so acting on the header would delete error-guard-mandated logging.
- evidence: Line 12: "PRIVACY: this module NEVER logs — token material must not reach any logger." Lines 30-32 then say "DELIBERATE DIVERGENCE from the template (monday-oauth §5): the optional `logger` param exists so the parse catch is non-silent (error-guard house rule…)". `grep -n "logger.debug"` returns lines 48, 152, 191, all guarded by `if (logger)` and all passing machine codes only (`oauth_jwt_exp_undecodable`, `oauth_refresh_error_body_unparseable`, `oauth_revoke_network_error`).
- action: In the header comment only, narrow line 12 from "this module NEVER logs" to "this module never logs TOKEN MATERIAL — machine codes only, through the optional injected `logger` (see the DELIBERATE DIVERGENCE note on `decodeJwtExpMs`)". Keep lines 13-14 verbatim. Do not touch lines 30-32 and do not touch any `logger.debug` call.
- risk: S
- confidence: high

### A-comments-03
- files: server/src/app.js:26-31
- issue: `createApp`'s `@param` block omits three deps its routers require and lists one dep nothing in the file consumes, so the only contract doc for the server's DI seam is wrong in both directions.
- evidence: Doc lists `handleEvent, tokenStore, enrollmentStore, api, env, logger, fetchImpl?, publicDir?`. `server/src/routes/guard-routes.js:32` destructures `{ handleEvent, tokenStore, enrollmentStore, rulesStore, bypassLog, api, env, logger }` and `server/src/routes/oauth.js:41` destructures `{ tokenStore, api, oauthClient, env, logger, now }`; `server/src/index.js:95` passes `rulesStore, bypassLog, oauthClient`. `grep -rn fetchImpl server/src` shows it only on `createMondayApi` (monday-api.js:82) and `createMondayOauthClient` (monday-oauth-client.js:72) — never in `app.js` or either router.
- action: In `server/src/app.js` add `rulesStore: object, bypassLog: object, oauthClient: object,` to the `@param` type literal and delete `fetchImpl?: typeof fetch,` from it. Comment text only — do not change the signature or the `deps` pass-through.
- risk: S
- confidence: high

### A-comments-04
- files: server/src/guard/handleStatusChangeEvent.js:56-61
- issue: The `@param` block for `createStatusChangeHandler` omits a dep the handler cannot work without, so the doc understates the factory's contract.
- evidence: Doc (lines 57-60) lists `api, tokenStore, rulesStore, logger, evaluate?`. The signature at line 62 is `({ api, tokenStore, rulesStore, bypassLog, logger, evaluate, now = () => Date.now() })`, and `bypassLog.append(...)` is called unconditionally at line 240 on every non-allowed verdict.
- action: In the `@param` type literal add `bypassLog: object,` and `now?: () => number,`. Comment text only.
- risk: S
- confidence: high

### A-comments-05
- files: server/src/services/stores.js:192
- issue: `createBypassLog`'s `@param` omits `logger`, which is load-bearing for the two error-guard log calls inside it.
- evidence: Doc line 192: `@param {{ secureStorage: {...}, maxEvents?: number }} deps`. Signature line 194: `createBypassLog({ secureStorage, maxEvents = 1000, logger })`. `logger?.error?.(...)` at lines 209 ("corrupted bypass log — treated as empty") and 233 ("bypass log append failed"). Sibling factories in the same file already document it (`createTokenStore` line 59, `createRulesStore` line 162).
- action: In `server/src/services/stores.js:192` add `logger?: object` to the `@param` type literal, matching the wording used at line 162. Comment text only.
- risk: S
- confidence: high

### A-comments-06
- files: src/domain/settingsSchema.js:4-16
- issue: The "v1 shape" header is the app's single written settings contract and it is missing all three keys added since it was written, so a reader of the contract cannot know `nextLabelIds`, `owners` or `autoRevert` exist.
- evidence: Header documents `version`, `hiddenLabelIds`, `labels[id]{allowedUserIds, allowedTeamIds, requiredColumnIds, requiredPeopleColumnIds}`. The same file emits `nextLabelIds` (lines 87-89, round321), `owners` (line 151, round322) and `autoRevert` (line 154, round323), each present only conditionally.
- action: Extend the header's shape block with the three optional keys, each carrying its existing conditional rule copied from the inline comments: `nextLabelIds?: string[]` — "present ONLY as an array; key-absence is the unrestricted default (round321, see normalizeLabelRule)"; `owners?: {...}` — "carried only when a valid record is present (round322)"; `autoRevert?: true` — "carried only when strictly true (round323)". Do not edit the inline comments at 79-86, 142-144 or 152-153.
- risk: S
- confidence: high

### A-comments-07
- files: src/services/guardStatus.js:1-31 (fn at :41), src/services/guardAuthorize.js:1-32 (fn at :37), src/services/guardEnroll.js:1-42 (fn at :50)
- issue: All three guard clients put the function's `@param`/`@returns` tags inside the module-header block, separated from the function by a blank line and the imports, so the tags document nothing; in `guardStatus.js` two prose paragraphs are additionally interleaved between `@param` and `@returns`.
- evidence: `guardStatus.js` line 14 opens `@param {{ … }} [deps]`, lines 19-28 are round327 prose, line 30 is `@returns`, line 31 closes the block, line 33 is `import logger…`, and `export async function getGuardStatus` is line 41. Same layout in `guardAuthorize.js` (`@param` :26, `@returns` :31, block ends :32, imports :34-35, fn :37) and `guardEnroll.js` (`@param` :34, `@returns` :41, block ends :42, imports :44-45, fn :50).
- action: Per file, split the one block in two without rewording any sentence: keep the prose (module purpose, statuses table, round-numbered notes) as the file-top block, and move only the `@param` and `@returns` lines into a new `/** … */` placed immediately above the exported function. In `guardStatus.js` the round327 prose at :19-28 stays with the file-top block, not between the tags.
- risk: S
- confidence: high

### A-comments-08
- files: src/domain/statusPolicy.js:121-124
- issue: The `@deprecated` note claims the function is kept for "legacy … callers/tests", but no non-test caller exists anywhere in the app, so the note overstates what would break.
- evidence: `grep -rn buildStatusPickerModel src server/src` returns exactly the definition (`src/domain/statusPolicy.js:125`) and eight references inside `src/domain/statusPolicy.test.js` — no production import in either workspace.
- action: In `src/domain/statusPolicy.js:123` change "Kept for legacy restricted-label-only callers/tests." to "No production callers remain; kept only for the restricted-label-only cases pinned in statusPolicy.test.js." Comment text only — do not remove the export (its test is locked, so removal is out of scope for this area).
- risk: S
- confidence: high

### A-comments-09
- files: src/components/shared/StatusChip.jsx:1
- issue: The `SOURCE:` provenance line points at a file that has been deleted from the repo, so the pointer is dead.
- evidence: Comment: "SOURCE: ported from apps/discussions/src/components/StatusBadge/StatusBadge.jsx." That path does not exist; `apps/discussions/src/components/` has no `StatusBadge` directory, `grep -rl StatusBadge apps/discussions/src` returns nothing, and `git log --diff-filter=D` shows it removed in the discussions round337 cleanup (c1c5a9f / 9578d2e).
- action: Rewrite line 1 as "SOURCE: ported from the discussions app's StatusBadge component (since removed there)." Keep lines 2-5 verbatim — they carry the real contract (fixed-width pill, caller resolves label id → label + colour). NOTE: knip lists `src/components/shared/StatusChip.jsx` as an unused file; if a dependencies/structure batch deletes the file, skip this finding rather than applying both.
- risk: S
- confidence: high

### A-comments-10
- files: .cleanup/raw/commented-code.txt (all 11 candidates), .cleanup/raw/todos.txt (empty)
- issue: Both raw scanner inputs for this area yield zero actionable items, and the commented-code list is 11/11 false positives that a mechanical executor could delete as "dead code".
- evidence: Read every candidate. `server/src/app.js:55-57` = the terminal error-middleware contract note; `server/src/helpers/process-guards.js:8-10` = the vendored-template + exit-policy note (protected path); `server/src/services/monday-api.js:201-203` = the `change_status_column_value` `columnValue` requirement, "verified live 2026-08-05"; `server/src/services/monday-oauth-client.js:2-4` and `:8-10` = the OAuth 2.1 / vendoring notes; `src/index.jsx:43-45` = the `setAxiomContext` wiring note; `src/utils/globalErrorHandler.js:98-100`, `src/utils/logger.js:67-69`, `:142-144`, `:350-352`, `:661-665` = prose and `=====` section banners in protected files. Independently confirmed with a code-shaped-comment regex across `src` + `server/src` and across all 8 `.css` files: zero commented-out statements or rules. `wc -l todos.txt` = 0, and a direct grep for `TODO|FIXME|XXX|HACK|@deprecated|WIP` finds one `@deprecated` (covered by A-comments-08) and no work markers at all.
- action: Record all 11 commented-code candidates as REJECTED (WHY-knowledge, five of them in guard-blocked paths) and record the TODO sweep as empty. Delete nothing from either list.
- risk: S
- confidence: high

### A-comments-11
- files: src/components/shared/PersonPicker.jsx:123, src/components/shared/Popover.jsx:83, src/hooks/useMondayContext.js:57, server/src/services/stores.js:225
- issue: These are the only comments in the app that purely restate what the next statement does, adding no rule, quirk or history.
- evidence: `// Close on click-outside / Escape.` appears identically above the `mousedown`/`keydown` effect in both PersonPicker.jsx:123 and Popover.jsx:83 (the only duplicated non-banner comment line in the app, per a full duplicate-comment scan); `// Listen for context changes (theme switches, language changes).` sits above `monday.listen('context', …)`; `// Keep the newest maxEvents; drop the oldest overflow.` sits above `list.length > maxEvents ? list.slice(list.length - maxEvents) : list`. Every other one-liner examined restated a platform fact or a fail-closed rule and was left alone.
- action: Delete these four comment lines and nothing else. Lowest priority in this area — each currently acts as a label on an otherwise anonymous effect/branch, so a reviewer may reasonably reject the whole finding; do not extend it to any other comment.
- risk: S
- confidence: medium
