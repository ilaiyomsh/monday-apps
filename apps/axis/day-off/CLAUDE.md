# CLAUDE.md — Day-off

> Structured per the Axis unified template (`../CLAUDE-template.md`). Decisions: `../STANDARDS.md`.
> New app — built standards-first (React 19, Vite 7, unified logger → Axiom, Tracker error model, i18next + ESLint Hebrew rule, Vitest + test:tz).

---

## 1. App Description
Monday.com **Custom Object** app for managing employee days off (vacation / sick / reserves). Runs standalone (no reliable `context.boardId`) — the user picks the target board in Settings.
App ID: `11459177` · Feature (Custom Object) ID: `22016827` · Draft version: `15124901`. Slug: `yomsheni-il_day-off`.

## 2. Purpose & Usage
For employees/managers to record and view days off. **Fully implemented app** (not a skeleton): employees submit/edit/cancel absence requests (dynamic type set, date range, notes, file attachment) with an approval lifecycle; managers approve/reject (single + approve-all); views = My absences (month calendar + list), Team Gantt, Approvals inbox, Dashboard; company days are managed inside Settings. All data lives on **one configured "vacations" board** (personal requests + general company days, discriminated by a kind status column) — see `ARCHITECTURE.md` for structure.

**`CONTRACT.md` is the normative consumer contract** for this board (Day-off integration W1.6): Planner and tracker read the board as the absence source of truth and code against that document. Changes to read/write semantics here are contract changes — update `CONTRACT.md` (and the integration plan §4) in the same change.

## 3. Technologies
- React `19.2` · Vite `7.2` · Language: **TypeScript** (standard #2 — new app chose TS)
- `monday-sdk-js@0.5.7` (client API) · `@mondaycom/apps-cli@4.10.5` (deploy CLI)  *(standard #3)*
- **`@axis/app-core`** (`workspace:*`, at `apps/axis/services/app-core`) — startup, MondayContext, settings module, logger, error pipeline (standard #17). Wired in `src/core.ts`.
- `i18next` + `react-i18next`. `@vibe/core` + `@vibe/icons` (added for the `PeoplePicker`; tokens imported in `main.tsx`).

## 4. Constants
- **No hardcoded board IDs** — board/column targeting is in Settings (`DayOffSettings`).
- Storage keys: `customSettings_${instanceId}` (settings). `instanceId = context.instanceId || boardId || 'default'`.
- i18n: `lng='he'`, `fallbackLng='he'`; locales in `src/i18n/locales/{he,en}`.

## 5. Deploy — monorepo CI/CD pipeline (monday-code)

Day-off is onboarded to the shared monorepo pipeline like every other app.
**No local build+push, no GitHub Pages / `gh-pages`, no `custom_url`.** Deploys run
ONLY on GitHub Actions runners — never run `mapps code:push` from a machine.

- **Merge to `develop`** → `.github/workflows/deploy-draft-axis-day-off.yml` builds
  (`pnpm --filter "./apps/axis/day-off" build`, Vite → `dist/`) and pushes the app's
  **latest draft**: `mapps code:push -c -d apps/axis/day-off/dist` (App ID `11459177`
  via the `APP_AXIS_DAY_OFF_ID` secret; the CLI resolves the version — no version IDs).
- **Merge to `main`** (approved release PR only) → `deploy-live-axis-day-off.yml`
  force-deploys the resolved LIVE version.
- `@axis/app-core` is a **pnpm workspace** dependency (`workspace:*`, at
  `apps/axis/services/app-core`), so CI resolves it — the old "must build locally
  because the `link:` dep is outside the repo" constraint no longer applies.

See the root `CLAUDE.md` (Deploys — pipeline only) and the `monday-cicd` skill for
the full model and the customer-release procedure.

```bash
# Development
pnpm start                    # vite (port 8301) + mapps tunnel
# Deploy: never run locally — merge to develop (draft) / main (live); CI does the push.
```

Client build env (`VITE_*`): see `.env.example`. The Axiom ingest token is injected by
CI (`VITE_AXIOM_TOKEN` ← the `AXIOM_INGEST_TOKEN` secret) and is inert without it — no
token locally means console-only logging. Client bundles build `sourcemap: 'hidden'`;
CI archives the maps and strips them before push (see `docs/LOGGING-ARCHITECTURE.md` §6).

---

## 6. Technical Standards

> Most infrastructure (#5 logging, #6 errors, #8 settings, startup) comes from **`@axis/app-core`**, instantiated in `src/core.ts` (exports `monday`, `logger`, `SettingsProvider`, `useSettings`). The sections below note the app-specific glue.

### MondayAPI  *(#4)*
`src/services/mondayApi.ts` implements the `Monday-api-service` contract (`getBoard`, `getAllItems`, `createItem`, `updateMultipleColumnValues`, `deleteItem`, `query`, `storageGet/Set`). Single funnel via `query()` with rate-limit retry; throws `MondayApiError`. No direct SDK calls from components.

### Logging  *(#5)*
`src/utils/logger.ts` — leveled (debug/info/warn/error) + API helpers. Console + **Axiom transport** (fetch-based, env-gated: `VITE_AXIOM_DATASET` + `VITE_AXIOM_TOKEN`). Production: ERROR-only console; errors always print. New-app standard: Axiom on from day one.

### Error Handling  *(#6 — Tracker model)*
`ErrorBoundary` (render throws) + `setupGlobalErrorHandlers()` (window.onerror + unhandledrejection) + `useErrorHandler()` (`handleError` logs once, surfaces `ErrorDetailsModal`). Every `catch` must `logger.*` / `throw` / `handleError` — enforced by ESLint (#9).

### I18n  *(#7)*
`i18next` configured; **all** user-facing strings via `t(...)`. ESLint bans Hebrew literals outside `t()` (see eslint.config.js).

### Settings Management  *(#8 — via @axis/app-core #17)*
`createSettings<DayOffSettings>` in `src/core.ts` → `SettingsProvider`/`useSettings`. Persisted in **global** `monday.storage` under `customSettings_${instanceId}` (Axis convention — not instance storage). UI: `Settings/SettingsDialog` is built on app-core's `SettingsDialogShell` (tabs: general + mapping; draft-until-save; export/import). Schema: `DayOffSettings` in `src/types`.

### Testing  *(#10)*
`Vitest` (jsdom, `src/setupTests.ts`). `pnpm test` / `test:watch` / `test:tz`. Coverage target **100% — aspirational, not CI-blocking**.

### ESLint  *(#9)*
`eslint.config.js` (flat). Shared core rules: Hebrew-in-`t()` + catch-block must handle. Plus `no-console` (use `logger`).

---

## 7. Workflow

### Before All
- Most logic: `services/mondayApi.ts` (API), `contexts/` (state), `components/` (UI).
- Don't break: the single API funnel, the one-error-one-surface contract, global-storage settings keying.

### Change Classification
Classify the change (behavior / bug / new component) and open via `change-tracker` (`/new_change`).  *(#13)*

### After All
- Run tests (`pnpm test`, `pnpm run test:tz` for date logic).
- Structural change → update `ARCHITECTURE.md`.  *(#14)*
- Close via `change-tracker` (`/close_change`).

---

## 8. Related documents
- `ARCHITECTURE.md` — component tree, data model (single vacations board), data flow, conventions.
- `CONTRACT.md` — the **normative** absence data contract consumed by Planner/tracker (fields, label-ID matching, range-expansion spec, consistency model, board permissions).
- `../DAY-OFF-INTEGRATION-PLAN.md` + `../DAY-OFF-INTEGRATION-EXECUTION.md` — the integration design + progress ledger (Axis root).
