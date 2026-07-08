# Day-off — Architecture

A React 19 / Vite 7 **Custom Object** monday.com app (TypeScript) for managing employee days off — a **fully implemented absence app** (requests + approval lifecycle + company days). Keep this document in sync as features land (standard #14). The board semantics other Axis apps consume are normatively specified in **`CONTRACT.md`** (Day-off integration W1.6) — contract changes must update that file (and the integration plan §4) in the same change.

> **Infrastructure** (startup, MondayContext, settings module, logger, error pipeline) comes from the shared **`@axis/app-core`** package (#17), instantiated in `src/core.ts`. Only app-specific glue lives in this repo.

## 1. Overview
- **Stack:** React 19, Vite 7, `monday-sdk-js`, `@axis/app-core`, `i18next`/`react-i18next`. `@vibe/core` used selectively (e.g. `PeoplePicker`; tokens imported in `main.tsx`).
- **State:** React Context only — `MondayProvider` (SDK context) → `SettingsProvider` (settings), both from `@axis/app-core`.
- **Persistence:** global `monday.storage` keyed by `customSettings_${instanceId}` (Axis convention — not instance storage), via app-core's `createSettings`.
- **API:** single funnel `mondayApi.query()` (`src/services/mondayApi.ts`), implementing the `Monday-api-service` contract, using app-core's shared `monday` + `logger`.
- **Errors/logging:** app-core `ErrorBoundary` + `setupGlobalErrorHandlers` + `useErrorHandler` converge on app-core `logger`; logger ships to Axiom when configured.

## 2. Startup & bootstrap flow
```
src/main.tsx
  ├─ import './i18n'                 (i18next: he/en, lng='he')
  ├─ import { logger } from './core' (core.ts: polyfillGlobal → mondaySdk → createLogger → createSettings)
  └─ bootstrapApp({ logger, children:<App/> })   (app-core: polyfill + global error handlers + render)
```

## 3. Provider tree (all providers from @axis/app-core)
```
App.tsx
  └─ ErrorBoundary           logger prop — catches startup throws, outside providers
     └─ MondayProvider       monday.get('context') + listen, watchdog, permissions
        └─ SettingsProvider  load customSettings_${instanceId} (retry/backoff/migrations)
           └─ AppContent      applies language/dir + data-theme to <html>; renders provider + error surface
              └─ DayOffDataProvider  one board read → requests + companyDays; team resolution; mutations + analytics + toasts
                 └─ DayOffView        app shell: header, role tabs, active view, modal switchboard, toasts
                    ├─ views/*  (EmployeeView, TeamView, ApprovalsView, DashboardView — company days live in Settings, no CompanyDaysView)
                    ├─ modals/* (Request, RequestDetail, Approve, Reject, CompanyDay, Drill)
                    ├─ ui/*     (Icon, Avatar, Modal, MonthCalendar, YearSelect, KpiCard, …)
                    └─ Settings/SettingsDialog (tabs: general · board + column/label mapping · team/roles · company days = CompanyDaysTab)
```

## 4. Modules
| Area | File | Role |
|---|---|---|
| App-core wiring | `src/core.ts` | instantiates `monday`, `logger`, `SettingsProvider`/`useSettings` from `@axis/app-core` |
| Entry | `src/main.tsx` | `bootstrapApp()` from app-core |
| Root | `src/App.tsx` | app-core providers + ErrorBoundary + language/dir + error modal |
| API layer | `src/services/mondayApi.ts` | `Monday-api-service` contract, retry, `MondayApiError` (uses core's monday+logger) |
| Settings UI | `src/components/Settings/SettingsDialog.tsx` | tabs: general · board + column mapping + label-ID maps · team/roles · company days (`CompanyDaysTab.tsx`); label-edit consumer-warning diff in `personalTypeDiff.ts`; over `useSettings` |
| Error UI | `src/components/ErrorDetailsModal.tsx` | surfaces `useErrorHandler` error |
| App shell | `src/components/DayOffView.tsx` | header, role tabs, active view, modal switchboard, toasts |
| Views | `src/components/views/*` | the 4 screens (My absences, Team Gantt, Approvals, Dashboard) — company days are managed inside Settings |
| Modals | `src/components/modals/*` | request / detail / approve / reject / company-day / drill |
| UI kit | `src/components/ui/*` | Icon, Avatar, Modal, MonthCalendar, YearSelect, Seg, EmpFilter, KpiCard, … (barrel: `ui/index.ts`) |
| Data context | `src/contexts/DayOffDataProvider.tsx` | `useDayOffData()` — loads data, mutations, analytics, toasts |
| Domain | `src/domain/*` | `types.ts`, pure `dates.ts` (+ `useL10n.ts` i18n binding), `absence.ts` (types + balance analytics), `settingsValidation.ts` (required-mapping validation — single source of truth for "configured enough to read") |
| Services | `src/services/*` | `columnMap` (monday value (de)serialization), `vacationService` (the single funnel for the vacations board: window-scoped read split into requests/companyDays + all writes — replaced the former requests/companyDays/entitlements services), `usersService` |
| i18n | `src/i18n/` | i18next + he/en bundles (all UI strings, date-name arrays) |
| Types | `src/types/index.ts` | `DayOffSettings` (boards + column maps + type/status value maps + `teams[]`), `Team` |

## 5. Data model (ONE monday board, configured in Settings)
> Normative consumer-facing spec: **`CONTRACT.md`** (integration W1.6). Planner/tracker code
> against it; the bullets below are the app-internal view of the same model.
- **A single vacations board** (`vacationBoardId`) — every item is one absence entry: a
  **personal request** OR a **general company day**, discriminated by the `kind` status column
  (label-ID matched, person-presence fallback). Columns mapped by id (`VacationColumnMap`):
  kind (status), person (people), **startDate + endDate (two date columns — NOT a timeline)**,
  workdays (numbers — app-computed, informational only), personalType (status — **open dynamic
  label set**, cached in `settings.personalTypes`), approvalStatus (status), employee + manager
  notes (long-text), decided-by (people), decided-at (date), file, mandatory (checkbox, general
  entries: true = office closed). `submittedAt` = item `created_at`. `kindValues`/`statusValues`
  map app enums ↔ the board's status labels (label IDs first — next bullet); `typeValues` is a
  deprecated legacy map kept for old blobs.
- **Status-label matching is by stable monday label ID** (org standard, W1.2/D8 of the Day-off
  integration): `kindValues` carries `generalLabelId`/`personalLabelId` and `statusValues` carries
  `labelIds` (per status); label **text** stays for display + a case-insensitive fallback for
  legacy settings saved before IDs were stored. An item whose approval label matches neither IDs
  nor texts makes the read **fail loudly** (`ApprovalStatusMismatchError` → error pipeline) — never
  a silent `pending` default. Unknown/empty *kind* falls back to person-presence (personal iff the
  person column is non-empty, per the integration-plan contract §4.1), warn-logged when non-empty.
- **Reads are window-scoped** (W1.1 of the Day-off integration): `vacationService.listEntries`
  accepts an arbitrary **inclusive `[from,to]` day window** (`DayWindow`, `domain/types.ts`) —
  cross-year capable per the integration contract §4.5. The board query uses the AND-of-two-rules
  overlap form (`end ≥ from AND start ≤ to`, also catching items spanning the whole window), backed
  by a client-side overlap filter (`rangeOverlapsWindow`) so over-fetches never leak out of the
  window. A calendar-year number remains a back-compatible legacy scope (the app's own year-tabbed
  UI passes it; it normalizes to that year's window via `yearWindow`).
- **Settings validation is strict** (W1.3 of the Day-off integration): beyond `vacationBoardId`, the
  five contract-critical column mappings (kind / person / startDate / endDate / approvalStatus) and
  non-empty kind/status label maps are required (`domain/settingsValidation.ts` — a label-map entry
  counts when it has a stable label ID or, legacy, a non-empty text). The same function drives three
  surfaces: app-core's `useSettings().validation` (via `core.ts`), the SettingsDialog draft (Save is
  blocked, per-field errors shown), and `DayOffView`'s gate — a half-configured board renders a loud
  issue-list error screen, and `DayOffDataProvider` builds no service ctx (the board is never read),
  so misconfiguration can never yield all-pending or silently-empty data.
- **Label edits warn about external consumers** (W1.5 of the Day-off integration): Settings can
  rewrite the personal-type status labels via `update_status_column`
  (`mondayApi.updateStatusColumnSettings` — add/rename/recolor/deactivate, with an in-use guard),
  but Planner and tracker cache this column's **label IDs** in their own settings (monday storage is
  app-scoped — they cannot see Day-off's mapping). The SettingsDialog typeValues section therefore
  shows a `role="alert"` warn-box whenever the draft labels diverge from the live board labels
  (`components/Settings/personalTypeDiff.ts` — `hasPendingLabelEdits` against the last-loaded
  snapshot baseline), telling the admin that board re-mapping may be needed in those apps after
  saving. Display-only; no read/write behavior change.
- **Company days are items on the SAME board** (kind = general): the item **name** IS the
  holiday/company-day name (there is no general-type column — the dead `generalTypeColumnId`
  was removed, W1.4), same start/end date columns, `mandatory` checkbox (true = office closed;
  unmapped column reads as false). Managed inside **Settings → Company days** (`CompanyDaysTab`)
  — there is no separate company-days board and no CompanyDaysView.
- **Entitlements/yearly quotas were REMOVED (2026-06-03)** — no entitlements board exists.
  `entitlements` survives on the provider surface as a constant empty list so balance analytics
  compile (`entitled` resolves to 0); `used`/`pending` are **computed live** from
  approved/pending requests (`domain/absence`).
- **Teams & roles** — `teams: Team[]`, each `{ id, name, managers[], employees[] }` (monday user ids).
  Configured in Settings via a People-column-style `PeoplePicker` (one card per team). Legacy flat
  `{ team, managers }` is migrated to a single team on load (`core.ts` `migrate`). Users resolve to
  `Employee` via the monday `users` API; the current user via `me`. The provider derives:
  `isManager` (manager in **any** team), `myTeams` (teams the user is in), `teamIds` (the user's
  visible member universe), and `teamsOf(empId)` (for the team label on a request). The Team view groups
  the Gantt by team when the user is in >1 team; Dashboard offers a per-team filter when >1 team;
  Approvals labels each request with the requester's team(s). Avatars show `photo_thumb_small`
  (`photoUrl`) with an initials fallback.

> **File upload is implemented (2026-06-05):** a `File` passed as a GraphQL variable to
> `add_file_to_column` is auto-converted by the monday platform to a multipart request
> (`mondayApi.addFileToColumn`). Used on request create, edit, and post-hoc attach
> (`attachDocument` — any status, e.g. adding a sick note to an approved request). Existing
> file-column assets are shown on read.

## 6. Data flow
```
SettingsProvider (config)                              [app-core → monday.storage]
  → DayOffDataProvider  builds the service ctx from settings (null while settings invalid — W1.3);
        loads the vacations board once per selected year (vacationService.listEntries →
        split into requests + companyDays); resolves team users + current user in background
     → views/modals read slices via useDayOffData()
     → a mutation (submit/approve/reject/cancel/saveCompanyDay) → service write → re-fetch → toast
  → SettingsDialog → useSettings.updateSettings → app-core persists to monday.storage
```

## 6.1 Deep link (open a specific request on load)
External sources link into the app to open one request's detail modal:
```
{customObjectUrl}?app[itemId]=<monday item id>
```
- monday only exposes query params under the `app[...]` namespace to the embedded iframe.
  `useDeepLinkItemId()` (`src/hooks/useDeepLink.ts`) reads it via `monday.get('location')`
  (`data.query.itemId`), with a `window.location.search` fallback for standalone dev.
- `DayOffView` consumes it once (a `useRef` guard) after `loading`/config gates clear: it looks
  up the id in the loaded `requests`, else calls `fetchRequestById` (→ `vacationService.getRequestById`,
  a single-item fetch for requests outside the loaded year), then opens
  `{ kind: 'detail', request, asManager: false }` — identical to a "My absences" calendar-day click.
- See `DEEPLINK.md` for the link-builder spec handed to the producing app.

## 7. Conventions
- All API via `mondayApi`; no direct SDK calls in components.
- All user-facing strings via `t(...)` (ESLint-enforced).
- Every `catch` logs / throws / `handleError` (ESLint-enforced).
- Settings in global storage, key-namespaced by `instanceId`.
- Status labels matched/stored by **stable label ID** via the column `settings` field (never
  `settings_str`); text is display + legacy fallback only.
- **Contract changes** (anything altering how the vacations board is read/written) must update
  `CONTRACT.md` AND the integration plan §4 in the same change.

## 8. Mobile (dedicated mobile experience)
The app runs inside the monday **mobile app** webview (~360–430px, RTL). It ships a dedicated
mobile experience, not just a responsive shrink. See `MOBILE-PLAN.md` for the per-phase ledger.
- **Breakpoint:** one phone breakpoint = **600px**. Single-sourced as `MOBILE_BREAKPOINT` in
  `src/hooks/useIsMobile.ts` and mirrored by the `/* MOBILE LAYER (<=600px) */` banner in `app.css`.
- **Detection:** `useIsMobile()` = `matchMedia('(max-width:600px)')` (authoritative, first-paint
  correct) **OR** app-core's `useMondayContext().isMobile` (an enhancement only — `context.mode`
  is undocumented + watchdog-gated, so never the sole gate). `DayOffView` stamps `is-mobile` on the
  root `.app`, so the JS- and CSS-detected mobile states unify on one selector.
- **CSS:** all mobile rules live in ONE appended **MOBILE LAYER** section at the end of `app.css`
  (loads last → wins the cascade at equal specificity, no `!important`). The dedicated layer is
  primarily gated on `.is-mobile`; pure width-only reflows and any portaled shell (Settings) use the
  trailing `@media (max-width:600px)` block; touch-only hover fixes use `@media (hover:none)`.
- **Key mobile behaviours:** bottom tab bar for managers (no nav band for employees); the inline
  "new request" button is the create path (no FAB); modals become bottom sheets; ApprovalsView and
  TeamView swap to mobile renders (stacked cards / a day carousel + per-day list) via `useIsMobile()`
  branches that reuse the same data; the dashboard by-time chart renders as a vertical bar list; the
  calendar shows colour-only bars + a legend. New mobile tokens (`--safe-*`, `--mobile-nav-height`,
  `--touch-target-sm`, `--mobile-gutter`, `--z-bottom-nav`) live in `tokens.css`.
