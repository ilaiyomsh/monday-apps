# telemetry-dashboard

An **access-controlled** monday-code app that visualizes **usage** and **error**
telemetry from the Axiom **`app-errors`** dataset — broken down **by account** and
**by app** — for the operator's own monday users.

It is a hybrid app in the mold of `apps/deadline-confirm` and
`apps/axis/sync-calender`: an Express server (monday-code) that serves a built
Vite + React 18 + Recharts dashboard at `/` and exposes a single authenticated
data endpoint.

## What it shows (12 panels)

- **Filter bar** — app multi-select, account multi-select, kind, time window
  (24h / 7d / 30d / 90d), theme toggle (light / dark / system), refresh + freshness stamp.
- **KPI row** — total / errors / usage / health / distinct accounts / distinct apps / error rate.
- **Errors by app** (sorted bar) and **Errors by account** (sorted bar, top 15 + Other).
- **Errors over time** (stacked area by app).
- **Top errors** table (name / message / count / apps affected; click a row to cross-filter).
- **Usage by app** and **Usage by account**.
- **Top usage events** (view_open vs track).
- **Boot health** (p50 → p95 dot-range per app).
- **API latency** (100% stacked per app across fast / ok / slow / very_slow — status palette).
- **App × Account volume heatmap** (single-hue sequential).

The categorical palette (7 apps + Other), the status palette, and light/dark
chrome come from the validated data-viz reference palette; charts are sorted,
directly labeled, legended, and theme-aware.

## Security model — access-controlled, NOT public

This app serves **real per-account telemetry only through an authenticated
endpoint**. It is private by construction:

- **`GET /api/telemetry?window=<24h|7d|30d|90d>`** verifies the caller's **monday
  session token first** (JWT signed with the app's Client Secret; identity under
  `dat.account_id` / `dat.user_id`). Missing/invalid token → **401**, no data. An
  optional `ALLOWED_ACCOUNT_IDS` allowlist further restricts which accounts may read
  (**403** otherwise). The client obtains the token via the monday SDK
  (`monday.get('sessionToken')`) and sends it in `Authorization`.
