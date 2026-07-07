# Axis · Standards

Source of truth for standardizing the product components: **Planner**, **Tracker**, **sync-calender**.
The shared service layer `Monday-api-service` is the reference point (contract + helper), **not** a mandatory package.

> Every decision here is expressed in `CLAUDE-template.md` — which each app adopts as its own `CLAUDE.md`.

---

## Decision Table

| # | Topic | Decision |
|---|-------|----------|
| 1 | React / Vite | **Upgrade Tracker to React 19 + Vite 7** — full alignment. |
| 2 | Language | **Mixed** — TypeScript not mandatory. A new app may choose. |
| 3 | monday SDKs | **`monday-sdk-js` (client) aligned to 0.5.7; `@mondaycom/apps-cli` aligned to 4.x.** `@mondaycom/apps-sdk` is **server-side only** (sync-calender). |
| 4 | API layer | `Monday-api-service` = **contract + helper**. Each app writes its own layer against the contract. |
| 5 | Logging | **New app → unified logger + Axiom.** Existing apps migrated gradually. |
| 6 | Error UX | **Tracker model** (ErrorBoundary + modal + global handler) across all apps. |
| 7 | i18n / Hebrew | **i18next mandatory + ESLint rule** banning Hebrew strings outside `t()` (bilingual apps). |
| 8 | Settings storage | Each app keeps its own mechanism. **Must document in CLAUDE.md how settings are managed.** |
| 9 | ESLint / Prettier | **Shared core rules only** (Hebrew enforcement + catch-block). Per-app config. No Prettier. |
| 10 | Testing | **Vitest mandatory + minimum coverage threshold + test:tz** in every app. |
| 11 | CLAUDE.md structure | **Mandatory core sections + optional per-app sections.** |
| 12 | Meta sections | **Five sections mandatory** at the top (Description · Purpose · Technologies · Constants · Deploy). |
| 13 | Workflow | **Enforce 'before all' / 'after all' + change classification via `change-tracker`** in every project. |
| 14 | Architecture + bugs | **Every change updates a dedicated architecture file.** Other changes/bugs documented via `change-tracker`. |
| 15 | Folder structure | **Recommended and documented, not mandatory.** |
| 16 | env / deploy | **Document conventions only** (.env + deploy), no enforced shared files. |
| 17 | App-core (settings + startup + infra) | **Shared package `@axis/app-core`** (`Services/axis-app-core`) — imported by every app: startup, MondayContext (+permissions), generic settings module, logger (+Axiom), error pipeline, API queue. |

---

## Details

### Infrastructure
- **#1 Versions:** target — `React 19` + `Vite 7` across all apps. Tracker gets upgraded (breaking; planned separately).
- **#2 Language:** no `TypeScript` requirement. Existing code stays; a new app chooses. (This is why API codegen is not enforced — see #4.)
- **#3 SDK:** corrected after code audit — there are **three distinct packages**, not one:
  - `monday-sdk-js` (client-side API inside the iframe) — used by all three. Align to `0.5.7` (Planner's version). Tracker/sync-calender on `0.5.5`.
  - `@mondaycom/apps-cli` (dev/deploy CLI) — used by all three but versions diverge (`4.0.0` / `4.7.4` / `4.10.5`). Align to latest `4.x`.
  - `@mondaycom/apps-sdk` (**server-side** SDK: SecureStorage, getSecret, Environment) — **only sync-calender actually uses it** (3 imports). Planner declares `3.2.1` but has **0 imports — a dead dependency to remove**. Tracker doesn't have it (correct — it's a client board view).

### Shared service
- **#4 API:** `Monday-api-service` defines an **interface contract** (method names: `getBoard`, `createItem`, `updateMultipleColumnValues`, `getAllItems`, …) and provides helper code to copy. Each app implements its own layer against the contract — not an imported mandatory package. Fixes/retry/rate-limit stay contract-compatible.
- **#5 Logging:** a **new** app uses the unified logger that streams to `Axiom`. Existing apps (Planner/Tracker on console) are migrated gradually.
- **#6 Error UX:** the standard is the **Tracker** model — `ErrorBoundary` for render-throws, an error-details modal, and `globalErrorHandler` (window.onerror + unhandledrejection), including dedup and owner notification.
- **#7 i18n:** `i18next` mandatory in every bilingual app, with an ESLint rule that catches Hebrew strings (U+0590–U+05FF) outside `t(...)`.

### Code quality
- **#8 Settings:** no unified storage mechanism (instance storage vs SecureStorage both kept). **Required:** a CLAUDE.md section explaining how the app manages settings (keys, schema, validation).
- **#9 ESLint:** per-app config, but **two mandatory shared core rules**: (1) Hebrew-in-`t()` enforcement; (2) `catch` must log/throw/show an error. `Prettier` — not at this stage.
- **#10 Testing:** `Vitest` mandatory, a minimum coverage threshold, and `test:tz` (timezone-aware tests) in every app. sync-calender starts from zero.

### Structure & workflow (CLAUDE.md)
- **#11 + #12:** the five meta sections are mandatory at the top of every CLAUDE.md; the remaining sections are optional per app.
- **#13 Workflow:** 'before all' / 'after all' guidance + change classification (behavior / bug / new component) are enforced via the `change-tracker` skill in every project.
- **#14 Architecture:** every change updates a **dedicated architecture file** (`ARCHITECTURE.md`). Documenting changes and bugs is done via `change-tracker`, not inside CLAUDE.md.

### Infrastructure modules
- **#17 App-core (`@axis/app-core`):** the settings module + the whole app startup/infrastructure are extracted into a **shared package** at `Services/axis-app-core`, imported by every app (unlike #4's contract-only API layer). It covers: `bootstrapApp`/`polyfillGlobal` (startup), `MondayProvider`/`useMondayContext` (SDK context + language/dir/locale + permissions via injected `getBoardOwners`), `createSettings<T>()` (generic settings module — GLOBAL `monday.storage` keyed by instanceId, retry/backoff, silent-reload guard, migrations, validation, optimistic update), `createLogger` (leveled + ring buffer + log-once + Axiom transport — absorbs #5), the error pipeline `ErrorBoundary`/`setupGlobalErrorHandlers`/`useErrorHandler` (absorbs #6), and `createApiQueue` (Planner's rate-limit/backoff). Built from tracker + Planner patterns. **Storage decision:** standardize on global `monday.storage` keyed by instanceId (Tracker's approach, user-confirmed); Planner migrates from its `monday.storage.instance` + fixed key with a one-time read of the old key. **First consumer:** Day-off, wired end-to-end (build/typecheck/lint/test all green). As a real imported dependency it needs versioning and carries cross-app break risk (same trade-off as #4 option A). Tracker/Planner migrate incrementally.

### Documentation (non-blocking)
- **#15 Folders:** a recommended `src/` structure (api → services → hooks/components) is documented, not enforced.
- **#16 env/deploy:** document `.env` and `mapps code:push` conventions, with no enforced shared files.
