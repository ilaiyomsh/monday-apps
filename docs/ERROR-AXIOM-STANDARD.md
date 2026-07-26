# Error handling & Axiom shipping — the unified standard

One standard for every app in this monorepo, **from catching an error to shipping it
to Axiom**. This document is the map + adoption status; the **authority on the pattern
is the `error-guard` skill** (`.claude/skills/error-guard/`) and its
`references/remote-monitoring.md`. When the two disagree, the skill wins — fix this doc.

## The goal

Every app catches errors the same way, ships the same shape to the same place, and is
held to it by the same enforcement. No per-app transport, no naive fetch, no silent
swallow, no privacy leak.

## The two layers

### 1. Catch (per app)
The Tracker error model, identical across apps:
- **`ErrorBoundary`** — render-time throws (mounted `scope="root"` above all providers).
- **`setupGlobalErrorHandlers()`** — `window.onerror` + `unhandledrejection` +
  resource-load failures, called **before** render.
- **`useErrorHandler` / UI error sink** — one caught error → exactly one toast.
- Every `catch` does exactly one of `logger.*` / `throw` / display. Only `AbortError`
  is silent.

For app-core apps these come from `@axis/app-core` (`ErrorBoundary`,
`setupGlobalErrorHandlers`, `useErrorHandler`). Non-app-core apps use the equivalent
error-guard templates.

### 2. Ship (shared, one mechanism)
All client-side shipping goes through the **single hardened transport**
`createAxiomBrowserTransport` (`@axis/app-core/src/axiomTransport.ts`) — batching,
exact-key sanitizer/allowlist, circuit breaker, dedup, session cap, keepalive flush.

The bridge from logger → transport is the shared sink **`attachAxiomSink`**
(`@axis/app-core/src/errors/axiomSink.ts`). Wire it once in the app entry, before render:

```ts
// core.ts — read the gate env in one place
export const axiomEnv = {
  app: 'my-app',
  dataset: import.meta.env.VITE_AXIOM_DATASET ?? 'app-errors',
  token: import.meta.env.VITE_AXIOM_TOKEN,
  appVersion: import.meta.env.VITE_APP_VERSION,
  environment: import.meta.env.VITE_ENVIRONMENT,
};

// main.tsx — BEFORE bootstrapApp/render
attachAxiomSink(logger, axiomEnv);
```

App-core's `MondayProvider` auto-enriches every envelope with iframe identity
(`usr`/`obj`/`board`) — no per-app wiring needed.

> **Retired:** the old naive `shipAxiom` per-record `fetch` inside `createLogger` is
> gone. It had no batching/breaker/sanitizer and serialized the full record (a privacy
> leak). Do not reintroduce a raw fetch to Axiom anywhere.

The shipped `stack1` is a single **minified** frame. To read it as `File.jsx:line`,
every client bundle builds `sourcemap: 'hidden'` and CI archives the maps as an
artifact (never served) — resolve on demand with
`.claude/skills/axiom-sre/scripts/symbolicate '<stack1>' --app <app> --ver <ver>`.
See `LOGGING-ARCHITECTURE.md` §6.

## Dataset model (fixed decision)

**ONE shared dataset `app-errors` for the whole portfolio**, discriminated by the `app`
field (`tracker`, `day-off`, …). The ingest token is scoped to append-only on
`app-errors`, so baking it into the client bundle is an accepted risk. No alerting —
dashboards + ad-hoc `axiom-sre` queries only.

## Activation gate

The sink ships **only** when `import.meta.env.PROD === true` **and** both
`VITE_AXIOM_DATASET` and `VITE_AXIOM_TOKEN` are baked into the bundle. Dev server,
tunnel, and vitest are structurally inert (transport null, `attachAxiomSink()` no-op).

| Var | Value | Source |
|---|---|---|
| `VITE_AXIOM_DATASET` | `app-errors` (literal) | CI build env |
| `VITE_AXIOM_TOKEN` | ingest token | GitHub secret `AXIOM_INGEST_TOKEN` |
| `VITE_AXIOM_APP` | app slug (non-app-core apps) | CI build env |

