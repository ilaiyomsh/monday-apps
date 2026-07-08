# Remote error monitoring — wiring any app to Axiom

Caught ≠ monitored. This page closes the gap: every app's WARN/ERROR records ship
to ONE shared Axiom dataset, discriminated by an `app` field. Decided with the user
2026-07-07: **direct browser→Axiom (the Tracker model) for client apps, one shared
errors dataset for the whole portfolio, dashboards/queries only (no alerting for now).**

## The architecture (fixed decisions — do not re-litigate)

| Decision | Value | Why |
|---|---|---|
| Client transport | Direct browser → `api.axiom.co` ingest (Tracker model) | Verified design (change #121, 69 tests); no proxy server to build/run |
| Token exposure | Ingest-only token IS visible in the client bundle | Accepted risk: token can only append to the errors dataset; revoke+rotate runbook below |
| Dataset topology | ONE shared dataset for all apps' errors: **`app-errors`** | One user-side setup, zero-touch onboarding for every next app; `app` field discriminates |
| Alerting | None (dashboards + ad-hoc queries via `axiom-sre`) | User decision 2026-07-07; revisit on request |
| Full observability (INFO firehose, per-app dashboards) | NOT this page | That stays `add-to-status-hub` (per-app datasets, the status hub) |

CSP: **verified 2026-07-07** — monday-code hosting serves app documents with NO
`content-security-policy` header (only its 301 redirects carry `default-src 'none'`,
which doesn't govern the document) and no `<meta>` CSP. Direct fetch to
`api.axiom.co` from inside the monday iframe is not blocked. If monday ever adds a
CSP, the transport fails soft (breaker opens, one console breadcrumb per batch, app
unaffected) — and the `endpoint` option is the proxy-pivot knob.

## One-time setup (USER ONLY — agents never touch tokens)

Done once for the whole portfolio, in the Axiom UI (axiom.co):
1. Create dataset **`app-errors`**.
2. Create an API token, **ingest-only**, scoped to the `app-errors` dataset only.
   Name it `app-errors-ingest`.
3. Keep the token wherever you keep secrets; paste it per app as below. Never
   commit it, never paste it into chat.

## Wiring a CLIENT app (React/Vite — column views, board views, widgets)

Prereq: the app has the error-guard logger installed (`templates/logger.js` — i.e.
it is scaffolded or retrofitted). Then:

1. Copy `templates/axiomBrowserTransport.js` + `templates/axiomErrorSink.js` into
   `src/utils/` (same dir as `logger.js`).
2. In the app entry (`index.jsx` / `main.jsx`), synchronously during module
   evaluation, BEFORE `createRoot(...).render`:
   ```js
   import { attachAxiomSink, setAxiomContext } from './utils/axiomErrorSink';
   attachAxiomSink();
   ```
   And once the monday SDK context loads (wherever the app already gets it):
   ```js
   setAxiomContext({ accountId, userId, boardId, instanceId });
   ```
3. Create `.env.production.local` (git-ignored — verify before writing it):
   ```
   VITE_AXIOM_DATASET=app-errors
   VITE_AXIOM_TOKEN=<user pastes app-errors-ingest>
   VITE_AXIOM_APP=<app-slug>
   ```
   The values are baked into the production bundle at build time. The activation
   gate requires `PROD && DATASET && TOKEN && APP` — dev server, tunnel, and vitest
   are structurally inert.
4. ESLint: the sink + transport files get the standard sink-file `no-console`
   exemption (see `eslint-rules.md` §overrides).
5. If the app's ESLint kit predates this page, nothing else changes — the sink
   plugs into `logger.addSink`, the logger is untouched.

What ships (per non-duplicate WARN/ERROR record): `level`, `tag` (module),
`message` (stable English event id), `kind`, `corr`, `err_name`, `err_code`,
`stack1` (first frame only), numeric timings, plus transport-stamped
`app/env/ver/sess` and `acc/usr/obj/board` context. The transport's exact-key
allowlist + deny-substring sanitizer make free-text/PII structurally unshippable —
`record.data`, GraphQL payloads, `error.message`, and Hebrew user messages never leave
the browser.

Guards built in (all verified by the Tracker test suite the code was ported from):
batching (20 events / 60KB / 5s), queue cap 100 drop-oldest, dedup 5-per-minute per
(level|tag|message), session cap 300, circuit breaker (3 failures → 60s open),
keepalive flush on tab hide/close, HMR dispose-and-replace.

## Wiring a SERVER app (Express on monday-code — integration apps)

Prereq: the server templates installed (`templates/server/` — logger, sink, guards;
see `server-patterns.md`). Then:

1. `npm install @axiomhq/js`
2. The entry already calls `attachAxiomServerSink(logger)` and
   `installProcessGuards(logger, { flush: flushAxiom })` if it came from the
   integration-scaffold; for a retrofit, add both (guards FIRST, top of entry).
3. Env vars (user runs these — token stays out of agent hands):
   ```bash
   mapps code:env -i <APP_ID> -m set -k AXIOM_TOKEN -v <app-errors-ingest>
   mapps code:env -i <APP_ID> -m set -k AXIOM_DATASET -v app-errors
   mapps code:env -i <APP_ID> -m set -k AXIOM_APP_NAME -v <app-slug>
   ```
4. Ship policy: WARN/ERROR. Incident mode: `LOG_SHIP_LEVEL=DEBUG` env (unset after).

## Acceptance test (per app, after wiring)

A deliberate test error in the deployed app must appear in Axiom within ~1 minute,
exactly once, with `app`, `tag`, `corr`. Client: throw a REAL error (synthetic
events don't exercise the pipeline) — in the production app's console run
`setTimeout(() => { throw new Error('WZ-axiom-acceptance'); })`, confirm
`getAxiomStats()` shows `shipped > 0`, then query Axiom:

```
['app-errors'] | where app == '<app-slug>' | where message contains 'WZ-axiom-acceptance'
```

Log-once check: the error must appear ONCE (one record, `duplicate` never ships).

## Incident mode (production diagnostics)

- Client: `window.setRemoteLevel('DEBUG')` in the app's console (persists across
  reload via localStorage; `setRemoteLevel(null)` restores). `window.getAxiomStats()`
  shows queued/shipped/breaker.
- Server: `LOG_SHIP_LEVEL=DEBUG` env var; unset after.
- Querying/triage: the `axiom-sre` skill; filter `app == '<slug>'`.

## Token compromise runbook (the accepted-risk mitigation)

The client token is public by design. If someone floods `app-errors` with junk:
1. Axiom UI → API tokens → revoke `app-errors-ingest`. Apps fail soft instantly
   (breaker opens; zero user impact — verified failure mode, the transport never
   throws to the app).
2. Create a new ingest-only token, update each wired app's env
   (`.env.production.local` / `mapps code:env`), rebuild+redeploy clients via the
   ship procedure.
3. Junk cleanup: Axiom data is immutable — filter it out by time window + `sess`
   field in queries/dashboards.

## Boundary with add-to-status-hub

- **error-guard (this page):** error records → the shared `app-errors` dataset.
  Zero-touch per app. This is the "caught → monitored" closure.
- **add-to-status-hub:** full operational observability — INFO event streams
  (webhook_received / sync_done), per-app dataset `<slug>-prod`, hub dashboard
  registration. Opt-in per app when the user wants a dashboard, costs one manual
  dataset+token creation per app.
- An app can have both: two sinks on the same logger, two datasets, no conflict.
