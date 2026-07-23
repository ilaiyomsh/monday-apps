# Changelog - telemetry-dashboard

## 2026-07-22 — Client sourcemaps for stack symbolication

### 🔧 Infrastructure

- **2026-07-22** — The browser-served client bundle now builds `sourcemap: 'hidden'` instead of `true`; CI archives `public/**/*.map` as artifact `sourcemaps-telemetry-dashboard-<sha>` then strips them before `mapps code:push`. This also closed a prior leak (the client maps were served publicly). Server code runs from source (`node ./src/index.js`, unbundled) — already-readable stacks, not symbolicated. (#359)
  - _Why:_ minified client `stack1` frames were uninvestigable, and `sourcemap: true` served source maps publicly.
  - _Done:_ Part of the portfolio-wide rollout; see `docs/LOGGING-ARCHITECTURE.md` §6.

## 0.4.0 — 2026-07-22

- **Full lifecycle field mapping from the REAL payload (Change #145, folded —
  bump-once).** A live capture (`DEBUG_LIFECYCLE_PAYLOAD`, Change #144.1)
  proved monday nests feature-event fields under `data.*` — the handler read
  them at the top level, so account/user/details always came out empty and
  the `back_to_url` ack never fired. Fixed (legacy top-level shape kept as
  fallback). Board schema grew to 15 columns: + User Name, User Email
  (native on install/subscription events), Workspace, Object Name,
  **Object URL (link)** — built as `https://<slug>.monday.com/boards/<object_id>`
  via a new owner-gated, cached `me{account{slug}}` resolver
  (`services/account-slug.js`; owner decision: NO user name/email API lookup)
  — and App Version (from install/subscription `version_data`). Details now
  also carry `object_id`/`source_object_id`/`app_feature_reference_id`/`app_id`.
  Existing boards keep working (unknown column keys are skipped); recreate the
  board from Settings to get the new columns. 204 tests; 4 seeded mutations
  killed (data.* read, ack source, empty-link skip, crossed identity columns).

- **Board-writes OAuth migrated to monday OAuth 2.1 (Change #144).** The
  owner-authorize flow was broken in production (`code_challenge is required`
  — this app's version enforces monday's new flow while the code spoke the
  legacy one). `/oauth/start` now issues a single-use CSRF `state` nonce
  (deadline-confirm's `oauth_state:` pattern; 10-min TTL, replay → 400) plus
  a PKCE S256 `code_challenge`; the verifier rides in the state record.
- `src/services/monday-oauth-client.js` (new): the ONE owner of the
  `oauth_ms` endpoints — code exchange (`grant_type` + `code_verifier`),
  refresh, best-effort revoke, and the JWT `exp` decode (decode-only, never
  verify; scheduling-only). Never logs; errors carry machine codes.
- **Token record replaces the bare string** under `owner:oauth_token`:
  `{ v:2, accessToken, refreshToken, expiresAt, obtainedAt, refreshedAt,
  status }`. monday's new tokens EXPIRE and refresh tokens are single-use +
  rotating with a 6-month max lifetime from the original authorization. A
  legacy bare-string token still stored is normalized to a v1 record
  (non-expiring, never refreshed) and keeps working.
- `src/services/oauth-token-provider.js` (new): proactive refresh at <5 min
  to expiry (sync-calender's `ensureMicrosoftAccessToken` shape), SINGLE-
  FLIGHT mutex + in-mutex re-read (a concurrent double-refresh would burn
  the single-use rotation), rotated-refresh persistence with `obtainedAt`
  preserved, `invalid_grant` → record flagged `reauth_required` (the
  Settings UI shows a re-authorize CTA), transient failure → stale-but-valid
  token. 401-retry-once deliberately NOT implemented (token resolved
  per-request + the cushion; revisit only on real Axiom 401 evidence).
- **Disconnect (revocation):** `POST /api/settings/disconnect` (session-
  gated) revokes both tokens best-effort at `oauth_ms/oauth/revoke` and
  ALWAYS clears the stored record; Settings gained a Disconnect button and a
  third `reauth_required` state. `GET /api/settings` now returns
  `oauthStatus: 'connected'|'disconnected'|'reauth_required'`
  (`oauthConnected` boolean kept for back-compat).
- `MONDAY_APP_VERSION_ID` env (optional): targets a DRAFT version's OAuth
  config during testing via `app_version_id` (deadline-confirm's idiom) —
  the New OAuth Flow toggle is per-version in the Developer Center.
- Tests: 61 new/updated across oauth router (PKCE challenge derivation,
  state replay/expiry), oauth client (param shapes, error mapping), token
  provider (rotation, mutex single-flight, invalid_grant, stale-but-valid),
  storage (record round-trip, legacy normalization, state TTL boundary) and
  settings routes (3 statuses, disconnect). Mutation spot-checks: 4 seeded
  bugs killed (state-delete removal, TTL boundary flip, wrong challenge
  source, disabled state gate).

## 0.3.0 — 2026-07-19

- **Lifecycle events board config moved from env → in-app Settings, provisioned
  from the UI.** The events board id, its single group id, and the
  logical→column-id map no longer come from `LIFECYCLE_BOARD_ID` /
  `LIFECYCLE_BOARD_COLUMNS`; they are created from a new **Settings** tab and
  stored in SecureStorage (`lifecycle:board_config`). Decision: **one group per
  board**, not one-per-app — the `App` column already discriminates.
- `src/services/board-schema.js` (new): single source of truth for the 9 board
  columns (key/title/type + the `category` status labels) and the default board
  name.
- `src/services/monday-api.js`: added `createBoard` (defaults to a **private**
  board; returns id + groups) and `createColumn` (defaults forwarded as a JSON
  string). Both funnel through the existing soft-error/api_latency wrapper.
- `src/services/storage.js`: added `getBoardConfig`/`setBoardConfig` on a new
  `lifecycle:board_config` key with its own independent 60s read cache
  (write-through). Non-object stored values and backend read failures degrade to
  `null` (`board_config_read_failed`) — never a throw.
- `src/services/board-provisioner.js` (new): creates the private board + 9
  columns (schema order, status defaults) + uses the board's default group as
  the single events group, then persists `{ boardId, groupId, columns }`. Unlike
  the webhook path it is NOT fail-soft — failures log and propagate so the
  Settings route can report them; the `no_write_token` code is preserved for a
  409.
- `src/services/events-board.js`: refactored to read config **per event** via an
  injected `getConfig()` (SecureStorage-backed) instead of a boot-time env
  snapshot; writes every event to the single configured group; removed the
  per-app `ensureGroupForApp` (create-by-title). Unconfigured → warn once, skip
  (webhooks still 202); still fully fail-soft.
- `src/routes/settings.js` (new): `GET /api/settings` (oauth status + board
  config) and `POST /api/settings/board` (provision), behind the same
  `requireSession` + allowlist gate as `/api/telemetry`. `no_write_token` → 409
  `not_authorized`; other failures → 502 `provision_failed`.
- `src/index.js` / `src/app.js` / `src/helpers/environment.js`: always build the
  events board with `getConfig: () => storage.getBoardConfig()`; wire the
  provisioner and mount the settings router; dropped the `LIFECYCLE_BOARD_ID` /
  `LIFECYCLE_BOARD_COLUMNS` env reads.
- Client: new **Settings** view (`src/client/components/SettingsView.tsx`,
  `src/client/lib/settings-api.ts`) with a Dashboard/Settings tab toggle in
  `App.tsx` — shows OAuth status, a **Create events board** action, and the
  resulting board id + column mapping.
- `scripts/create-events-board.mjs` is **superseded** by the Settings tab (kept
  for reference).
- Tests: rewrote `events-board.test.js` for the config-driven design; added
  board-config cases to `storage.test.js`, `createBoard`/`createColumn` cases to
  `monday-api.test.js`, and new `board-provisioner.test.js` +
  `settings-routes.test.js`. 139 tests green; the five new/changed logic modules
  each carry ≥3 killed mutations (test-guard).
