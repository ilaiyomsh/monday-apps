# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Project

One-way sync from **Google Calendar → monday.com board**, hosted on **monday code** (serverless Node.js). Events are only synced when the authenticated user has explicitly **accepted** the calendar invitation (`attendees[self].responseStatus === "accepted"`).

**Architecture:** Custom Object admin UI only. Users install the app, open the admin SPA at `/admin`, connect their Google account, pick a board + columns, and the server syncs on Google push notifications. **As of 2026-04-20 the monday.com automation-block path (v3) is retired** — its code lives under `legacy/block-based/` for reference. Do not re-introduce those imports without a deliberate decision to revive the block flow.

## Commands

```bash
npm install                                # Install dependencies
npm start                                  # Start Express server (port 8080)
npm run dev                                # nodemon src/index.js + vite concurrently (admin SPA on :5173 proxying to :8080)
npm run build:client                       # Build React admin bundle → public/admin/
npm run typecheck                          # tsc --noEmit (client-only types)
mapps tunnel:create -p 8080 -a 11119011    # Expose local server to monday.com
Deploy via the mapps skill ship procedure (one gated question; it rebuilds and force-pushes internally) — do not run `mapps code:push` directly
mapps code:logs -i <APP_VERSION_ID> -s live -t console   # Stream logs (version ID, not app ID)
```

## Architecture — Custom Object admin path

### Flow

**Install (lifecycle):** monday POSTs to `/lifecycle/install` when the Custom Object feature is activated for an account. Server creates a `policy_<objectId>` entry via `syncConfigStorage.setInstancePolicy`. Policy stores account-level settings (boardId, linkColumnId, peopleColumnId, columnMapping, conditionalEligibleColumns) set by the admin/owner.

**OAuth (admin UI):** User opens `/admin`, clicks Connect Google. `oauth-google.js` runs the auth code flow (Google client credentials live in env). On callback, server renders HTML (`oauth-callback-html.js`) that `postMessage`s the result back to the SPA iframe and closes the popup. Monday OAuth follows the same pattern for account delegation.

**Sync config (per user):** Once OAuth completes, `configs.js` creates a `config_<configId>` entry in SecureStorage keyed on `{ userId, objectId }`. Each sync config is one user's calendar → their rows on the owner-configured board. Conditional overrides (per-user rules on top of the base columnMapping) live on the same config.

**Google watch channel:** On config create (or after a token refresh), `watch-channel.js#ensureWatchChannel` registers a Google Calendar push channel with `channelId = config.configId` (prefixed `config_*`). Stores `{ resourceId, expiration }` back on the config.

**Runtime (per Google change):** Google POSTs to `/webhook/calendar`. Handler = `webhook-config.js#webhookConfigHandler`. Reads `x-goog-channel-token = configId`, loads config + policy, calls `sync-engine.js#runSyncForConfig` which:
1. Fetches changes with `listChanges(accessToken, syncToken)` (refreshes the stored Google token via `google-oauth.js#ensureGoogleAccessToken` first).
2. Filters via `shouldSync` (see below) — cancellations pass through.
3. For each event: `mapEventToColumns` builds a base column_values payload from `policy.columnMapping`, then `applyConditionalOverrides` walks `config.conditionals` (first match wins) and merges overriding values onto the same payload.
4. Classifies (`classifyEvent`: create / update / delete based on `eventStatus` + link-column lookup) and applies to monday (`monday-api.js`).
5. Persists the new `syncToken` and advances per-event cursors.

**Token management:** Every sync call refreshes the stored Google access token from the stored refresh token. If the refresh fails with `invalid_grant` (`google_refresh_token_missing`), `webhook-config.js` flips `syncConfig.status = 'google_disconnected'` + surfaces it in the admin UI.

**Channel renewal (self-healing):** Twice-daily cron (`0 */12 * * *` UTC) at `/mndy-cronjob/renew-channel` (also `/scheduler/renew-channel` for testing). Walks `all_active_configs`, re-registers any channel expiring in <24h via `ensureSubscription`. On refresh failure it flips the config to `<provider>_disconnected` and notifies owner + affected user (see the renewal endpoint contract below).