CI injection lives in each client app's deploy workflow Build step
(`.github/workflows/deploy-{draft,live}-*.yml`). A missing secret → empty token →
inert gate (fail-soft), so wiring is safe before the token exists.

## One-time setup (USER ONLY — agents never touch tokens)

1. In Axiom, create the dataset **`app-errors`**.
2. Create an **ingest-only** token scoped to `app-errors`, named `app-errors-ingest`.
3. Add it to GitHub repo secrets as **`AXIOM_INGEST_TOKEN`**.
4. (Server apps) set `AXIOM_TOKEN` / `AXIOM_DATASET=app-errors` / `AXIOM_APP_NAME=<slug>`
   via `mapps code:env` — server ships at runtime through `@axiomhq/js`, not at build.

**Acceptance test per app:** in a prod build, `setTimeout(() => { throw new Error('axiom-acceptance'); })`,
confirm `getAxiomStats().shipped > 0`, then query `['app-errors'] | where app == '<slug>'`.
**Incident mode:** `window.setRemoteLevel('DEBUG')` (client) ships everything, persists
across reload; `setRemoteLevel(null)` restores WARN/ERROR-only.

## Enforcement

- **PostToolUse hook** — `.claude/hooks/error-guard-check.sh` (registered in
  `.claude/settings.json`) runs the gate on every JS/JSX/TS/TSX edit. Wired and quiet;
  skips files with a live `.mutbak` sibling (test-guard interop).
- **ESLint kit** (per app): `no-console`, `no-empty` (no empty catch), `catch-must-log`,
  `promise/catch-or-return` (+ `no-floating-promises` on TS). Exemptions: logger file,
  `*Sink*`, transport, tests, build config. Templates in
  `.claude/skills/error-guard/templates/eslint-error-rules{,-node}.json`.
- **Ship gate** — a `.error-guard` marker file in an app makes `mapps` ship run a
  blocking whole-tree `audit.sh`.

> **Known gap (enforcement not yet live):** the skill's `check.sh`/`audit.sh` were
> written for ESLint 8 (`--no-eslintrc --config <json>`); these apps run **ESLint 9
> flat config** (`eslint.config.js`), so the gate currently **fails open** (never
> blocks). Two follow-ups make it live: (1) port `check.sh`/`audit.sh` to emit a flat
> config and drop the removed flags — a source fix in the `error-guard` skill per its
> §Self-correction rule 3; (2) per app, install the kit plugins so they resolve
> (`eslint-plugin-promise`, `@typescript-eslint/parser` for TS apps). Until then the
> hook is scaffolding, not a guarantee. Do not treat a quiet hook as "compliant."

## Adoption status & roadmap

| App | Catch | Ship | Dataset | Next |
|---|---|---|---|---|
| **tracker** | ✅ local (boundary+global+UI sink) | ✅ hardened transport | → `app-errors` (was `axis-prod`) | verify migration |
| **day-off** | ✅ app-core | ✅ **now** via `attachAxiomSink` (was naive) | `app-errors` | — |
| **discussions** | ✅ local (matches model) | ❌ none (sink-ready) | — | add sink |
| **planner** | ❌ no boundary/global; bare console logger | ❌ none | — | full retrofit |
| **sync-calender** | ⚠️ per-route try/catch; SIGTERM guards only | ✅ server SDK (own dataset) | own → `app-errors` | process guards + errorMiddleware; move to `app-errors` |

**Stage 1 (done):** unify the client transport in app-core, retire the naive path,
rewire day-off, wire CI injection, this doc + enforcement.
**Stage 2+ (per-app retrofit rounds, one app per branch):** discussions sink → planner
full stack → sync-calender server hardening + shared dataset → tracker dataset cutover.
Each round follows `/error-guard retrofit <app>`.
