# Audit — patterns (twyst-your-status)

Scope: `apps/twyst-your-status/{src,server/src}` only. Read-only audit; every action below is
behaviour-preserving. Nothing here touches a test, a config file, or the error/observability
boot layer named in `.error-guard`.

## Dominant patterns established (counted, so deviations can be named)

| concern | dominant pattern | count |
|---|---|---|
| monday API funnel | `mondayService.query(OP, vars)`; `monday.api` appears in exactly ONE place | 13 call sites / 1 funnel |
| GraphQL op text | named `const` in `src/services/graphqlQueries.js` | 13 named ops vs 1 inline |
| fetch-on-mount | `useCallback(async load)` + `useEffect(() => { load(); }, [load])` + local `loading`/`error` | 6 of 9 |
| guard HTTP calls | `resolveGuardBase()` → sentinel-on-skip → `try { fetch } catch { log; return status }` | 4 of 4 |
| overlay/menu | `components/shared/Popover.jsx` (portal + `utils/overlayPlacement`) | 3 consumers vs 2 hand-rolled |
| SPA logging | `logger.<level>('Tag', 'message', errOrCtx)` | 60+ sites, no deviation found |
| server logging | `logger.<level>('message', TAG, {ctx})` | 20+ sites, no deviation found |
| column-settings write | `mondayService.setColumnConfig` | 1 writer |
| column-settings read | `useColumnSettings` (storage + `migrateSettings` + swrCache) | 3 of 4 SPA readers |

---

### A-patterns-01
- files: src/domain/statusPolicy.js:11-43, src/domain/buildAvailableLabels.js:22-42
- issue: `normalizeNonNegativeInteger` + `currentLabelIdFromValue` exist as two verbatim copies in two domain modules, and BOTH export `currentLabelIdFromValue`, so the load-bearing "monday `index` carries the label id" decoder has two divergence surfaces.
- evidence: byte-identical bodies (jscpd clones `buildAvailableLabels.js 22-32 ↔ statusPolicy.js 11-22` and `32-44 ↔ 33-45`); production reads the statusPolicy copy (`src/domain/statusWriteResult.js:28`), `buildAvailableLabels.js:103` reads its own.
- action: in `src/domain/buildAvailableLabels.js` delete lines 22-42 and add `export { currentLabelIdFromValue } from './statusPolicy.js';` plus a value import for internal use at line 103. Keep the re-export — `src/domain/buildAvailableLabels.test.js:4` imports the symbol from this module and must keep resolving. No cycle: `statusPolicy.js` imports nothing.
- risk: M
- confidence: high

### A-patterns-02
- files: src/services/guardEnroll.js:110-117, src/services/guardStatus.js:72-76, src/services/guardAuthorize.js:68-74, src/services/bypassMonitor.js:51-55, src/services/mondayService.js:73-76
- issue: `defaultSessionTokenProvider` is copied four times with identical bodies, while `mondayService.getSessionToken()` — a fifth implementation of the same call — has zero callers.
- evidence: all four are `const { default: mondaySdk } = await import('monday-sdk-js'); const response = await mondaySdk().get('sessionToken'); return response?.data;`; `grep getSessionToken` finds no call site for the mondayService method.
- action: add `src/services/guardSession.js` exporting one `defaultSessionTokenProvider()` with the **dynamic** `import('monday-sdk-js')` kept verbatim, and import it in the four guard services (deleting their local copies). Do NOT reroute to `mondayService.getSessionToken` — that would turn a dynamic import into a static one and break the documented "module stays inert for suites that stub the SDK" property (guardEnroll.js:111-113). Preserve the two explanatory comments by moving one copy into the new module. Importers to update in the same batch: those four files only.
- risk: M
- confidence: high

### A-patterns-03
- files: src/components/OnClickDialog/OnClickDialog.jsx:40,136-140, src/components/OnClickDialog/RequiredFieldsModal.jsx:51,81-89
- issue: OnClickDialog builds the same `columnsById` Map that RequiredFieldsModal owns, but never reads it — write-only state left over from before the fill form became its own iframe.
- evidence: `grep -n "columnsById" OnClickDialog.jsx` returns exactly two lines — the `useState` (40) and the `setColumnsById` (136); no render, handler or test references it (`grep columnsById` across `src/**/*.test.*` hits only requiredFieldsForm.test.jsx and columnValueFormats.test.js).
- action: delete the `columnsById` `useState` (line 40) and the `setColumnsById(new Map(...))` block (lines 136-140) from OnClickDialog.jsx. Leave RequiredFieldsModal as the single builder. No other file changes.
- risk: M
- confidence: high