### Event identity via Link column

Event identity lives **on the board** in a Link column the user designates (`policy.linkColumnId`):

- Stored value: `{ url: event.htmlLink, text: event.htmlLink }` — `text` must equal `url` because `items_page_by_column_values` filters link columns by display text (not URL).
- Lookup: `items_page_by_column_values` with the full URL.
- Scales to thousands of events without per-event storage.

## Module Layout

```
src/
├── index.js                      # Express entry (port 8080) + /admin static mount + SPA fallback
├── routes/
│   ├── webhook.js                # POST /webhook/calendar → webhookConfigHandler (thin delegator)
│   ├── webhook-config.js         # Actual Google push handler: runs sync engine, updates config status
│   ├── configs.js                # SPA CRUD for sync configs (incl. conditionals) + force-sync + backfill trigger
│   ├── policy.js                 # SPA CRUD for per-instance policy (board + column mappings + eligible columns)
│   ├── lifecycle.js              # Monday Custom Object install/uninstall lifecycle events
│   ├── oauth-google.js           # Google OAuth start + callback
│   ├── oauth-monday.js           # Monday OAuth start + callback
│   ├── oauth-callback-html.js    # HTML/postMessage templates for popup callbacks
│   └── scheduler.js              # POST /(mndy-cronjob|scheduler)/renew-channel — renews all_active_configs
├── services/
│   ├── sync-engine.js            # runSyncForConfig, classifyEvent, applyEvent, applyConditionalOverrides
│   ├── backfill.js               # Initial historical sync (6-month window, background progress)
│   ├── conditional-evaluator.js  # Evaluates Conditional predicates (first-match-wins)
│   ├── google-calendar.js        # watchCalendar, listChanges, stopChannel, shouldSync, buildEventUrl
│   ├── google-oauth.js           # ensureGoogleAccessToken (refresh via stored refresh token)
│   ├── monday-api.js             # GraphQL: find/create/update/delete items + rename + column value writes
│   ├── monday-oauth.js           # Monday OAuth token exchange
│   ├── watch-channel.js          # ensureWatchChannel — create/renew Google push channels keyed by configId
│   ├── oauth-state.js            # CSRF state for OAuth flows
│   ├── sync-status.js            # Shared: classifyError, status transitions, owner + affected-user disconnect notifications (owner alert sent via the OWNER's own monday token so it survives the affected user's monday disconnect)
│   └── logger.js                 # Structured JSON logging
├── storage/
│   ├── sync-config-storage.js    # config_<configId>, policy_<objectId>, all_active_configs
│   └── local-storage.js          # Test-only file-backed shim (USE_LOCAL_STORAGE=true)
├── middlewares/
│   ├── session-token.js          # monday sessionToken header verification for SPA endpoints
│   ├── signing-secret.js         # monday signing secret verification for lifecycle events
│   └── authz.js                  # Owner vs member policy enforcement
├── helpers/
│   ├── environment.js            # getBaseUrl(), getPort()
│   ├── columns.js                # mapEventToColumns, renderColumnValue
│   ├── column-mapping-validator.js
│   └── conditionals-validator.js
└── client/admin/                 # React + Vite SPA (see "Frontend" below)

legacy/block-based/               # Retired v3 monday-block path — do not import from src/
```

## Frontend (Admin UI)

React + Vite SPA served at `/admin`.

### Layout & build

