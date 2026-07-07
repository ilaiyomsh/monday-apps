# Axis — System Architecture Map

> **Audience:** AI agents (and developers) who need to understand, extend, or implement features in the Axis suite.
> **Verified against code on 2026-06-09.** Every load-bearing fact below was checked against source; file references are given as `path:line`. This document supersedes `axis-system-map.html` (which is stale — it predates Day-off, omits the board/data model, and lists an outdated Tracker stack).
> **Hebrew note:** UI strings, board names, and status labels are Hebrew (the product is Hebrew-first, RTL). Code identifiers and agent-facing docs are English.

---

## 1. What Axis is

Axis is a suite of monday.com apps for companies that sell time (consultancies, engineering firms): managing **who works on what, when, at what load, and what actually happened**.

| Component | Role | Users |
|---|---|---|
| **Planner** | Resource planning Gantt: assign employees to projects (allocations), per-role/per-employee load heatmaps, availability | Managers |
| **tracker** | Time reporting calendar: detailed work-hour logs + all-day leave reporting, approval workflow, analytics dashboard | Employees (+ approving managers) |
| **Day-off** | Absence management: personal day-off requests (vacation/sick/reserves) with approval flow + company-wide days/holidays | Employees + managers |
| **sync-calender** | Auxiliary: one-way sync of Google/Outlook calendar events into a monday board (feeding tracker) | Backend service + admin UI |
| **Services/** | Shared packages and ops tooling (see §7) | Developers |

**Architectural invariant: components never import each other.** Integration between product apps is **board-level only** — they read/write the same monday.com boards, with all board/column IDs supplied via per-app user-configured settings (nothing hardcoded). The only code-level sharing is the `@axis/app-core` infrastructure package (§7.1).

---

## 2. Component registry

| | Planner | tracker | Day-off | sync-calender |
|---|---|---|---|---|
| monday App ID | 10787117 | 10684862 | 11459177 (feature 22016827) | 11119011 |
| Feature type | Board view (set in Developer Center, not in repo) | Custom Object (standalone, no `context.boardId` required) | Custom Object (standalone) | Custom Object (admin UI) + server |
| Hosting | monday-code, client-side bundle (`mapps code:push --client-side`) | monday-code, client-side bundle | **GitHub Pages** (`https://ilaiyomsh.github.io/day-off/` via `custom_url`) — account hit monday-code's 5-private-app limit; deploy = `gh-pages -d dist` | monday-code **server** (Node/Express, port 8080) |
| Language | TypeScript (strict) | JavaScript/JSX (deliberate) | TypeScript | JavaScript (Node ESM) |
| Stack | React 19, Vite 7, Tailwind 4, @vibe/core, @dnd-kit, @tanstack/react-virtual, date-fns, i18next | React 19.2, Vite 7, react-big-calendar (patched), @vibe/core, @hebcal/core, recharts, exceljs, i18next | React 19.2, Vite 7.2, @vibe/core 4, i18next | Express, googleapis, Microsoft Graph, @mondaycom/apps-sdk, @axiomhq/js; admin SPA React 19 + Vite |
| Backend | None (pure client) | None (pure client) | None (pure client) | Yes (Express on monday-code) |
| Settings storage | `monday.storage.instance`, key `planner_app_settings` (NOT yet migrated to the global-storage standard) | GLOBAL `monday.storage`, key `customSettings_${instanceId}` | GLOBAL `monday.storage`, key `customSettings_${instanceId}` (via app-core `createSettings`) | monday SecureStorage (`config_<id>`, `policy_<objectId>`) |
| @axis/app-core usage | **None yet** (has local equivalents; migration pending per app-core README:84) | Partial — storage primitives only (`resolveInstanceId`, `withTimeout`); logger/errors/bootstrap stay local by design (test-locked, ~855 tests) | **Full consumer** (bootstrap, MondayProvider, createSettings, logger, SettingsDialogShell) | None (own server logger) |
| Tests | Vitest + TZ-matrix | Vitest, ~855 tests, TZ-matrix | Vitest, ~61 tests, TZ-matrix | — |
| Dev port | **8301** | **8301** | **8301** | 8080 |

⚠️ All three frontend apps use dev port **8301** — only one can run `mapps tunnel` at a time.

**Facts that live outside the repo** (monday Developer Center only): feature types, OAuth scopes (Day-off scopes per its CHANGELOG: `boards:read, boards:write, users:read, me:read`), tracker's app-id binding for deploy (its `code:push` script has no `-a` flag — binding lives in mapps config).

---

## 3. System topology

```
                                 monday.com account
  ┌────────────────────────────────────────────────────────────────────────┐
  │  WORKSPACE (one per deployed system; e.g. demo workspace 15873737)     │
  │                                                                        │
  │  Portfolio ◄────────── board_relation ─────────┐                       │
  │  (projects)                                    │                       │
  │      ▲ reads                                   │                       │
  │      │                                         │                       │
  │  ┌───┴─────┐   writes   ┌─────────────┐  reads │  ┌───────────────┐    │
  │  │ PLANNER │ ─────────► │ Allocations │ ◄──────┼─ │    TRACKER    │    │
  │  └───┬─────┘            │ (THE HINGE) │        │  └───┬───────┬───┘    │
  │      │ reads            └─────────────┘        │      │writes │reads   │
  │      ▼                        ▲ mirror         │      ▼       │        │
  │  Employees                    │ (reportedHours)└── Time Logs ◄┼──────┐ │
  │  (master)                     └───────────────────────┘       │      │ │
  │      ▲ reads (today: absence rows = Time Logs items) ─────────┘      │ │
  │      │                                                               │ │
  │  ┌───┴─────┐   reads+writes   ┌──────────────────┐                   │ │
  │  │ DAY-OFF │ ───────────────► │ Vacations board  │  (target source   │ │
  │  └─────────┘                  │ (per-instance,   │   of truth for    │ │
  │                               │  not yet in      │   absences —      │ │
  │                               │  blueprints)     │   see integration │ │
  │                               └──────────────────┘   plan)           │ │
  │                                                                      │ │
  │  Google/Outlook calendars ──► SYNC-CALENDER (server) ── writes ──────┘ │
  │                               (skips all-day events by design)         │
  └────────────────────────────────────────────────────────────────────────┘

  Observability (optional): apps ──► Axiom ──► sync-calender-status hub (GitHub Pages, daily cron)
```

---

## 4. The monday.com data model

A deployed Axis system = one monday workspace with these boards (declarative model: `apps/.claude/skills/monday-provision/blueprints/boards.json`). **Apps match columns by ID (never by title) and status labels by stable label ID (never by text or position)** — see §5.

### 4.1 Portfolio (תיק פרויקטים) — project master
Columns: owner (people), RAG/priority/step (status), planned timeline, client → Customers, link → projectStructure. **Planner** reads it for project metadata + active-project filtering; **tracker** reads it as project source in portfolio mode.

### 4.2 Time Logs (דיווחי שעות) — tracker's single write target
One item per report. Key columns: date (+time for timed entries), duration (numbers — decimal **hours** for timed, integer **days** for all-day), project/task/assignment/customer (board_relation), reporter (people), notes, temporary (checkbox — sync-calender handshake), approval status.

**Two-tier classification standard** (org-wide, applies always):
- **Primary** סיווג — status column (`eventTypeStatusColumnId`), categories mapped by label ID: `פרויקטים` (billable) / `שוטף` (non-billable routine) / `יומי` (all-day). In "distinction mode": `פנימי`/`חיצוני`/`שוטף`/`יומי`.
- **Secondary** סיווג per primary: billable → project stage column; שוטף → routine sub-type column; **יומי → all-day sub-type column (`allDayTypeStatusColumnId`) with labels חופשה/מחלה/מילואים** — its labels ARE tracker's vacation menu.

**Absences today = `יומי` rows on this board, one item per day** (see §8).

### 4.3 Allocations (הקצאות) — "THE HINGE"
**Planner WRITES** (one item per allocation: employee ↔ project ↔ date range ↔ hours ↔ role); **tracker READS** in assignments mode as each user's project source. Shared columns must satisfy both contracts (same people column = Planner `employeeColumnId` + tracker `assignmentPersonColumnId`; same board_relation = Planner `projectColumnId` + tracker `assignmentProjectLinkColumnId`; same start/end dates). Also: totalHours ("the king" — hoursPerDay is derived as totalHours/countWorkingDays, `Planner/src/utils/mondayTransformers.ts:208-233`), FTE %, cost, role, capability (dropdown), and `reportedHours` — a **mirror** column aggregating actual Time Logs hours through a board_relation (planned-vs-actual per allocation).

### 4.4 Employees (עובדים) — employee master
Planner reads: name, **linked monday user (people column — the identity join, §5.1)**, official role (status), FTE %, cost, capabilities (dropdown multi), active-status filter.

### 4.5 Vacations board (Day-off) — exists, not yet standardized
Day-off's single board: every item is either a **personal absence request** or a **general company day**, discriminated by a `kind` status column. 13 operative mapped columns (kind, person, startDate, endDate, workdays, personalType, approvalStatus, mandatory, empNote, mgrNote, decidedBy, decidedAt, file — `Day-off/src/types/index.ts:33-55`; a 14th dead field `generalTypeColumnId` was removed 2026-06-10, W1.4). **Not in provisioning blueprints yet**; per-instance free-form mapping. **Normative consumer contract: `Day-off/CONTRACT.md` (W1.6, 2026-06-10)** — the written form of `DAY-OFF-INTEGRATION-PLAN.md` §4.

### 4.6 Optional boards
Customers (לקוחות); projectStructure (מבנה פרויקט) — 3-level WBS template (groups=stages, items=milestones, subitems=tasks).

---

## 5. System-wide conventions (read before coding)

### 5.1 Identity model
**Employee identity = monday user ID everywhere.** Planner: `Employee.id = userId || item.id` where userId is `persons_and_teams[0].id` of the Employees-board user column (`Planner/src/utils/mondayTransformers.ts:180`). Absence/reporter people columns must resolve to the same monday user ID. ⚠️ If the Employees-board user column is unmapped, `Employee.id` falls back to the board item ID and **all people-keyed joins silently miss**.

### 5.2 monday API hard rules (learned the hard way — `הקמות/README.md:112-145`)
- Match columns by **ID**, never title (titles are freely Hebraized).
- Status filters/mappings store **label IDs** (monday-assigned, stable), not text, not positional index. Create labels, then read back via the column's `settings`.
- Read status labels via `settings`, **not** `settings_str` (deprecated since API 2025-10).
- Writing string labels requires `create_labels_if_missing: true`.
- Mirrors aggregate only through a board_relation on the same board; board_relation defaults may need `allowCreateReflectionColumn: true`.
- Settings JSON **import MERGES** into existing settings (stale keys survive unless explicitly overwritten); tracker's validator hard-blocks if any configured column ID no longer exists on the board.
- ⚠️ **Known convention deviations** (do not propagate): Planner's `absenceClassificationColumnId` is read as label TEXT not ID (`useEmployeeAbsences.ts:94-95`). ~~Day-off text-matching~~ **fixed 2026-06-09 (W1.2)**: Day-off now matches `kind`/`approvalStatus` by label ID (settings carry `generalLabelId`/`personalLabelId` + `statusValues.labelIds`; case-insensitive text fallback for legacy blobs), and an unmatched approval label throws `ApprovalStatusMismatchError` instead of silently defaulting to pending.

### 5.3 Settings & storage model
Every app stores a settings JSON (board IDs + column IDs + label mappings + behavior flags) in monday storage, edited via an in-app settings dialog with live board/column pickers. Two storage models coexist (a flagged standards divergence):
- **Global `monday.storage`** keyed `customSettings_${instanceId}`, instanceId = `context.instanceId || boardId || 'default'` — the standard (#17), used by tracker and Day-off via app-core.
- **`monday.storage.instance`** — Planner only (`planner_app_settings`, plus `planner-custom-holidays`); migration to global is pending.

⚠️ **monday storage is app-scoped.** One app can never read another app's settings blob. Cross-app configuration (e.g. "where is the vacations board?") must be distributed via provisioning or duplicated per-app settings — never via storage reads.

### 5.4 API access pattern
All apps funnel GraphQL through a single client-side queue/funnel with retry: Planner `services/apiQueue.ts` (mutations serialized +200ms, reads ≤3 concurrent, complexity handling) → `mondayService.ts`; tracker `utils/mondayApi/client.js` (`safeApi`); Day-off `services/mondayApi.ts` (`query()` funnel). These implement the **Monday-api-service contract** (standard #4) — a shared *shape*, not a shared package. Cursor pagination everywhere (items_page).

### 5.5 The 17 standardization decisions (`STANDARDS.md`)
1. React 19 + Vite 7 target. 2. TS not mandatory (per-app choice). 3. `monday-sdk-js` 0.5.7 client / `@mondaycom/apps-cli` 4.x / `@mondaycom/apps-sdk` is server-side only (sync-calender). 4. Monday-api-service = contract, each app implements its own layer. 5. Unified logger + Axiom for new apps. 6. Error UX = tracker model (ErrorBoundary + error-details modal + global handlers; every catch must log/throw/show). 7. i18next mandatory in bilingual apps + ESLint ban on Hebrew literals outside `t()`. 8. Settings storage per-app but documented in CLAUDE.md. 9. ESLint per-app + the two shared rules. 10. Vitest + coverage + `test:tz` (timezone matrix) in every app. 11-12. CLAUDE.md mandatory structure + meta sections (Description/Purpose/Technologies/Constants/Deploy). 13. Change tracking via the change-tracker skill (`/new_change`, `/close_change` → CHANGELOG.md). 14. Structural changes update ARCHITECTURE.md; bugs go to change-tracker, not CLAUDE.md. 15. Folder structure recommended (api → services → hooks/components). 16. env/deploy conventions documented only. 17. `@axis/app-core` shared package (§7.1).

**Doc compliance:** tracker + Day-off CLAUDE.md follow `CLAUDE-template.md`; **Planner and sync-calender CLAUDE.md are pre-template** (older formats). Agent-facing `.md` files are written in English.

### 5.6 Provisioning (הקמות)
The `monday-provision` skill builds a complete system: workspace + boards from `blueprints/boards.json` + structure presets (`structures.json`, e.g. `portfolio_full`) + rendered per-app settings JSON + demo seed data + a per-demo `CLAUDE.md` snapshot kept in sync with live API state. This is the **only existing mechanism that distributes stable column IDs/label IDs to multiple apps' settings** — the natural carrier for any new cross-app contract.

---

## 6. Per-component architecture

### 6.1 Planner

Pure client SPA, no router; entry `src/main.tsx` → `App.tsx` provider stack: `MondayContextProvider` (context, theme, permissions = `(isAdmin || isBoardOwner) && !isViewOnly`) → `SettingsProvider` → `ActiveProjectsProvider` → `CustomHolidaysProvider` → if configured, `GanttProvider` + `GanttContent`; else welcome screen auto-opening SettingsDialog (`App.tsx:95-168`).

**Central state:** `components/Gantt/GanttProvider.tsx` (~976 lines) — timeline, filters, modals, all data-hook wiring. Rows are virtualized via `useDataFlattener.ts` → `VirtualRowList`/`RowRenderer`. Two view modes: **projects** (allocation bars per project + collapsible company-load group) and **employees** (per-employee availability header row + load row).

**Data sources (3 independent fetch pipelines):**
1. **Allocation bars** — `useAllocations.ts`, 3-stage load: current window → background future → on-demand past. **Stages MERGE via `mergeAllocationsById`, never replace** (replace only on real board-id change, `useAllocations.ts:242-248`). This is the fix for the 2026-06-09 "multi-stage load clobber" bug (BUGS.md) — any new multi-stage loader must follow the merge rule.
2. **Workload items** — separate range-scoped fetch for load circles (`GanttProvider.tsx:474-527`, debounced, range-cached); **replaces** bars as the load source when non-empty (`useCompanyLoad.ts:72` fallback pattern).
3. **Absences + holidays** — see below.

**Load & availability math:**
- Per-employee daily capacity = `(FTE%/100) × maxHoursPerDay`, gated by `settings.workDays` (default Sun–Thu) — `useAvailability.ts:30-64` (`buildDayInfo`). Priority: weekend → holiday → **absence (zeroes the day, reason `absence` + classification)** → half-day holiday (×0.5) → workday.
- Role-level: absent employees **still count in the role capacity denominator** (free% drops); holidays are **excluded** from denominators. This asymmetry is deliberate (`useAvailability.ts:119-139`) and is the reason general company days and personal absences must travel **different pipelines**.
- Load accumulation (`useCompanyLoad.ts`, `useEmployeeLoad.ts`): per-day `hoursPerDay` bucketing under the employee's **official role** (not the allocation's role/capability); skips non-workdays only — **absence-unaware** (capacity-side handles absences at render: `CompanyLoadRow.tsx:38-84` reads per-day capacity from availability maps).
- Role (status) drives load bucketing; **Capability (dropdown) is a staffing filter only** in Allocation modals.
- ⚠️ Absence-blind spots (intentional/known): `useEmployeeLoad`, `useWorkloadCalculator`, `useCompanyLoad` accumulation, `useEmployeeAvailability` (AllocationModal preview), and totalHours↔hoursPerDay derivation ignore absences/holidays.

**Existing absence pipeline (read-only, fully working):** settings block `absenceReportBoardId` + employee/date/type/classification column mappings (`settings.types.ts:43-50`); fetch `mondayService.fetchAbsencesForRange:404-468` (single date column, `between`); reduce `useEmployeeAbsences.ts:39-126` → `Map<employeeId, Map<'YYYY-MM-DD', EmployeeAbsence>>`; **one item = one employee = one full day**; type matched by label ID; silently disabled (EMPTY_MAP) when not configured. Today it points at the **Time Logs board**. Verified: the ONLY producer is `useEmployeeAbsences`, the ONLY consumers are `GanttProvider:546` + `useAvailability:98` — swapping the source board touches just fetch+normalize+settings.

**Company holidays:** manual per-instance entries in `monday.storage.instance` key `planner-custom-holidays` (full/half-day, all blocking), managed in `CustomHolidaysManager` — invisible to other apps.

### 6.2 tracker

Hebrew-first RTL calendar (react-big-calendar + DnD), no backend. Provider tree: `ErrorBoundary → MondayProvider → SettingsProvider → ProjectColorsProvider → AppContent` (first-install wizard / calendar ↔ dashboard switch). Main view `MondayCalendar.jsx` (~1660 lines). ~60 settings keys in `SettingsContext.jsx:42-154` (DEFAULT_SETTINGS), merge-on-load.

**Board resolution:** `getEffectiveBoardId` 3-tier fallback (`utils/boardIdResolver.js`): use-current-board flag → configured `timeReportingBoardId` → context board.

**Event load:** `useMondayEvents.loadEvents` — items_page with rules: date `between` + default `reporter any_of ["assigned_to_me"]` (suppressed if user filters by reporter); only configured columns queried. Item → CalendarEvent: **all-day iff its primary-classification label ID maps to `allDay`** in `eventTypeMapping`; all-day display label+color come from `allDayTypeStatusColumnId`; duration parsed polymorphically (hours vs days); all-day end is exclusive midnight.

**Vacation reporting today (the flow the Day-off integration replaces):** all-day strip/cell click → `AllDayEventModal` (menu = live labels of `allDayTypeStatusColumnId`) → pick type + date range → `useAllDayEvents.createSingleAllDayEvent:337-488` writes **one Time Logs item per day**: name `"{type} - {reporter}"`, date-only, duration="1" (days), reporter, primary=`יומי` label ID, sub-type label ID, temporary=false, approval=pending if enabled. Edit changes sub-type only; delete via undo pipeline; future dates allowed (unlike timed).

**Read-only overlay pattern (the template for external absences):** Israeli holidays from @hebcal/core become synthetic events `{allDay:true, isHoliday:true, readOnly:true}` merged in `enrichedEvents` (`MondayCalendar.jsx:1316-1318`), guarded in click (:750) and drag/resize accessors (:1355-1369). ⚠️ Verified nuance: **all guards key off `isHoliday`, not `readOnly`** — `readOnly` is set but never consumed.

**Analytics (3 independent read paths):** calendar events; MonthlyBattery (`useMonthlyHours` — own query; counts all-day as `days × workdayLength` toward the monthly target); Dashboard (`useDashboardData` — own query; **excludes** all-day at API level). Approval workflow (status column + manager IDs) applies to all-day items too. Excel export, edit-locking, undo-delete, multi-select, SettingsWizard that can auto-create the full board structure (`useBoardBuilder`).

### 6.3 Day-off

Fully implemented absence app (its CLAUDE.md/ARCHITECTURE.md were brought back in sync 2026-06-10, W1.6; `Day-off/CONTRACT.md` is the normative board contract). Boot: `bootstrapApp` (app-core) → providers → `DayOffDataProvider` (single data context, ~30-field surface) → `DayOffView` (role tabs). Views: My absences (month calendar + list), Team Gantt, Approvals inbox (+approve-all), Dashboard (workday breakdowns + drill-down); company days managed inside Settings.

**Flows:** employee submits request (type from dynamic status labels; date range; note; file attachment) → item created with kind=personal, approval=pending; edit resets to pending; cancel = **hard delete**. Manager approve/reject writes approval label + decidedBy/decidedAt/managerNote. Settings can rewrite the board's type labels via `update_status_column` (add/rename/recolor/deactivate, with in-use guard). Roles come from `settings.teams[]` (manager/employee monday user IDs) — not from the board.

**Domain semantics:** workdays = non-Fri/Sat days in range (does NOT subtract company holidays — informational only); balance used = approved workdays; entitlements/quotas **removed** (2026-06-03); whole-day granularity only (no half-days anywhere).

**Integration surface: NONE.** No backend, no exports, no webhooks; settings blob unreadable by other apps (§5.3). The only shared surface is the vacations board itself. Consumers must duplicate the board+column+label mapping in their own settings (provisioning-distributed) and reimplement the read semantics — see the integration plan.

### 6.4 sync-calender

Node/Express server on monday-code + React admin SPA at `/admin`. One-way sync: Google Calendar / Microsoft Outlook → items on an owner-chosen monday board (in Axis deployments: the Time Logs board). Per-user OAuth (popup), provider push webhooks (`/webhook/calendar`, `/webhook/microsoft`), self-healing channel-renewal cron (×2 daily) with disconnect classification + owner/user notifications. Event identity lives on the board (Link-column lookup, no per-event storage). Provider abstraction `src/services/provider.js` (google + microsoft fully implemented).

⚠️ Relevant to absences: **only RSVP-accepted, non-all-day events sync** — all-day events are filtered out by design (`providers/google/calendar.js:93-96`), so vacation entries as all-day calendar events never flow through this app. Coupling to tracker is purely data-level (writes items the tracker reads); the `temporary` checkbox marks synced placeholder events users convert to real reports in tracker.

### 6.5 Services/

| Package | What it is | Consumed by |
|---|---|---|
| **axis-app-core** (`@axis/app-core`) | The only runtime-shared package. Raw-TS-source library (consumed via pnpm `link:` + Vite alias + `resolve.dedupe` react/react-dom — no build step). Exports: `bootstrapApp`/`polyfillGlobal`, `MondayProvider`/`useMondayContext` (+permissions), `createSettings<T>()` (global-storage settings factory + `SettingsDialogShell` generic tabbed dialog w/ JSON export-import), `createLogger` (ring buffer, sinks, optional Axiom transport), error pipeline, `createApiQueue`, storage primitives. **Contains ZERO GraphQL/board-data code** — transport only. | Day-off (full), tracker (storage primitives only), Planner (not yet), sync-calender (no) |
| **Monday-api-service** (`monday-app-services`) | A **contract + reference implementation**, NOT a dependency — zero apps import it. Each app implements its own API layer following its shape (standard #4). | nobody (by design) |
| **sync-calender-status** | Deployed ops hub: daily GitHub Actions cron regenerates a static health dashboard (GitHub Pages) from Axiom datasets; one config folder per registered app (currently only sync-calender). | — |
| **_axiom-dashboard-template** | Copy-paste scaffold (Node Axiom logger + hub template); defines the log-field conventions (`tag/acc/usr/cfg/obj/prv`). | — |

---

## 7. Cross-component contracts (current state)

| Contract | Producer → Consumer | Mechanism |
|---|---|---|
| Allocations hinge | Planner writes → tracker reads (assignments mode) | Shared board; shared people/board_relation/date columns |
| Reported hours mirror | tracker writes Time Logs → Planner reads per-allocation actuals | Mirror column over board_relation (comma-separated values summed) |
| Absence rows (today) | tracker writes `יומי` items → Planner's absence pipeline reads | Time Logs board; Planner settings point `absenceReportBoardId` at it |
| Planned events | sync-calender writes → tracker reads/converts | Time Logs board; `temporary` checkbox |
| Project source | Portfolio → both apps | board_relation + settings |
| Infrastructure | app-core → Day-off/tracker | `link:` source package |
| Observability | apps → Axiom → status hub | Structured logs, shared field conventions |

---

## 8. Absence handling today — three disconnected sources (the problem the Day-off integration solves)

1. **Personal absences:** reported in **tracker** as Time Logs items (primary=`יומי`, sub-type חופשה/מחלה/מילואים, one item/day) → consumed by **Planner**'s absence pipeline (zeroes capacity). Approval via tracker's generic workflow.
2. **Company holidays in Planner:** manual per-instance entries in `monday.storage.instance` (`planner-custom-holidays`) — invisible to tracker/Day-off.
3. **Holidays in tracker:** client-computed @hebcal Israeli holidays, display-only overlay; plus whatever company days exist nowhere else.
4. **Day-off** manages personal requests + general company days on its own vacations board — which **nothing else reads yet**.

Target state, contract, change points, migration: see **`DAY-OFF-INTEGRATION-PLAN.md`**.

---

## 9. Stale-documentation ledger (verified 2026-06-09 — do NOT trust these claims)

| Doc | Stale claim | Reality |
|---|---|---|
| `axis-system-map.html` | Whole file: no Day-off, no app-core, no board model; tracker "React 18/Vite 6", "Board View" | Superseded by this document |
| ~~`Day-off/CLAUDE.md` §2~~ | ~~"Minimal skeleton today"~~ | **Fixed 2026-06-10 (W1.6)** — doc now states full app |
| ~~`Day-off/ARCHITECTURE.md` §5~~ | ~~3 boards (requests/company-days/entitlements), Timeline column, "no file upload", CompanyDaysView~~ | **Fixed 2026-06-10 (W1.6)** — doc now states single board, two date columns, upload implemented (2026-06-05), company days inside Settings, quotas removed (2026-06-03) |
| `tracker/CLAUDE.md` §4 | `REQUIRED_EVENT_TYPE_LABELS` = 6 labels; `ALL_DAY_EVENT_TYPES` in durationUtils | Code: 3 labels `['שעתי','לא לחיוב','יומי']` (`eventTypeValidation.js:17`); durationUtils is mapping/index-based |
| `Planner/CLAUDE.md` | Pre-template format; hook list stale (`useEmployeeAvailability` listed; absence hooks missing) | Actual hooks: `useEmployeeAbsences`, `useAvailability`, `useHolidays`, `useCustomHolidays` |
| `sync-calender/CLAUDE.md` | `legacy/block-based/` exists; flat services module layout | Directory absent on disk; code refactored into `providers/` tree |
| `Planner/src/types/entities/employee.types.ts:2` | id "usually name for now" | `Employee.id = userId \|\| item.id` |
| ~~`DayOffDataProvider.tsx:6`~~ | ~~References `CONTRACT.md`~~ | **Resolved 2026-06-10 (W1.6)** — `Day-off/CONTRACT.md` now exists (the normative absence contract); the reference is valid |
| Provision skill `planner-settings.json` on disk | Column IDs | Stale vs live demo; re-export before reuse |

---

## 10. Working on this system (agent checklist)

1. Read the target app's `CLAUDE.md` + `ARCHITECTURE.md` (mind §9 above), then verify against `src/`.
2. Code changes go through the change-tracker workflow (`/new_change` → work → `/close_change`); structural changes must update the app's ARCHITECTURE.md (standard #14).
3. Respect the per-app API funnel — never call `monday.api` directly outside it.
4. Status columns: label IDs, `settings` not `settings_str`, `create_labels_if_missing` for string writes.
5. Multi-stage data loaders must **merge, never replace** (Planner BUGS.md 2026-06-09).
6. i18n: no Hebrew literals outside `t()` (ESLint-enforced); every catch must log/throw/show.
7. Run the app's tests incl. `test:tz` before closing a change; tracker has ~855 tests that lock current behavior — gate new behavior behind settings flags.
8. Provisioning/demo work goes through the `monday-provision` skill; per-demo CLAUDE.md snapshots must stay true after every mutation.
9. Only one of Planner/tracker/Day-off can dev-tunnel at a time (shared port 8301).
