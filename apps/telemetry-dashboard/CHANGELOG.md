# Changelog - telemetry-dashboard

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