- **Entry:** `src/client/admin/index.html` → `main.tsx` → `App.tsx`
- **Build:** `npm run build:client` → `public/admin/` (served by Express via `/admin/*` static mount with SPA fallback to `index.html`; `public/admin/` is gitignored but tarballed on deploy, so the bundle must be built before every deploy — the mapps skill ship procedure rebuilds it automatically)
- **Dev:** `npm run dev` runs `nodemon src/index.js` + `vite` concurrently (vite on :5173 with an `/api`, `/oauth`, `/auth` proxy to :8080)
- **Stack:** React 19, Vite 7, TypeScript 5 (strict, client-only — server stays plain ESM JS), `@vibe/core`, `monday-sdk-js`
- **Tabs:** `Users` (everyone, owner sees all rows), `Setup` (owner-only, board picker + link/people columns + per-column mapping table with debounced auto-save), `Conditions` (per-user overrides, visible once policy has eligible columns + config exists), `About`
- **Ownership:** the backend decides via `GET /api/policy` which returns `{ policy, isOwner }`. The client never computes ownership itself.
- **OAuth flow:** `useOAuthPopup` opens a 500×700 popup pointing at `/oauth/<provider>/start`. The callback renders HTML from `src/routes/oauth-callback-html.js` that `postMessage`s a typed payload (`oauth:google:complete` / `oauth:monday:complete`) back to the iframe and closes the window. If the popup is blocked the hook falls back to in-iframe redirect; if the user opened it in a tab manually, the HTML redirects back to `/admin/?google=ok&configId=…` for the old fallback path.

### Names, not IDs

User-facing strings are resolved to names before rendering — the UI never shows numeric monday IDs:
- `useMondayContext` pulls `me { id name email account { id name slug } }` at boot; `IdentityBar` + `AboutTab` render `me.name · me.account.name`.
- `useUsersByIds` batch-resolves `rows.userId[]` via `query { users(ids: [...]) { id name email photo_thumb_small } }`; `UsersTable` renders `user.name` + email.
- `BoardPicker` / `ColumnPicker` labels are `board.name` / `column.title` only.

### Critical Vibe tripwires

Vibe components (`@vibe/core@3.82.2`) render as unstyled bare HTML unless **both** of these are present on every bundle:

1. `main.tsx` imports `'@vibe/core/tokens'` (the design-token CSS — adds all `--font-family`, `--color-*`, `--space-*` vars to `:root`).
2. `<body>` has one of the app-theme classes (`light-app-theme`, `dark-app-theme`, `black-app-theme`, `hacker-theme-app-theme`). `main.tsx` adds `light-app-theme` synchronously before `createRoot` if no theme class is present yet — do not rely on `<ThemeProvider>`'s `systemTheme` effect alone.

If tokens or the body class are missing, symptoms are: serif default font, invisible Tab bar, bare-border Buttons, broken Dropdowns. Not a rendering bug — a CSS scoping one.

### Structure

```
src/client/admin/
├── App.tsx                     # Tabs + boot sequence wrapped in ThemeProvider + ToastProvider
├── main.tsx                    # createRoot + ErrorBoundary + body theme class + tokens import
├── services/
│   ├── api.ts                  # fetch wrapper; sessionToken header; typed ApiError
│   └── monday.ts               # monday-sdk-js singleton + pickObjectId
├── hooks/                      # useSessionToken, useMondayContext, useBoards, useBoardColumns,
│                               # usePolicy, useConfigs, useOAuthPopup, useUsersByIds, useDebouncedEffect
├── components/
│   ├── IdentityBar.tsx
│   ├── layout/                 # PageHeader, Section
│   ├── pickers/                # BoardPicker, ColumnPicker, SourceFieldPicker
│   ├── mapping/                # ColumnMappingTable — 500ms debounced PATCH /api/policy
│   ├── conditionals/           # EligibleColumnsPicker, ConditionalList/Card, RuleList, PredicateRow, ValueSection
│   ├── users/UsersTable.tsx
│   ├── oauth/OAuthButton.tsx
│   ├── feedback/               # ToastProvider, ErrorBoundary, ConfirmDialog, Skeleton
│   └── tabs/                   # SetupTab, UsersTab, ConditionsTab, AboutTab
├── types/index.ts              # Policy, SyncConfig, Board, Column, MondayUser, Conditional/Predicate/ConditionalValue
└── styles/index.css
```

### Backend touch-points

- `GET /api/policy` returns `{ policy, isOwner }` (owner check server-side — `src/routes/policy.js`)
- `PATCH /api/policy` persists policy fields (owner only)
- `GET /api/configs` / `PATCH /api/configs/:configId` / `DELETE` / force-sync endpoints
- `src/routes/oauth-google.js` + `oauth-monday.js` callbacks render HTML from `oauth-callback-html.js`

