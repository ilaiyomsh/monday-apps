# Error handling & Axiom shipping — the unified standard

One standard for every app in this monorepo, **from catching an error to shipping it
to Axiom**. This document is the map + adoption status + runbooks; the **authority on the
pattern is the `error-guard` skill** (`.claude/skills/error-guard/`) and its
`references/remote-monitoring.md`. When the two disagree, the skill wins — fix this doc.

## The goal

Every app catches errors the same way, ships the same shape to the same place, and is
held to it by the same enforcement. No per-app transport, no naive fetch, no silent
swallow, no privacy leak.

## Architecture — one shipping layer, three delivery mechanisms

The canonical implementation lives in **`packages/error-kit` (`@mapps/error-kit`)** — the
hardened browser transport, the logger→transport sink, the React `ErrorBoundary`, the
global error handlers, and the reference server sink. It is compiled to `dist/` (ESM + d.ts)
so both Vite and CRA/webpack consumers can import it. It carries 5 hardening fixes over the
old app-core version: `droppedShipFailure` stat, terminal flush with an open breaker,
extended `stack` (top-5, cap 1500) + `component_stack` (cap 1000), the `ErrorBoundary`
shipping `componentStack`, and a dedup key that includes `err_name`+`err_msg`.

How each surface gets that code depends on how it deploys:

1. **Pure client apps (CDN) — import the package directly.**
   discussions, planner, team-people-column import `@mapps/error-kit/browser` (+ `/react`)
   through a thin per-app **domainKind→kind adapter** (their logger's record shape → the
   sink's). Vite bundles the package into the client build.

2. **Axis apps — import through the `@axis/app-core` facade.**
   `app-core` re-exports error-kit (`attachAxiomSink`, `ErrorBoundary`,
   `setupGlobalErrorHandlers`, transport). tracker and day-off consume it; `MondayProvider`
   auto-enriches every envelope with iframe identity.

3. **Server apps + their embedded admin SPAs — keep a VENDORED copy.**
   monday-code deploys push the app **root only**, so a workspace dependency does **not**
   resolve at runtime. sync-calender, deadline-confirm and telemetry-dashboard therefore keep
   a LOCAL copy of the stack (server sink in JS; the admin SPA's transport/sink/handler in
   TS). **Why this is safe:** `packages/error-kit/test/drift.test.ts` imports every vendored
   copy by relative path and asserts the shared behavioral contract against it — so a copy
   can never silently rot. It tests **behavior, not bytes**: legitimate divergences
   (domainKind adapters, the per-consumer `VITE_AXIOM_*` gate, per-app `CTX_ALLOW` supersets)
   are accommodated; the load-bearing guarantees are enforced.

> **Retired:** the old naive `shipAxiom` per-record `fetch` inside `createLogger` is gone —
> no batching/breaker/sanitizer, serialized the full record (a privacy leak). Never
> reintroduce a raw fetch to Axiom anywhere but the sanctioned transport/query files.

## Dataset model (fixed decision)

**ONE shared dataset `app-errors` for the whole portfolio**, discriminated by the `app`
field (`tracker`, `day-off`, `sync-calender-admin`, …). The ingest token is scoped
append-only on `app-errors`, so baking it into the client bundle is an accepted risk. No
alerting — dashboards (telemetry-dashboard) + ad-hoc `axiom-sre` queries only.

## Per-surface adoption — all surfaces ✅

| # | Surface | Kind | Delivery | Wiring / adapter file |
|---|---|---|---|---|
| 1 | `@mapps/error-kit` | package | canonical | `packages/error-kit/src/{browser,react,server}` |
| 2 | `@axis/app-core` | facade | re-export | `apps/axis/services/app-core/src/errors/*` |
| 3 | axis-tracker | client | app-core/local | `apps/axis/tracker/src/utils/{axiomSink,globalErrorHandler}.js` |
| 4 | axis-day-off | client | app-core | `apps/axis/day-off/src/main.tsx` (`bootstrapApp` + `attachAxiomSink`) |
| 5 | axis-planner | client | package | `apps/axis/planner/src/utils/errorReporting.ts` (`initErrorReporting`) |
| 6 | discussions | client | package | `apps/discussions/src/utils/axiomLoggerAdapter.js` |
| 7 | team-people-column | client | package | `apps/team-people-column/src/utils/axiomLogger.js` |
| 8 | sync-calender admin SPA | client | vendored | `apps/axis/sync-calender/src/client/admin/utils/*` |
| 9 | deadline-confirm admin SPA | client | vendored | `apps/deadline-confirm/src/client/admin/utils/*` |
| 10 | telemetry-dashboard client | client | vendored | `apps/telemetry-dashboard/src/client/utils/*` |
| 11 | sync-calender server | server | vendored | `apps/axis/sync-calender/src/services/axiomServerSink.js` |
| 12 | deadline-confirm server | server | vendored | `apps/deadline-confirm/src/helpers/axiomServerSink.js` |
| 13 | telemetry-dashboard server | server | vendored | `apps/telemetry-dashboard/src/helpers/axiomServerSink.js` |

Every client surface has: a root `ErrorBoundary`, `setupGlobalErrorHandlers()` +
`attachAxiomSink()` before render, identity enrichment. Every server has: process guards
(`uncaughtException` + `unhandledRejection`), a terminal 4-arg error middleware, and an
**opts-injected** sink (zero `process.env` reads inside the sink — index.js injects the
config). See `openIssues` for the two remaining activation follow-ups.

## Activation gate

**Client:** the sink ships only when `import.meta.env.PROD === true` **and**
`VITE_AXIOM_DATASET` + `VITE_AXIOM_TOKEN` (+ `VITE_AXIOM_APP` for non-app-core apps) are
baked into the bundle. Dev server, tunnel, and vitest are structurally inert.

| Var | Value | Source |
|---|---|---|
| `VITE_AXIOM_DATASET` | `app-errors` | CI build env |
| `VITE_AXIOM_TOKEN` | ingest token | GitHub secret `AXIOM_INGEST_TOKEN` |
| `VITE_AXIOM_APP` | app slug | CI build env |

CI injection lives in each client app's deploy workflow **Build** step
(`.github/workflows/deploy-{draft,live}-*.yml`). A missing secret → empty token → inert
gate (fail-soft), so wiring is safe before the token exists.

**Server:** the sink is opts-injected and inert unless `AXIOM_TOKEN` + `AXIOM_DATASET` +
`AXIOM_APP_NAME` are present at runtime — read by `index.js` (via the monday-code
`EnvironmentVariablesManager`) and passed to `attachAxiomServerSink(logger, {...})`.

## Runbooks

### One-time setup (USER ONLY — agents never touch tokens)
1. In Axiom, create the dataset **`app-errors`**.
2. Create an **ingest-only** token scoped to `app-errors`.
3. Add it to GitHub repo secrets as **`AXIOM_INGEST_TOKEN`** (client builds read it).
4. Server apps — set runtime env on the platform (not in files):
   - sync-calender: `mapps code:env -i 11666315 -m set -k AXIOM_TOKEN -v <tok>` and
     `-k AXIOM_DATASET -v app-errors` and `-k AXIOM_APP_NAME -v sync-calender`.
   - telemetry-dashboard: same three keys (`AXIOM_TOKEN`, `AXIOM_DATASET=app-errors`,
     `AXIOM_APP_NAME=telemetry-dashboard`) once its App ID / secret is provisioned.
   - deadline-confirm: same three keys against its app id (`mapps code:env -i 11704868`).

### Acceptance test (per app, prod build)
`setTimeout(() => { throw new Error('axiom-acceptance'); })`, then confirm client
`getAxiomStats().shipped > 0`, and query `['app-errors'] | where app == '<slug>'`.

### Incident mode
`window.setRemoteLevel('DEBUG')` (client) ships everything and persists across reload;
`setRemoteLevel(null)` restores the WARN/ERROR-only default. Server: pass
`LOG_SHIP_LEVEL=DEBUG|INFO` via env, then unset after the investigation.

## Onboarding a NEW app

**Client app**
1. Delivery: a **pure CDN client** imports `@mapps/error-kit/browser` (+ `/react`) with a
   domainKind→kind adapter; an **axis app** consumes `@axis/app-core`; a **server-embedded
   SPA** vendors the TS copy (transport + sink + globalErrorHandler) and adds a drift entry.
2. Entry: call `setupGlobalErrorHandlers(logger)` then `attachAxiomSink(...)` **before**
   `createRoot().render`; wrap the tree in a root `ErrorBoundary`; call `setAxiomContext`
   once identity resolves.
3. Add a `SURFACES` entry in `scripts/error-wiring-audit.mjs` (entry path, render marker,
   boundary dir, workflow, `deployEnv`).
4. CI env: add `VITE_AXIOM_DATASET`/`VITE_AXIOM_TOKEN`/`VITE_AXIOM_APP` to the app's deploy
   workflow Build step.
5. If vendored: add the copy to `packages/error-kit/test/drift.test.ts` `BROWSER_SURFACES`.

**Server app**
1. Vendor `axiomServerSink.js` (opts-injected), `process-guards.js` (uncaughtException +
   unhandledRejection), and a terminal 4-arg error middleware.
2. `index.js` resolves `AXIOM_*` via the env manager and passes them to
   `attachAxiomServerSink(logger, {...})`; installs the process guards; drains via
   `flushAxiom` on shutdown.
3. Add a server `SURFACES` entry in the audit script and a `SERVER_SURFACES` drift entry.

## Enforcement (graduated)

| Layer | Mechanism | Status |
|---|---|---|
| Structural wiring | `node scripts/error-wiring-audit.mjs` in `ci.yml` | **BLOCKING** |
| Drift + kit unit tests | `pnpm --filter @mapps/error-kit test` in `ci.yml` | **BLOCKING** |
| Per-edit gate | `.claude/hooks/error-guard-check.sh` → `check.sh` (no-console, catch-must-log, no-empty) | active (agent sessions) |
| Per-app ESLint kit (CI lint) | flat-config kit per app | **visibility-only, pending debt** (planner lint 268, day-off lint 8 — `apps/axis/docs/FOLLOW-UPS.md`) |
| Ship gate | `.error-guard` marker → whole-tree `audit.sh` on ship | per app |

The audit script and error-kit tests are the two blocking gates that make the standard
real in CI (the whole-workspace test job stays non-blocking visibility). The per-app ESLint
kit remains visibility-only until the standing lint debt is cleared.

## openIssues (real gaps found, tracked for the owner)

- **deadline-confirm admin SPA — client sink inert in prod.** The deadline-confirm deploy
  workflows build the admin SPA **without** injecting `VITE_AXIOM_*`, so its (correctly
  wired) client error sink never activates in production. Fix: add the three `VITE_AXIOM_*`
  env vars to the Build step of `deploy-{draft,live}-deadline-confirm.yml` (mirror
  sync-calender; suggested `VITE_AXIOM_APP: deadline-confirm-admin`). Surfaced by the audit
  as a ⚠ known gap (not failed) pending the owner's app-name decision.
- **sync-calender server dataset.** Ships via the opts-injected server sink but its runtime
  `AXIOM_*` env still needs the user's `mapps code:env` change to land on `app-errors`.
- **telemetry-dashboard was drifted — corrected 2026-07-21.** Its vendored client transport
  was the pre-fix version (missing all 4 transport hardening fixes) and its server sink read
  `process.env` at module load. Both were re-vendored/migrated to the canonical model and are
  now drift-tested. Production push is still gated on the `APP_TELEMETRY_DASHBOARD_ID` secret.
