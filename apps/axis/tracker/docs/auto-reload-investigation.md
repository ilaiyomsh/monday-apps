# Auto-Reload Investigation — change #103 (OPEN)

> **Status as of 2026-06-22: UNRESOLVED — awaiting an active-reproduction console paste.**
> A fix + a **temporary diagnostic** are live in production. The diagnostic **must be removed** before closing (see [Cleanup](#cleanup-must-do-before-closing)).
> Picked up automatically via a pointer in `CLAUDE.md`.

---

## 1. Symptom (as reported)
Users open the Tracker calendar; it renders fully, then the page **reloads itself with no user action — sometimes 2–3× in a row**. During each reload the board goes **blank white → spinner (`StopwatchLoader`) → content**. Reproduces on every entry and on returning to the board. Source: screen-recording bug report + `BUG_REPORT.md` (2026-06-21).

## 2. What was ruled out (by user testing)
- **Account data** — did NOT reproduce when the dev logged in as the affected user on the dev's own machine → not data-specific.
- **Browser extension** — still reproduces in **Incognito** (extensions off). (Her console showed an Atlassian "companionBubble" extension being CSP-blocked — that is **noise**, not our chunks, which are same-origin.)
- **Stale browser cache / bad deploy** — still reproduces in Incognito (empty cache).
- Leaves an **environment/network/region** factor (e.g., a CDN edge intermittently failing the lazy-chunk fetch). "Happens a lot, not 100%."

## 3. Diagnosis (mechanism — proven at unit level)
The app renders **before** the reload, so the reload is **post-render**. The **only** post-render automatic `window.location.reload()` in our code is the **chunk-load path** in `src/utils/lazyRetry.js`:
- `MondayCalendar.preloadLazyModals()` background-prefetched **5 lazy modal chunks** through `lazyRetry`-wrapped importers (after `eventsLoading` → false, via `requestIdleCallback`).
- A transient chunk-load failure made `lazyRetry` call `window.location.reload()` — **even for an unrequested background prefetch**.
- The per-module guards (`lazy-retry:<module>`) + the global guard (`lazy-retry:global`) are **separate and don't collectively cap reloads**, so several concurrent prefetch failures could **chain into 2–3 reloads**. Guards clear on success → recurs every entry.

(The `SettingsContext` silent reload on storage timeout is a **separate** path, but it fires **pre-render** during `isLoading`, so it does not match "renders then reloads". It is still **not yet hardened** — see proposed solution.)

Reproduced by `src/utils/__tests__/lazyRetry.test.js` (the pre-fix mechanism is captured by the on-demand + cap tests).

## 4. Fix that was deployed (the real change)
1. **`prefetchLazy()`** in `src/utils/lazyRetry.js` — a silent best-effort prefetch that **never reloads** (swallows failures at `debug`, always resolves, no unhandled rejection). `MondayCalendar.preloadLazyModals()` now uses it via raw `import()` thunks. `React.lazy` still wraps the same thunks with `lazyRetry` for **on-demand** loads; a genuine on-demand failure surfaces via the `ErrorBoundary` chunk screen (manual refresh).
2. **Global per-session reload cap** `MAX_AUTO_RELOADS = 1` in `lazyRetry.js` — gates both `lazyRetry` and `handleGlobalChunkError` so chunk reloads can no longer chain to 2–3.

Tests: `src/utils/__tests__/lazyRetry.test.js` (14, green). Full suite green **except 2 pre-existing, unrelated failures** in `src/__tests__/integration/networkErrorOnCreate.test.jsx` (confirmed failing on baseline without these changes — a separate possible regression in create-error toast surfacing; worth its own change).

## 5. Temporary diagnostic that is ALSO live (must be removed)
`src/utils/reloadDiag.js` — logs `[RELOAD-DIAG]` **directly to `console`** (bypasses `logger`, so it shows in production without `enableDebugLogs()` and raises no toast). Survives reloads via `sessionStorage` (key `reload-diag`). Each boot prints the full JSON history so the user can just "copy the whole console". Captures the session token? **No** — the `path` field is `origin+pathname` only (token stripped), plus an `inIframe` flag.

Wired at:
- `src/index.jsx` — `bootDiag()` (first statement, before `setupGlobalErrorHandlers()`).
- `src/utils/lazyRetry.js` — `recordReload('lazyRetry', …)` and `recordReload('lazyRetry-global', …)` before each reload.
- `src/contexts/SettingsContext.jsx` — `recordReload('settings-silent', …)` before its reload.

### How to read `[RELOAD-DIAG]`
The console dump is a JSON array of `{kind, …}` entries:
- `kind:"BOOT", n:N` — one per app load.
- `kind:"RELOAD", path, reason, detail` — our code called `window.location.reload()`.

**Discriminator:**
- **`BOOT` entries seconds apart WITH a `RELOAD` between them** → our code reloaded (path tells which: `lazyRetry` / `lazyRetry-global` / `settings-silent`).
- **`BOOT` entries seconds apart WITHOUT any `RELOAD`** → the reload came from **outside our code** (monday platform re-mounting the iframe — her console also showed `vulcan client was loaded before it was initialized`). Our fix is then NOT the right lever.
- **No rapid `BOOT`s** → no reload occurred (couldn't reproduce / fix working).

## 6. Findings so far (2026-06-22) — leaning "not our code"
Three captured loads since the fix deployed: **all single clean boots, ZERO `RELOAD` entries.**
- User `48274917`: `BOOT #1` only.
- User `37022703`: `BOOT #1` (11:58Z) + `BOOT #2` (12:42Z) — **44 minutes apart, no `RELOAD`** → normal re-entry, not the rapid double-load.

We have **not yet captured an active reproduction** of the rapid double-load. The absence of any `RELOAD` entry across captures **points away from our code** and toward a monday-platform iframe re-mount — but it is **not yet confirmed** (no rapid-double-load event captured).

## 7. Next step (to conclude)
Have the affected user (ideally `37022703`):
1. Hard-reload once (`Ctrl+Shift+R`) to get the latest build (also clears history).
2. Open console, enable `Preserve log`.
3. **Actively reproduce** the rapid double-load (enter/leave/return repeatedly until the blank→reload happens within seconds).
4. Paste the `[RELOAD-DIAG] [...]` line.

Then apply the discriminator in §5.

## 8. Proposed solution (by branch)
- **If `RELOAD` entries appear (our code):** keep the §4 fix; additionally, if `path:"settings-silent"` fires, **harden `SettingsContext`** — replace the full-page `window.location.reload()` on storage timeout with an **in-place retry** of `monday.storage.getItem` (1–2 attempts, keep the spinner), falling back to the existing `NetworkErrorScreen` (manual retry). No auto-reload at all. (This was "Option A" in the original discussion.)
- **If no `RELOAD` but rapid `BOOT`s (monday platform):** our code is not reloading. Options: (a) open a monday developer-support ticket with the `vulcan client was loaded before it was initialized` evidence; (b) investigate whether something in our app's early boot (SDK `listen`/`get('context')` ordering, or an unsettled promise) triggers monday to re-mount the iframe; (c) accept the §4 hardening as defensive and pursue the platform angle separately.
- **Regardless:** the §4 prefetch fix + reload cap are correct hardening and should stay.

## Cleanup (MUST do before closing)
1. **Remove the temporary diagnostic:**
   - Delete `src/utils/reloadDiag.js`.
   - Remove its import + `bootDiag()` call in `src/index.jsx`.
   - Remove the 2 `recordReload(...)` calls + import in `src/utils/lazyRetry.js`.
   - Remove the `recordReload(...)` call + import in `src/contexts/SettingsContext.jsx`.
   - (Grep `RELOAD-DIAG` / `reloadDiag` / `recordReload` to confirm none remain.)
2. Rebuild + redeploy (`pnpm run deploy:build` then `mapps code:push -f -c -a 10684862 -d build`).
3. Run `pnpm run test:run` (expect the same 2 pre-existing `networkErrorOnCreate` failures, nothing new).
4. `/close_change` for **#103** (actual time + narrative + CHANGELOG).

## References
- change-tracker: **#103** (open).
- App: `10684862` · deployed version: `14244869` · liveUrl: `https://v9f8ad9bb5ea6b4bc.cdn2.monday.app` (stable across deploys).
- Files: `src/utils/lazyRetry.js`, `src/MondayCalendar.jsx`, `src/contexts/SettingsContext.jsx`, `src/index.jsx`, `src/utils/reloadDiag.js` (temp), `src/utils/__tests__/lazyRetry.test.js`.
- Memory: `auto-reload-bug-103` (in the Claude memory dir).