### Conditional mappings (per-user overrides)

Layered on top of the base `columnMapping`, each user can define an ordered list of named **Conditionals** that override specific columns when a Google event matches.

- **Owner side (Setup tab, step 4).** `policy.conditionalEligibleColumns: string[]` — owner marks which board columns are eligible. v1 supports `status` and `board_relation` columns. Saved via the existing policy PATCH.
- **User side (Conditions tab).** `syncConfig.conditionals: Conditional[]` — ordered list of named rules, saved via `PATCH /api/configs/:configId` with a `conditionals` field. Tab is hidden until the user has a sync-config row AND the owner has marked at least one eligible column.
- **Shape.** `Conditional = { id, name, operator: 'AND'|'OR', predicates: Predicate[], values: Record<columnId, ConditionalValue> }`. Predicate fields: `attendee_email` (equals/contains/domain), `event_title` (equals/contains/regex), `description`, `location` (each contains/equals). Values by column type: status → `{ index }`, board_relation → `{ itemId }`.
- **Runtime.** `src/services/sync-engine.js#applyConditionalOverrides` runs right after `mapEventToColumns`. It iterates `config.conditionals`, first match wins (see `src/services/conditional-evaluator.js`); winner's values pass through `renderColumnValue` and are `Object.assign`ed onto the base `columnValues`, overriding any base value on the same column. Columns not set in the winning conditional stay empty — no default / fallback conditional.
- **Validator.** `src/helpers/conditionals-validator.js` enforces shape + known fields/ops, regex compile, duplicate id detection.
- **Logs.** `conditional matched` / `conditional no-match` at INFO, tagged `sync_engine`, with `configId`, `eventId`, `conditionalId`, `overriddenColumns`.

### Known loose ends

- Bundle is ~650 KB (no code-splitting yet) — acceptable for an admin iframe.
- Setup tab's board picker doesn't filter by workspace — owner sees every board in the account.

## Endpoint Contracts

### POST /webhook/calendar (Google → server)

Thin delegator in `src/routes/webhook.js` → `webhook-config.js#webhookConfigHandler`.