### A-patterns-04
- files: src/services/mondayService.js:46-49, server/src/services/stores.js:167
- issue: the storage-key contract `twystStatus:<boardId>:<columnId>` — the one string that makes the SPA's write and the guard's read the same record — is written twice, once per workspace, with no shared source.
- evidence: `columnConfigKey()` returns `` `twystStatus:${boardId}:${columnId}` `` in mondayService.js; `createRulesStore.getRules` re-derives `` const key = `twystStatus:${boardId}:${columnId}` `` in stores.js.
- action: add a pure module `src/domain/columnConfigKey.js` exporting `columnConfigStorageKey(boardId, columnId)` with the existing comment ("Column-view dialogs have no instanceId — use GLOBAL storage keyed by board+column"), then import it in exactly those two files. Precedent for the import direction already exists: server imports `../../../src/domain/{columnFields,statusPolicy,columnOwners,settingsSchema,bypassReason}.js`. Do NOT let the server import anything under `src/services/` (that would pull `monday-sdk-js` into the server bundle).
- risk: M
- confidence: medium

### A-patterns-05
- files: src/components/shared/PersonPicker.jsx:42, src/services/graphqlQueries.js
- issue: one GraphQL operation is written inline in a component while the other 13 live as named constants in the op registry.
- evidence: `mondayService.query('query AccountUsers($limit: Int) { users(limit: $limit) { id name photo_thumb } }', { limit: 500 })` — the only inline op text in the SPA; graphqlQueries.js exports 13 named ops.
- action: move the string to `src/services/graphqlQueries.js` as `export const GET_ACCOUNT_USERS = ...` (carry PersonPicker's `photo_thumb` / API-2026-04 comment from lines 34-35 with it) and import it in PersonPicker.jsx. Eager-graph safe: graphqlQueries.js imports only `src/domain/columnFields.js` and is already reachable from `src/index.jsx` via App → OnClickDialog; PersonPicker stays lazy-only.
- risk: M
- confidence: high

### A-patterns-06
- files: src/hooks/useQuery.js:1-70
- issue: the app ships a generic `useQuery`/`useMutation` fetching abstraction that nothing uses; the real pattern is 15 hand-rolled fetch/mutate sites, and this file is also the only place that stores `error` as a string message instead of the Error.
- evidence: `grep -rn "useQuery\|useMutation" src` outside the file itself returns **zero** hits; knip lists `src/hooks/useQuery.js` under unused `files`.
- action: delete `src/hooks/useQuery.js`. Do NOT migrate any existing fetcher onto it — the hand-rolled callers carry surface-specific stale-run and overlay-handoff logic (`runIdRef`, `loadedKey`/`fetchKey`) this hook cannot express. No importers to update.
- risk: M
- confidence: high

### A-patterns-07
- files: src/components/ColumnSettings/ColumnSettings.jsx:656-661, src/components/ColumnSettings/ColumnSettings.jsx:698-703, src/domain/settingsSchema.js:61-68
- issue: the empty-label-rule literal is inlined twice in ColumnSettings while `emptyLabelRule()` is exported from the schema module for exactly this.
- evidence: both inline objects are `{ allowedUserIds: [], allowedTeamIds: [], requiredColumnIds: [], requiredPeopleColumnIds: [] }` — key-for-key what `emptyLabelRule()` returns (a fresh object per call, same as the literals).
- action: add `emptyLabelRule` to the existing `../../domain/settingsSchema` import in ColumnSettings.jsx and replace both literals with `emptyLabelRule()`. Do NOT replace `getRule` with `getLabelRule` — `getRule` reads the unnormalized DRAFT on purpose, and `getLabelRule` would run `migrateSettings` over it.
- risk: M
- confidence: high

### A-patterns-08
- files: src/components/ColumnSettings/ColumnSettings.jsx:97-131, src/components/ColumnSettings/StatusColorPicker.jsx:40-74, src/components/shared/Popover.jsx:43-99, src/utils/overlayPlacement.js
- issue: two components hand-roll the overlay concern the app already centralised — same click-outside/Escape effect and the same horizontal-clamp expression — while three field controls use the shared `Popover`.
- evidence: the dismiss effect in `SelectDropdown` (ColumnSettings.jsx:97-114) and in StatusColorPicker (40-57) is identical down to `document.addEventListener('keydown', onEsc, true)`; both `openMenu`/`openPicker` compute `Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))`. Shared-`Popover` consumers: BoardRelationFieldControl.jsx:25, OptionFieldControls.jsx:13, DateFieldControl.jsx:14.
- action: extract only the two verbatim pieces — (a) a `useDismissOnOutside(open, [refs], onClose)` hook in `src/hooks/` holding the mousedown + capture-phase keydown effect, (b) a `clampOverlayLeft(anchorLeft, popupWidth, viewportWidth)` export in `src/utils/overlayPlacement.js` — and call them from both components. Do NOT migrate either component onto `Popover` (its flip/clamp math would move the menu, i.e. a visible behaviour change) and do NOT touch `PersonPicker.jsx`, whose header comment forbids rebuilding it.
- risk: L
- confidence: medium

### A-patterns-09
- files: src/components/ColumnSettings/ColumnSettings.jsx:857-858, src/components/ColumnSettings/ColumnSettings.jsx:1107-1108
- issue: the "does the LIVE column still have an active id-5 label" test is computed twice in one component under two names, each re-parsing `statusColumn.settings`.
- evidence: `normalizeStatusLabels(statusColumn.settings).some((live) => !live.isDeactivated && String(live.id) === String(RESERVED_EMPTY_LABEL_ID))` appears verbatim as `defaultIsReal` (in `handleSave`) and as `liveHasDefaultLabel` (in render).
- action: hoist one `useMemo` (`liveHasDefaultLabel`, dependency `[statusColumn]`) next to the `statusColumn` memo at line 622 and use it in both places. It must sit ABOVE the early returns so `handleSave` can close over it; that is safe because `normalizeStatusLabels(undefined)` returns `[]` (statusPolicy.js:87) and `handleSave` is unreachable while `statusColumn` is null. Keep the round321 comment block at 1099-1106 attached to the memo.
- risk: M
- confidence: medium

### A-patterns-10
- files: src/components/shared/PersonPicker.jsx:144-166, src/components/shared/PersonPicker.jsx:209-221
- issue: PersonPicker calls `computeFloatingPosition` from two places with identical arguments instead of one reposition callback — the shape `Popover.jsx` (generalized from this very file) already uses.
- evidence: both blocks pass `{ anchorRect: rect, preferred: 'bottom-start', popupWidth: Math.max(rect.width, 300), popupHeight: 430, offset: 4 }` and set `minWidth: Math.max(rect.width, 280)`; jscpd also pairs PersonPicker.jsx 159-166 with Popover.jsx 74-81.
- action: extract a single `reposition` `useCallback` inside PersonPicker (same body, same args) and call it from the scroll/resize effect and from `toggleOpen`. Nothing else moves — this keeps the ported markup and behaviour intact, so the "do NOT rebuild this from scratch" constraint in the file header is respected. Flag to the human reviewer that this file is a deliberate port of `apps/discussions`' picker; if keeping the two files textually in sync matters more than the duplication, skip this entry.
- risk: M
- confidence: medium

### A-patterns-11
- files: src/App.jsx:56-59, src/components/OnClickDialog/OnClickDialog.jsx:292-295, src/components/OnClickDialog/RequiredFieldsModal.jsx:174-177
- issue: the boot-overlay handoff is the same three-line effect in three surfaces, each with its own `held`/`stillLoading` predicate name.
- evidence: all three are `const <flag> = …; useEffect(() => { if (!<flag>) dismissBootLoader(); }, [<flag>]);` against the same `utils/bootLoader` import.
- action: add `src/hooks/useBootLoaderRelease.js` exporting `useBootLoaderRelease(held)` containing exactly that effect, and call it from the three surfaces with their existing predicates unchanged. Move (do not delete) the three WHY comments about who owns the overlay into the call sites they belong to — they name the incident ("a dismissal that never fires means a dialog stuck behind a spinner") and must survive. `bootLoader.js` itself is not touched, and the new hook imports nothing beyond React + bootLoader, so the `src/index.jsx` eager graph gains no `@vibe/core` reachability.
- risk: M
- confidence: medium

### A-patterns-12
- files: src/components/ColumnSettings/ColumnSettings.jsx:1084, src/components/OnClickDialog/OnClickDialog.jsx:298, src/components/OnClickDialog/RequiredFieldsModal.jsx:185
- issue: the settings-load failure surface is the same literal in three files, so the copy can drift per surface.
- evidence: all three render `<ErrorState message="טעינת ההגדרות נכשלה. נסו שוב." onRetry={reloadSettings} />` — identical string and identical prop.
- action: export `SETTINGS_LOAD_ERROR_MESSAGE` from `src/components/shared/ErrorState.jsx` and reference it from the three call sites. House precedent for a user-facing message constant exported from a component module: `SettingsLauncher.jsx:20,26` (`NON_OWNER_MESSAGE`, `GATE_ERROR_MESSAGE`).
- risk: S
- confidence: high

### A-patterns-13
- files: src/components/ColumnSettings/ColumnSettings.jsx:677-691
- issue: three id→name maps are built by three near-identical `useMemo` blocks.
- evidence: `labelsById`, `columnsById`, `usersById` are each `const map = {}; (list ?? []).forEach((x) => { map[String(x.<id>)] = x.<name>; }); return map;` — 15 lines for one operation applied three times.
- action: add a module-level helper in the same file, `const byIdMap = (list, valueOf) => Object.fromEntries((list ?? []).map((x) => [String(x.id), valueOf(x)]));`, and reduce the three memos to one line each with unchanged dependency arrays. Keep the round323 comment on the first one. (Object key order is unchanged — insertion order either way — and every consumer reads by key.)
- risk: M
- confidence: high

### A-patterns-14
- files: server/src/routes/guard-routes.js:119-123, server/src/routes/guard-routes.js:161-165
- issue: two of the three session-authed routes repeat the same reader-token-or-409 prelude verbatim.
- evidence: jscpd pairs `guard-routes.js 114-124 ↔ 156-166`; both routes run `const reader = await tokenStore.getReaderToken(session.accountId); if (!reader) { res.status(409).json({ error: 'not_activated' }); return; }`.
- action: add a local helper next to `requireSession` (line 94), e.g. `const requireReader = async (accountId, res) => { const reader = await tokenStore.getReaderToken(accountId); if (!reader) res.status(409).json({ error: 'not_activated' }); return reader; }`, and use it in `/api/guard/enroll` and `/api/guard/bypasses` only. Leave `/api/guard/status` alone — it deliberately answers 200 with an all-false body instead of 409 (see its comment at line 191), and the parameter-validation step must stay BEFORE the reader lookup in both edited routes to keep the documented 400-before-409 verdict order.
- risk: M
- confidence: high

### A-patterns-15
- files: src/services/mondayService.js:135-151, src/services/mondayService.js:5,8-12
- issue: the monday-storage facade carries a second, unused key-value API (`getAppStorage`/`setAppStorage`) that implements a *different* false-empty retry policy from the one the live path uses, so the module documents two competing answers to the same platform quirk.
- evidence: no call site for either method (`grep getAppStorage\|setAppStorage src server/src` → definitions only); the retry they hold (`STORAGE_RETRY_DELAY_MS = 350` + `wait`) is the same retry that useColumnSettings.js:12-17 records as having been REMOVED from `getColumnConfig` because it cost "4 reads and 1050ms".
- action: delete `getAppStorage`, `setAppStorage`, the `wait` helper and the `STORAGE_RETRY_DELAY_MS` constant from mondayService.js. Keep `getColumnConfig`/`setColumnConfig` and every comment on them — the comment at lines 116-120 is the incident record for the single-retry decision and must not be touched. No importers change (`mondayService` is a default-exported object literal). Coordinate with A-patterns-02: `getSessionToken` (lines 73-76) is the third unused method on the same object.
- risk: M
- confidence: high

---

## Observed, deliberately NOT proposed (cannot be applied with zero behaviour change)

Recorded so a later reviewer does not re-discover them; none of these is a cleanup batch item.

- **`openAppFeatureModal` is awaited in one call site and deliberately not in the other.**
  `OnClickDialog.jsx:220-233` documents that the promise resolves only when the modal
  CLOSES, and fires it unawaited for that reason; `SettingsLauncher.jsx:81-91` awaits it, so
  its button stays on "פותח…" for as long as the settings overlay is open. Aligning changes
  visible button state — a product decision, not cleanup.
- **`ColumnSettings.dismiss` wraps both close calls in one `try`** (lines 814-825), so a
  rejected `closeAppFeatureModal` skips `closeDialog`; `RequiredFieldsModal.close` (113-124)
  splits them into two `try` blocks and explains why the order matters. Aligning changes what
  runs after a failure.
- **`BypassMonitor` keeps fetch state in one `{ status, events }` object** while the other six
  fetchers use separate `loading`/`error`/`data`. A rewrite, not a cleanup.
- **Stale-run guards use three idioms** — `runIdRef` counter (OnClickDialog), `cancelled` flag
  (SettingsLauncher), `alive` flag (PersonPicker) — and three fetchers have none
  (useColumnSettings, ColumnSettings.loadMetadata, RequiredFieldsModal.load). Adding a guard
  where there is none is a behaviour change.
- **`API_VERSION = '2026-04'` is pinned twice** (src/services/mondayService.js:6 and
  server/src/services/monday-api.js:20, the latter pinned by a server test). Sharing it would
  add a new server → `src/services` import direction for one string; not worth the gate risk.
- **`statusPolicy.js` still carries a whole second settings schema** —
  `STATUS_GUARD_CONFIG_VERSION`, `makeStatusGuardStorageKey` (a `status-guard:v1:…` key that no
  longer exists in storage), `normalizeStatusGuardConfig`, and the `@deprecated`
  `buildStatusPickerModel` — whose only remaining callers are `statusPolicy.test.js`. Removing
  it would require editing a locked test, so it is out of scope.