- The **Axiom read token + org + dataset live only in server env** (read via the
  SDK's `EnvironmentVariablesManager` / `process.env`). They are **never** in the
  client bundle, **never** committed, **never** logged.
- **No public publishing.** No GitHub Pages, no committed real-data JSON. The only
  committed data is the **synthetic seed** (`src/client/data/seed.js`) — a
  generated demo dataset with **no real account identifiers** — used as a
  dev/demo fallback.
- Access control is structural: the dashboard runs **inside monday**, behind
  monday auth, behind the session-token gate.

### Seed / demo mode

When `AXIOM_QUERY_TOKEN` is unset, `GET /api/telemetry` returns `200 { seed:true }`
(still behind the auth gate) and the client renders the bundled synthetic seed
(~4000 records across the 7 apps, 8 fake accounts, and 3 kinds over 30 days). The
same client-side `aggregate.js` that powers seed mode also re-filters live data,
so every control stays responsive. This lets the app run and demo **before**
Axiom is wired up.

## Server

- `src/index.js` — reads env (via `EnvironmentVariablesManager`), wires the
  telemetry service, listens.
- `src/app.js` — Express factory: `/health`, the gated `/api/telemetry`, and the
  static SPA at `/`.
- `src/middlewares/session-token.js` — the monday session-token gate.
- `src/server/queries.js` — the 11 APL queries (see below).
- `src/server/axiom.js` — Axiom `_apl` tabular query client.
- `src/server/telemetry-service.js` — runs the 11 queries, assembles one JSON
  payload, and caches per window (~5 min) so repeated loads don't hammer Axiom.

### The 11 APL queries

`kpi_summary`, `errors_by_app`, `errors_by_account`, `errors_over_time`,
`top_errors`, `usage_by_app`, `usage_by_account`, `top_usage_events`,
`health_boot`, `health_api_latency`, `app_account_crosstab` — each over
`['app-errors'] | where _time between (_startTime .. _endTime)` (the client binds
`_startTime` / `_endTime` from the requested window and passes the same window in
the request body).

## Local development

```bash
pnpm --filter ./apps/telemetry-dashboard dev   # server (8080) + vite (5174, proxies /api)
```

Copy `.env.example` → `.env`. Without `AXIOM_QUERY_TOKEN` the app runs in seed
mode. `MONDAY_CLIENT_SECRET` is required for the session-token gate to accept
real monday tokens (local dev outside monday simply falls back to the seed).

## Environment variables (server-only)

| var | purpose |
|-----|---------|
| `MONDAY_CLIENT_SECRET` | verifies the monday session token (Client Secret from Developer Center); also used as the OAuth token-exchange `client_secret` (see below) |
| `ALLOWED_ACCOUNT_IDS` | optional comma-separated account allowlist (empty = any authenticated account) |
| `AXIOM_QUERY_TOKEN` | Axiom **read** token; unset → seed mode |
| `AXIOM_DATASET` | dataset name (default `app-errors`) |
| `AXIOM_ORG_ID` | optional Axiom org id header |

OAuth app-identity token (Change #143 continuation — replaces the need for a
personal `MONDAY_API_TOKEN`; see "Lifecycle events → monday board" below):

| var | purpose |
|-----|---------|
| `MONDAY_CLIENT_ID` | monday app Client ID — used for the `GET /oauth/start` authorize redirect |
| `BASE_URL` | this app's own stable base URL; builds the OAuth `redirect_uri` (`<BASE_URL>/oauth/callback`) — must match the redirect URI registered in the Developer Center OAuth config exactly |

Lifecycle-events additions (all optional — unset keeps the feature inert):

| var | purpose |
|-----|---------|
| `MONDAY_API_TOKEN` | **optional fallback** — a personal monday API token used to **write** items on the events board only when the owner has not yet authorized via `/oauth/start` (or for local dev). The OAuth-issued token (SecureStorage) always takes priority when present. |
| `MONDAY_API_URL` | GraphQL endpoint override (tests only; default `https://api.monday.com/v2`) |
| `LIFECYCLE_SIGNING_SECRETS` | JSON map `appSlug → Signing Secret` — verifies `/api/webhooks/lifecycle` |
| `APP_EVENTS_CLIENT_SECRETS` | JSON map `appSlug → Client Secret` — verifies `/api/webhooks/app-events` |

> **Board config is no longer env-based.** The events board id, its single
> group id, and the logical→column-id map used to live in `LIFECYCLE_BOARD_ID`
> / `LIFECYCLE_BOARD_COLUMNS`. They are now **provisioned from the in-app
> Settings tab** (`POST /api/settings/board`) and stored in SecureStorage
> (key `lifecycle:board_config`); `events-board.js` reads them per event
> (60s cache), so changing the mapping needs no redeploy.

Server-side error/usage shipping (the logger's Axiom sink) is gated separately
on `AXIOM_TOKEN` + `AXIOM_DATASET` + `AXIOM_APP_NAME` — unset = console-only.

None of these are ever shipped to the browser.

## Lifecycle events → monday board

Architecture, in three lines: every fleet app's **feature-level lifecycle
webhooks** (`POST /api/webhooks/lifecycle`, JWT signed with that app's Signing
Secret) and **app-level install/subscription webhooks** (`POST
/api/webhooks/app-events`, JWT signed with that app's Client Secret) land on
this server, which identifies the sender by which configured secret verifies,
acks `202` immediately (challenge handshakes echo `200` before auth), then
fail-soft records each event as an item on a private monday board — a **single
group** (the `App` column distinguishes apps), deduped by `X-Apps-Event-Id`.

The board is **provisioned from the Settings tab** (see below), not env: the
config (`{ boardId, groupId, columns }`) is created in the owner's account and
stored in SecureStorage. Until it exists, webhooks still `202` and simply
record nothing (`events-board.js` warns once and stays inert).

Privacy: webhook payload details go **only** to the board (owner's private
monday account); logger/Axiom ever see ids and enums only. Auth is
fail-closed: no secrets configured → 401 (only the challenge echo is open).
A dead board/token/monday outage can never 5xx a webhook.

**Write token — app-identity OAuth (Change #143 continuation):** board writes
(`create_item` / `create_group`) need a write-scoped monday credential.
Instead of a personal `MONDAY_API_TOKEN`, the owner authorizes this app's own
identity **once**: `GET /oauth/start` redirects to monday's consent screen;
`GET /oauth/callback` exchanges the returned code for an access token (scopes
`boards:read boards:write me:read`) and stores it in SecureStorage
(`owner:oauth_token`, `src/services/storage.js`). `src/services/monday-api.js`
resolves the write token **per call**: the stored OAuth token first, the
optional `MONDAY_API_TOKEN` env var as a fallback — so the events board can be
configured (`LIFECYCLE_BOARD_ID`) before the owner has authorized; writes
simply fail soft until then. If `ALLOWED_ACCOUNT_IDS` is set, `/oauth/callback`
checks the authorizing account via `me { account { id } }` and **rejects (403,
does not store)** an account outside the allowlist. Both routes are mounted at
`/oauth` with no session-token gate — the code exchange is the auth.

### Settings tab (board provisioning)

The **Settings** tab in the dashboard (owner-only, behind the same session +
allowlist gate) is where the events board is created and inspected:

1. Authorize the app once (`/oauth/start`) — the tab links to it and shows the
   connection status.
2. Click **Create events board** — the server creates a private board, its 9
   columns, and uses the board's single default group as the events group, then
   stores `{ boardId, groupId, columns }` in SecureStorage. The tab then shows
   the board id and the column mapping (read-only). No `mapps code:env` step,
   no version IDs.

### Scripts (`scripts/`)

```bash
# 1. (SUPERSEDED by the Settings tab above — kept for reference only.) The old
#    CLI that created the board + columns and printed LIFECYCLE_BOARD_* env
#    lines. Board config now lives in SecureStorage, provisioned in-app.
# node scripts/create-events-board.mjs [--name "App Lifecycle Events"] [--workspace <id>]

# 2. Register feature-level lifecycle subscriptions for every app in
#    scripts/lifecycle-apps.config.json (fill in appSlug/featureSlug first):
node scripts/register-lifecycle-subscriptions.mjs [--dry-run] [--app <slug>]

# 3. Verify a running server end-to-end (challenge echo / valid JWT / 401):
node scripts/simulate-webhook.mjs --url <base> --kind challenge
node scripts/simulate-webhook.mjs --url <base> --secret <s> --slug <appSlug> --kind lifecycle
node scripts/simulate-webhook.mjs --url <base> --secret wrong --slug <appSlug> --kind lifecycle --expect-fail
```

Token resolution for the first two: `MONDAY_API_TOKEN` env var, else
`~/.config/mapps/.mappsrc` (`accessToken`). Tokens are never printed.

### Activation runbook

1. **Create the monday app** (if not done yet — see "Activation steps" above)
   and add the GitHub secret `APP_TELEMETRY_DASHBOARD_ID`.
2. **Merge to `develop`** → draft deploy; note the server's stable base URL.
3. **Set the platform env** (never committed):
   ```bash
   mapps code:env -i <APP_ID> -k MONDAY_CLIENT_ID            -v <client_id>
   mapps code:env -i <APP_ID> -k MONDAY_CLIENT_SECRET        -v <client_secret>
   mapps code:env -i <APP_ID> -k BASE_URL                    -v <stable_base_url>
   mapps code:env -i <APP_ID> -k LIFECYCLE_SIGNING_SECRETS   -v '{"axis-planner":"<signing secret>", ...}'
   mapps code:env -i <APP_ID> -k APP_EVENTS_CLIENT_SECRETS   -v '{"axis-planner":"<client secret>", ...}'
   ```
4. **Authorize the app's write identity — once**: as the owner, visit
   `<BASE_URL>/oauth/start` (or use the link in the **Settings** tab) and
   approve the consent screen. This stores an app-identity OAuth token
   (SecureStorage) that `services/monday-api.js` uses for all board writes — no
   personal `MONDAY_API_TOKEN` required. `MONDAY_API_TOKEN` remains available as
   an **optional fallback** (local dev, or before this step has been done).
5. **Create the events board — Settings tab**: open the dashboard, go to
   **Settings**, and click **Create events board**. This provisions the private
   board + 9 columns + single group in your account and stores the config in
   SecureStorage. (Nothing to set in env.)
6. **Register feature-level subscriptions**: fill `webhookBaseUrl` +
   `appSlug`/`featureSlug` in `scripts/lifecycle-apps.config.json` (Developer
   Center → the feature's URL slug), then
   `node scripts/register-lifecycle-subscriptions.mjs --dry-run` and re-run
   without the flag.
7. **App-level webhooks (Developer Center → Webhooks), all 7 apps** —
   discussions, axis-planner, axis-tracker, axis-day-off, axis-sync-calender,
   team-people-column, deadline-confirm — point each app's webhook URL at
   `<base>/api/webhooks/app-events` and subscribe to the install /
   subscription / trial events. The URL registration handshake (`challenge`)
   is answered automatically.

## Deploy

Server-side (monday-code) app — `mapps code:push` **without** `-c`. Two
path-filtered workflows (`apps/telemetry-dashboard/**`):

- `.github/workflows/deploy-draft-telemetry-dashboard.yml` — merge to `develop` →
  latest **draft**.
- `.github/workflows/deploy-live-telemetry-dashboard.yml` — merge to `main` →
  force-deploy to latest **live**.

> These workflows **cannot run until** the monday app exists and the
> `APP_TELEMETRY_DASHBOARD_ID` secret is added (see activation).

## Activation steps

1. **Create the monday-code app** in the Developer Center to obtain an **App ID**
   (and note its **Client Secret** for the session-token gate).
2. **Add the GitHub secret** `APP_TELEMETRY_DASHBOARD_ID` = that App ID
   (`MONDAY_TOKEN` already exists org-wide).
3. **Set the server env on the platform** (never committed):
   ```bash
   mapps code:env -i <APP_ID> -k MONDAY_CLIENT_SECRET -v <client_secret>
   mapps code:env -i <APP_ID> -k AXIOM_QUERY_TOKEN     -v <axiom_read_token>
   mapps code:env -i <APP_ID> -k AXIOM_DATASET         -v app-errors
   # error observability — activates the server Axiom sink (helpers/axiomServerSink.js).
   # WITHOUT these three the sink is structurally inert: the app's own errors are
   # console-only and never reach the shared app-errors dataset. AXIOM_TOKEN is an
   # INGEST/write token (distinct from AXIOM_QUERY_TOKEN, which is read-only);
   # AXIOM_DATASET (app-errors, set above) is shared by the reader and the sink.
   mapps code:env -i <APP_ID> -k AXIOM_TOKEN          -v <axiom_ingest_token>
   mapps code:env -i <APP_ID> -k AXIOM_APP_NAME       -v telemetry-dashboard
   # optional:
   mapps code:env -i <APP_ID> -k ALLOWED_ACCOUNT_IDS   -v <acc1,acc2>
   mapps code:env -i <APP_ID> -k AXIOM_ORG_ID          -v <org_id>
   ```
4. **Deploy**: merge this app to `develop` (draft) — the draft workflow builds the
   client and pushes; then promote `develop` → `main` for live.

Until step 3's `AXIOM_QUERY_TOKEN` is set, the deployed app runs in **seed mode**
(synthetic demo data) — still fully access-controlled.