1. Read `x-goog-channel-token = configId` and `x-goog-resource-state`. If state === `'sync'` (Google's channel handshake), return 200.
2. Load `config_<configId>`; if missing → WARN + 200.
3. Load `policy_<config.objectId>`; if missing → set `lastError: 'policy_missing'` and 200.
4. `runSyncForConfig({ config, policy })` — on success log counts; on failure classify the error into a status transition (`google_disconnected` for `invalid_grant` / 400 token refresh, `monday_disconnected` for 401, `pending_policy` for `policy_not_configured`) and persist + 200.
5. Always 200 — Google marks channels unhealthy on 5xx.

### POST /mndy-cronjob/renew-channel (monday scheduler → server)

Also at `/scheduler/renew-channel` for manual testing. No auth (scheduler uses its own signing).

1. Read `all_active_configs`.
2. Filter `googleWatchExpiration - now < 24h`.
3. For each: `ensureSubscription(config)` (provider-aware: Google watch channel / Microsoft Graph subscription) re-registers and updates `{ resourceId, expiration }`. Stale index entries (config missing) are pruned.
4. **On renewal failure**, the `catch` classifies the error via `sync-status.js#classifyError` (shared with the webhook path). A dead refresh token (`invalid_grant` / 400, Google **or** Microsoft) flips the config to `<provider>_disconnected` + sets `lastError`, then notifies the instance owner (`maybeNotifyOwner`) and the affected user (`maybeNotifyAffectedUser`). This is the only path that catches a disconnect once the push subscription has already expired (no webhooks fire), so without it the config stayed `active` forever. Transient errors keep `status` unchanged. **Owner notifications are sent through the owner's OWN monday token** (looked up from the owner's config in the instance, falling back to the affected user's token) — so when the failure is the affected user's `monday_disconnected`, the owner is still reachable even though that user's token is dead.

Cron: `0 */12 * * *` UTC (twice daily — 00:00 + 12:00 UTC = 03:00 + 15:00 Israel IDT). Twice-daily so a Microsoft Graph subscription (~71h max lifetime) still gets a renewal window even if one run is missed. Confirmed against Axiom logs (scheduler runs land at 00:00 + 12:00 UTC).

### POST /lifecycle/install & /lifecycle/uninstall (monday → server)

Custom Object lifecycle events. Install creates the `policy_<objectId>` shell; uninstall deletes policy + all associated configs + stops the Google channels.

### /oauth/google/* and /oauth/monday/*

Popup-driven OAuth. Start routes issue a CSRF state cookie and redirect to provider. Callback routes exchange the code, persist tokens in `sync-config-storage`, and render the `postMessage` HTML.

### /api/policy, /api/configs, /api/configs/:configId

Admin UI endpoints. All require a valid monday `sessionToken` header (`session-token.js` middleware). Owner-only endpoints additionally go through `authz.js`.

## RSVP Filter

```javascript
function shouldSync(event) {
  if (event.status === 'cancelled') return false;
  // All-day events (start.date only, no start.dateTime) are NOT synced.
  if (event.start && !event.start.dateTime) return false;
  // Events with no attendees: user is the sole organizer/creator → always sync
  if (!event.attendees?.length) return true;
  const self = event.attendees.find(a => a.self === true);
  return self?.responseStatus === 'accepted';
}
```

**Decline-surfaces-as-cancel:** If `shouldSync(event)` returns false AND the event is still `confirmed` in Google AND `self.responseStatus === 'declined'` (user accepted earlier, declined later), the sync engine treats it as a cancellation so the item is deleted.

### Decision Matrix (sync engine)

| Event state | Item exists (link column lookup)? | Action |
|---|---|---|
| `confirmed` (passes `shouldSync`) | No  | **Create** item with name + link + mapped columns + conditional overrides |
| `confirmed` (passes `shouldSync`) | Yes | **Update** columns + rename (`change_multiple_column_values` does not touch item name; a separate `change_simple_column_value` on `column_id: "name"` handles the rename) |
| `cancelled` or self-declined      | Yes | **Delete** item |
| `cancelled` or self-declined      | No  | **Skip** |

If `policy.peopleColumnId` is set, every create/update also writes the assigned owner (stored on the config at OAuth time) to that People column.

## Storage Schema

All persistence uses **SecureStorage** from `@mondaycom/apps-sdk`.

| Key | Value | Purpose |
|---|---|---|
| `config_<configId>` | `{ userId, objectId, accessToken, refreshToken, tokenExpiry, syncToken, googleWatchChannelId, googleWatchResourceId, googleWatchExpiration, status, lastError, conditionals, backfillState, lastOwnerNotifiedAt, lastOwnerNotifiedReason, lastUserNotifiedAt, lastUserNotifiedReason, createdAt, updatedAt }` | Per-user sync config. `configId` is the Google watch channel id (`config_<uuid>`). `last{Owner,User}Notified*` back the 24h notification cooldown (see `sync-status.js`). |
| `policy_<objectId>` | `{ objectId, ownerUserId, boardId, linkColumnId, peopleColumnId?, columnMapping, conditionalEligibleColumns, createdAt, updatedAt }` | Account/instance-level policy, set by the owner. |
| `all_active_configs` | `[{ configId, objectId, googleWatchExpiration }, ...]` | Global index for cron renewal. |

### Rate Limits

SecureStorage: 7 req/s concurrency, 1 write/s per key. Sufficient for typical sync batches.

## Authentication

Monday session tokens authenticate the admin SPA. Google OAuth tokens (per user) are stored on each sync config and refreshed on demand.

| Endpoint | Google Token | Monday Token | Source |
|---|---|---|---|
| `/webhook/calendar` | Stored `accessToken` from config (refreshed via `ensureGoogleAccessToken`) | None | Google-initiated |
| `/api/policy`, `/api/configs/*` | None | `sessionToken` from header (monday SDK) | Admin SPA |
| `/lifecycle/*` | None | Signed with `MONDAY_SIGNING_SECRET` | Monday-initiated |
| `/oauth/<provider>/*` | Code-flow exchange | CSRF cookie | Browser popup |
| `/(mndy-cronjob\|scheduler)/renew-channel` | Stored per-config tokens | None | Monday scheduler |

## Environment Variables

Set via `mapps code:env -i 11119011 -m set -k <KEY> -v <VALUE>`:

| Variable | Purpose |
|---|---|
| `MONDAY_SIGNING_SECRET` | Verify signed requests from monday (lifecycle, scheduler) |
| `MONDAY_APP_ID` | App ID (Number, not string) |
| `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET` | Monday OAuth app (`oauth-monday.js`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth app |
| `APP_BASE_URL` | Stable Live URL (`liveUrl` from `mapps code:status`). Used to build the Google watch callback URL. Does NOT change between deploys. |
| `USE_LOCAL_STORAGE` | **Test-only.** Swap SecureStorage for a file-backed shim (`LOCAL_STORAGE_FILE`, default `.dev/storage.json`). Never set in production. |
| `GOOGLE_API_BASE_URL` | **Test-only.** Override `googleapis` `rootUrl` to hit a local mock. Never set in production. |

**Important:** monday code exposes two URLs per app version — a per-deploy URL (`url`) and the stable **Live URL** (`liveUrl`). Use `liveUrl` for `APP_BASE_URL` so it never needs to be updated on future deploys. Drafts are for internal testing only.

## monday.com App Configuration

- **App ID:** 11119011
- **App slug:** `yomsheni-dev_calendarsync`
- **Account:** `yomsheni-dev`

### Features (active)

| Feature | Type | Slug | Purpose |
|---|---|---|---|
| Calendar Sync Admin | Custom Object | `calendar-sync-admin` | The admin SPA iframe (`/admin`) + lifecycle events |

### Retired features (block path)

The v3 Trigger + Action + Credentials features are no longer wired into any code path. The Developer Center may still list them as disabled; the code under `legacy/block-based/` is the reference if we ever revive them. See `legacy/block-based/README.md` for revival steps and `legacy/block-based/docs/architecture_v3.md` for the full block flow.

## Legacy (retired 2026-04-20)

```
legacy/block-based/
├── README.md                   # How to revive, what was moved, what stayed shared
├── routes/{triggers,actions,auth}.js
├── routes/webhook.js.full      # Pre-retirement /webhook/calendar (v3 branch + admin delegator)
├── routes/scheduler.js.full    # Pre-retirement cron (v3 renewal loop + admin renewal)
├── services/monday-triggers.js # fireTrigger() — signs and POSTs to webhookUrl
├── middlewares/authentication.js
├── storage/subscription-storage.js
├── tests/                      # Tier 1 + Tier 2 action/E2E scenarios + harness
└── docs/                       # architecture_v2/v3, routing research, e2e-test-plan, session findings
```

Nothing in `src/` imports from `legacy/`. If you need block-path behavior back, see `legacy/block-based/README.md`.

## Research Docs (active)

| File | Contents |
|---|---|
| `docs/01-architecture.md` | Original v1 architecture (kept for history) |
| `docs/02-google-cloud-setup.md` | GCP project, OAuth consent, redirect URI |
| `docs/03-google-calendar-api.md` | Push notifications, incremental sync, event schema |
| `docs/04-monday-auth.md` | Monday auth flow notes (partial — block sections now stale) |
| `docs/05-monday-code-hosting.md` | Deployment CLI, Storage SDK, Scheduler cron setup |
| `docs/06-monday-graphql-api.md` | Item mutations, column value formats, date conversion |
| `docs/07-integration-feature.md` | Integration app feature flows (partial — block-focused) |
| `docs/08-open-questions.md` | Unresolved decisions |
| `docs/11-custom-object-admin-ui.md` | Admin UI design doc |
| `docs/12-custom-object-work-plan.md` | Admin rollout plan |
| `docs/13-custom-object-poc-local-direct.md` | Local-direct POC findings |
| `docs/14-real-product-handoff.md` | Handoff notes |
| `docs/15-oauth-token-refresh-research.md` | OAuth refresh semantics |
| `docs/setup/gcp-setup-guide.md` | GCP step-by-step |
| `docs/setup/monday-app-setup-guide.md` | Monday Developer Center setup (partial — block sections stale) |

## Key Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server (port 8080) |
| `googleapis` | Google Calendar API client |
| `@mondaycom/apps-sdk` | SecureStorage |
| `jsonwebtoken` | Verify monday session tokens |
| `react`, `@vibe/core`, `monday-sdk-js` | Admin SPA |

## Accessing the Cloud Apps (Google + Microsoft)

How to reach the OAuth provider apps backing the sync, for future sessions.
IDs below are non-secret identifiers — client secrets are NOT stored here
(Google secret lives in monday code env; Microsoft secret is console-only).

### Google Cloud — `Sync-Calendar-Monday`

| Field | Value |
|---|---|
| Project ID | `lithe-breaker-491415-p0` |
| Project number | `827989722403` |
| Owner account | `ilai@twyst.co.il` (NOT `ilaish55@gmail.com` — that one lacks access) |
| Billing account | `0134F1-315858-8A8067` (currency **ILS**) |
| Budget alert | id `4aa9a2d6-6f11-418b-bcc0-a6ca37dbc511`, ₪1/mo, thresholds 50/90/100% |
| OAuth client ID | env `GOOGLE_OAUTH_CLIENT_ID` (console-only; OAuth Admin APIs retired Mar 2026) |

```bash
gcloud auth login                                   # if not authed — pick ilai@twyst.co.il
gcloud projects describe lithe-breaker-491415-p0
gcloud services list --enabled --project=lithe-breaker-491415-p0
gcloud billing projects describe lithe-breaker-491415-p0
# Budgets API needs a quota project header (ADC not set), so use REST + token:
TOKEN=$(gcloud auth print-access-token)
curl -s "https://billingbudgets.googleapis.com/v1/billingAccounts/0134F1-315858-8A8067/budgets" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: lithe-breaker-491415-p0"
```

Only **Calendar API** + **People API** are used (both free). OAuth scopes:
`calendar.events.readonly`, `userinfo.email` (see `src/routes/oauth-google.js`).
Console: https://console.cloud.google.com/apis/credentials?project=lithe-breaker-491415-p0

### Microsoft Entra (Azure AD) — `monday calendar sync — Outlook`

| Field | Value |
|---|---|
| App (client) ID | `536344bf-d95e-4101-916b-e31b096b269b` |
| Object ID | `3f050954-3f91-472a-938f-d4abd8e7956f` |
| Tenant | `ilaitwystco.onmicrosoft.com` (`6ade87ff-b8da-49ef-84d4-de5959406a8f`) |
| Account | `ilai@twyst.co.il` |
| Redirect URI | `https://live1-service-27549619-d2f728f4.us.monday.app/oauth/microsoft/callback` |
| Client secret | `monday secret`, expires **2028-04-26** (value console-only) |

```bash
brew install azure-cli                              # if missing
az login                                            # pick the ilaitwystco tenant
APPID=536344bf-d95e-4101-916b-e31b096b269b
az ad app show --id $APPID                          # full registration
az ad app show --id $APPID --query requiredResourceAccess   # API permissions (by GUID)
az ad app owner list --id $APPID                    # owners
```

Graph permissions (all delegated): `Calendars.Read` (`465a38f9-…`),
`offline_access` (`7427e0e9-…`), `User.Read` (`e1fe6dd8-…`).
Entra app registrations are free — no billing. Console:
https://entra.microsoft.com → App registrations → search the App ID above.

> Full snapshots: `docs/google-cloud-manifest.md`, `docs/outlook-manifest.json`,
> `docs/entra-manifest.md` (docs/ is gitignored — local-only).
