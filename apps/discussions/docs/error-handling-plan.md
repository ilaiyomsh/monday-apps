# Error-Handling & Monitoring — Implementation Plan (discussions app)

> Goal: port the tracker app's production-grade, multi-layer error-handling +
> monitoring system into the discussions app, adapted to our stack
> (Vite + Tailwind v4 + our own `vibe-runtime` UI primitives + `monday-sdk-js`).
>
> Reference implementation: `/Users/ilaish/monday_app/apps/Axis/tracker`
> (`src/utils/logger.js`, `errorHandler.js`, `globalErrorHandler.js`,
> `lazyRetry.js`, `hooks/useUiErrorSink.js`, `hooks/useToast.js`,
> `components/{ErrorBoundary,Toast,ErrorToast,ErrorDetailsModal,NetworkErrorScreen}`,
> and `error-handling-bundle/docs/*`).
>
> **Status: IMPLEMENTED (Phase 3 of the tracker-architecture migration, 2026-06-03).**
> The core stack is live: `utils/{logger,errorHandler,globalErrorHandler,lazyRetry}.js`,
> `utils/mondayApi/{client,assertGraphQL}.js` (safeApi + MondayApiError), `hooks/{useToast,
> useUiErrorSink}.js`, and `components/{ErrorBoundary,Toast,ErrorDetailsModal,NetworkErrorScreen}`
> (rebuilt in `@vibe/core`, not Tailwind). Wired in `index.jsx` + `App.jsx`. The SDK boundary
> (`monday-client.api` → `safeApi`) is instrumented. Remaining/optional: a remote transport
> (Axiom sink / `logger.flush`) and code-split `lazyRetry` once the tabs are lazily loaded.

---

## 1. The model we're adopting (the "7 layers")

Every failure is routed through **one funnel** (`logger.emit`) and surfaced
through **one path** (the UI sink → toast). No silent `console.error`.

| Layer | Catches | Mechanism in discussions |
|------|---------|--------------------------|
| 1. React render crashes | bad render, null refs | `ErrorBoundary` at root + around the two panes |
| 2. monday API errors | GraphQL 401/429/5xx, column errors | instrument the **SDK boundary** (`monday-client.api` + `BoardSDK` execute) |
| 3. Network / storage | offline, timeouts, `monday.storage` fail | `NetworkErrorScreen`, timeout already in `SettingsContext` |
| 4. Race conditions | setState after unmount, stale async | `cancelled` guards (already present in hooks) + logging |
| 5. Unhandled errors | `window.onerror`, `unhandledrejection` | `globalErrorHandler.setupGlobalErrorHandlers()` |
| 6. Client validation | bad form input | light: inline checks in create modals (no Zod unless needed) |
| 7. monday SDK / context | SDK init, missing context/permissions | `MondayContext` watchdog (exists) + logged |

The heart is **Layer 2 + the logger + the UI sink**, because nearly every real
failure in this app is a monday API call.

---

## 2. Current state vs target (gap analysis)

**Already in place (reuse):**
- `MondayContext` with `monday.get('context')` + `listen` + 4s watchdog. ✅ (Layer 7 base)
- `SettingsContext` with `monday.storage` timeout + try/catch + defaults fallback. ✅ (Layer 3 base)
- `SettingsGate` load gating in `main.jsx`. ✅
- SDK throws `Error` with messages from `monday-client.api()`. ✅ (a throw point to instrument)
- Generated hooks already `try/catch` with `cancelled` race guards. ✅ (Layer 4 base)

**Missing (to build):**
- A real `logger` (ring buffer, levels, sinks, console gating).
- monday error classification (`errorHandler` — codes → Hebrew user messages, `canRetry`).
- Global handlers (`window.onerror` / `unhandledrejection`).
- UI surfacing: toast system + error-details modal + error boundary + network screen.
- A monitoring transport (Axiom or `logger.flush`).

**Key difference from tracker:** tracker uses `@vibe/core` + CSS Modules for UI.
We use **Tailwind v4 + our `vibe-runtime/components/ui`** primitives. So the
Toast/Modal/NetworkScreen are **rebuilt with Tailwind + our design tokens**,
reusing our existing `dialog.jsx`, `button.jsx`, etc. The non-UI utilities
(logger, errorHandler, globalErrorHandler, lazyRetry) port almost verbatim — they
are framework-agnostic.

---

## 3. Proposed file layout (all new files under `src/vibe-runtime/`)

```
src/vibe-runtime/
  observability/
    logger.js              # ring buffer + levels + emit + sinks + flush  (port)
    errorHandler.js        # parseMondayError + createFullErrorObject + ERROR_MESSAGES (port, keep Hebrew)
    globalErrorHandler.js  # setupGlobalErrorHandlers + handleGlobalError  (port)
    lazyRetry.js           # chunk-load detection + one-reload            (port)
    axiom-transport.js     # optional remote sink (see §9)
  contexts/
    ToastContext.jsx       # toast queue + dedup + showToast/showError... (new, Tailwind)
    useUiErrorSink.js      # logger ERROR records -> showToast + replay   (port, adapt)
  components/
    ErrorBoundary.jsx      # class boundary, chunk vs render fallback     (new, Tailwind)
    NetworkErrorScreen.jsx # full-screen retry on storage/network init    (new, Tailwind)
    feedback/
      ToastContainer.jsx   # portal + stack of toasts                     (new, Tailwind)
      Toast.jsx            # one toast (success/info/warn/error)          (new, Tailwind)
      ErrorToast.jsx       # error toast: copy / details / retry          (new, Tailwind)
      ErrorDetailsModal.jsx# 3 tabs: Error / API / JSON                   (new, our dialog.jsx)
```

`src/generated/` stays **untouched** — all instrumentation lives at the runtime
boundary we own.

---

## 4. The logger (`observability/logger.js`)

Port tracker's logger almost as-is. Public surface:

```
logger.debug/info/warn/error(module, message, errorOrData)
logger.apiError(fnName, error, { query, variables, rawResponse, duration })
logger.api(fnName, query, variables) / logger.apiResponse(fnName, res, ms)
logger.initDone(step, message, data) / logger.initSummary(appLoadStart)
logger.setLevel(level) / getLevel() / isDebug()
logger.addSink(fn) -> unsubscribe / removeSink(fn)
logger.getBuffer() / logger.flush(url)
```

- **Levels:** DEBUG(0) INFO(1) WARN(2) ERROR(3) NONE(4). Default = `DEBUG` when
  `import.meta.env.DEV`, else `ERROR`. (Vite, not CRA — use `import.meta.env`.)
- **Ring buffer:** FIFO cap 150; each record `{ kind, level, module, message, error,
  data, context, timestamp, timestampISO, correlationId, duplicate, consoleEnabled }`.
- **Log-once dedup:** stamp `error.__loggedId`; mark repeat passes `duplicate=true`
  so sinks fire once per unique error instance.
- **Single console funnel:** `renderToConsole(record)` gated by `consoleEnabled`.
- **Sinks:** `dispatchToSinks` wraps each handler in try/catch (raw `console.error`
  on sink failure to avoid recursion).
- **Flush hooks:** `visibilitychange`(hidden) + `beforeunload` → `flush(url)`
  via `navigator.sendBeacon` / `fetch(keepalive)`. No-op without a URL.

No `@vibe`/i18n dependency — drop tracker's i18n calls; our app is Hebrew-only.

---

## 5. Error classification (`observability/errorHandler.js`)

Port tracker's `parseMondayError(error, response, apiRequest)` and
`createFullErrorObject(...)` verbatim — the Hebrew `ERROR_MESSAGES` map already
matches our UI language. Covers the categories we actually hit:

| Category | Codes | canRetry | User action |
|---|---|---|---|
| Auth | `USER_UNAUTHORIZED`, `InsufficientScope` | no | בקש הרשאות מבעל הלוח |
| Missing column/board | `ResourceNotFoundException`, "Column not found" | no | פתח הגדרות ובחר מחדש |
| Complexity / rate-limit | `ComplexityBudgetExhausted`, `RATE_LIMIT_EXCEEDED`, 429 | **yes** | המתן ונסה שוב |
| Column value | `ColumnValueException`, `InvalidArgumentException` | no | בדוק את הנתונים |
| Network / server | `Failed to fetch`, `NetworkError`, 500/502/503 | **yes** | בעיית רשת — נסה שוב |

Returns `{ userMessage, errorCode, fullDetails, canRetry, actionRequired, apiRequest }`.

> This is **directly relevant** to our SDK: our column mapping has `verified:false`
> fields, and a wrong column id surfaces as `ColumnValueException` /
> `ResourceNotFoundException` — this layer turns that into an actionable toast
> instead of a silent failure, which de-risks the SDK migration.

---

## 6. Layer 2 — instrument the SDK boundary (the highest-value step)

The generated hooks `catch` errors and `console.error` them (they don't rethrow
to the UI). So to surface API failures we instrument the boundary **we own**, not
the generated code:

- In `monday-client.api()`: on a thrown/`errors` response, call
  `logger.apiError(operationName, error, { query, variables, rawResponse })`
  **before** throwing. Every SDK query/mutation failure becomes a logged ERROR →
  sink → toast, regardless of the hook swallowing it.
- Optionally wrap each `BoardSDK` `execute()` to attach `context.query`/`variables`
  for richer detail in the modal.

This single change lights up Layer 2 across the whole app without editing
`src/generated/`.

---

## 7. Layers 1, 5, 7 — boundaries & global handlers

**Boot order in `main.jsx`** (mirror tracker; global handlers first):

```
import { setupGlobalErrorHandlers } from './vibe-runtime/observability/globalErrorHandler';
setupGlobalErrorHandlers();             // BEFORE React

createRoot(...).render(
  <ErrorBoundary>                        // Layer 1 — root, above providers
    <ToastProvider>                      // toast queue + UI sink mount
      <MondayProvider>                   // Layer 7 (exists)
        <SettingsProvider>               // Layer 3 (exists)
          <SettingsGate>                 // load gate (exists)
            <App />
          </SettingsGate>
        </SettingsProvider>
      </MondayProvider>
      <ToastContainer />                 // portal, renders the stack
    </ToastProvider>
  </ErrorBoundary>
);
```

- `ErrorBoundary` also wraps each main pane (`DiscussionList`, `DiscussionCard`)
  so one pane crashing doesn't white-screen the app. `onError` opens the details modal.
- `globalErrorHandler`: `window.addEventListener('error'|'unhandledrejection')`
  → chunk-error check (`lazyRetry`) → `handleGlobalError` → `logger.error`.
- `MondayContext` watchdog already covers SDK-init hang (Layer 7).

---

## 8. UI surfacing (Tailwind rebuilds of tracker components)

- **`ToastContext`** — `toasts[]`, `showToast(msg,type,duration,details,onRetry)`,
  `showSuccess/Error/Warning/Info`, `openErrorDetailsModal`, dedup window 2000ms
  (fingerprint `message+errorCode`). Mounts **`useUiErrorSink({ showToast })`** so
  every `level==='ERROR'` record becomes a toast; skips `module==='ErrorBoundary'`
  (fallback UI handles those) and replays up to 5 buffered init-time errors on mount.
- **`Toast` / `ErrorToast`** — built with Tailwind + our tokens (`bg-destructive`,
  `bg-card`…). Error toast: 📋 copy JSON, ℹ️ details, ↻ retry, × close; auto-close 6s.
- **`ErrorDetailsModal`** — reuse our existing `components/ui/dialog.jsx`; 3 tabs
  (Error / API query+vars / full JSON) with copy buttons; Esc to close.
- **`NetworkErrorScreen`** — full-screen retry; shown by `SettingsContext` when
  storage load hard-fails (wire its existing `catch` to a `loadError` state +
  optional one silent reload, exactly like tracker).

RTL is already the app default (`dir="rtl"`); toasts anchor bottom-start.

---

## 9. Monitoring / remote transport

Two options (logger is transport-agnostic via `addSink`/`flush`):

1. **Axiom (recommended)** — the repo already has an `add-to-status-hub` skill and
   an `_axiom-dashboard-template`. Add `observability/axiom-transport.js` as a
   logger **sink** (dual transport: console + Axiom) so WARN/ERROR ship to a
   dataset; the status-hub dashboard then renders health. Run `/add-to-status-hub`.
2. **`logger.flush(url)`** — POST the ring buffer to a `/logs` endpoint on
   `visibilitychange`/`beforeunload` (already built into the logger). Cheapest if
   no Axiom.

Either way: production console stays quiet (level=ERROR), but WARN/ERROR still
reach sinks → remote.

---

## 10. Phased rollout

- **Phase 0 — foundation (no UI):** port `logger.js`, `errorHandler.js`,
  `globalErrorHandler.js`, `lazyRetry.js`. Call `setupGlobalErrorHandlers()` in
  `main.jsx`. Instrument `monday-client.api()` with `logger.apiError`. _Outcome:
  every error is centrally logged; nothing visual yet._ ✅ verify in console.
- **Phase 1 — UI sink:** `ToastContext` + `useUiErrorSink` + `Toast`/`ErrorToast`
  + `ToastContainer`. _Outcome: API failures show actionable Hebrew toasts._
- **Phase 2 — boundaries & details:** `ErrorBoundary` (root + panes) +
  `ErrorDetailsModal` + wire `NetworkErrorScreen` into `SettingsContext`.
- **Phase 3 — monitoring:** Axiom sink via `/add-to-status-hub` (or `flush` endpoint).
- **Phase 4 — polish:** dedup tuning, `initDone` milestones for boot timing,
  `lazyRetry` once we code-split (e.g. lazy-load the four discussion tabs).

Each phase is independently shippable and leaves the app working.

---

## 11. Effort & risk

- Phases 0–1 are the bulk of the value and are mostly **ports** (logger +
  errorHandler are framework-agnostic) → low risk.
- The UI components are new but small and built on primitives we already have.
- No changes to `src/generated/` at any phase → zero risk to the exported app.
- Biggest payoff: instrumenting the SDK boundary (Layer 2) — it makes the
  `verified:false` column-mapping risks from the SDK migration **visible and
  actionable** instead of silent.

## 12. Explicitly out of scope (for now)

- Zod / react-hook-form validation layer (our forms are trivial; inline checks suffice).
- A full reporter abstraction for Sentry/Datadog (Axiom sink covers monitoring).
- i18n of error messages (app is Hebrew-only; keep hardcoded Hebrew strings).
