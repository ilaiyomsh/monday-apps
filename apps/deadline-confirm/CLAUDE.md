# CLAUDE.md — deadline-confirm

App-internal facts for agents. Repo-wide rules live in the root CLAUDE.md;
the product spec (source of truth, wins over "best practices") is
`docs/spec.md`. Operator setup lives in `README.md`.

## What this is

One-click deadline confirmation from email (monday code server + admin view).
`GET /confirm?itemId=…&k=<shared secret>` transitions one configured status
column from one label to another on ONE configured board, records attribution
via `create_update`, and answers with one of exactly three static RTL pages.
Single-tenant v1. App ID **11704868**, dev-center slug `yomsheni-il_status-email`.

**Locked decisions (spec §3) — do not "improve":** direct GET from email (no
interstitial), static shared secret in every email, manual rotation only, no
clicker identity in the URL, OAuth token of a LOW-PRIVILEGE user as the blast
radius, `/confirm` returns zero account data, in-memory rate limit.

## Module layout

```
src/
├── index.js                  # env + wiring + listen (nothing testable here)
├── app.js                    # createApp factory — DI for tests (trust proxy, routers, /admin static)
├── routes/
│   ├── confirm.js            # HEAD+GET /confirm — spec §6 EXACT order
│   ├── oauth.js              # /oauth/start + /oauth/callback (§8)
│   └── admin-api.js          # /api/state|config|secret/rotate|snippet (§9)
├── middlewares/session-token.js  # JWT (client secret) + ALLOWED_ACCOUNT_ID → 401/403
├── services/
│   ├── monday-api.js         # THE GraphQL funnel; API-Version pinned; soft errors thrown
│   ├── confirm-service.js    # evaluateGuards (pure) + performConfirm (orchestration)
│   ├── storage.js            # SecureStorage wrapper + 60s read cache + nonce lifecycle
│   └── secret.js             # generate / constant-time compare / mask
├── helpers/                  # pages (3 static + oauth), rate-limit, snippet, logger, environment
├── storage/                  # secure-storage-backend (prod) / memory-backend (dev+tests)
└── client/admin/             # React 19 + Vite 7 + @vibe/core SPA → built to public/admin/
```

## Non-obvious semantics (bugs waiting to happen)

- **`config.fromIndex` / `config.toIndex` hold status LABEL IDs** — from
  `settings.labels[].id`, NOT display order (`labels[].index` is display
  order). monday's value JSON `{"index": N}` carries the id. Label id **0 is
  valid** — never truthy-check. Probe-verified; fixtures in `tests/fixtures/`.
- `settings_str` is deprecated (2025-10) — labels are parsed from the typed
  `settings` field (client: `services/monday.ts#parseStatusLabels`). This is
  a deliberate, documented deviation from the spec's wording (§4/§9).
- Never-set columns read as: status `index: null`, people `text: ""`, date
  `date: ""` (empty STRINGS, not null) — normalized in `monday-api.js`.
- API version pin: `API_VERSION = '2026-07'` in `src/services/monday-api.js`
  (the one place). Bumps go through the monday-api skill's versioning page.
- §6 order is a security contract: HEAD no-op → parse → **secret gate**
  (constant-time, before any storage/API beyond the cached secret) → rate
  limit → config/token load → query → guards → mutations. `wrong_status` is
  ALSO the idempotency mechanism (second click lands there).
- ALL storage is SecureStorage (owner decision 2026-07-14; the spec's
  Storage/SecureStorage split was collapsed — apps-sdk Storage needs a
  per-call token which /confirm doesn't have). 60s read cache on
  config/link_secret/oauth_token; ANY write invalidates it.
- monday OAuth tokens don't expire and have no refresh token — any API 401 =
  revoked → admin shows `broken` + reconnect; /confirm answers generic
  invalid.
- The three /confirm pages are the ENTIRE response space (plus plain 429) —
  no item/account data ever (only the config-derived target label).

## Env & deploy

Env (platform: `mapps code:env -i 11704868`; local: `.env`): `MONDAY_CLIENT_ID`,
`MONDAY_CLIENT_SECRET` (also verifies sessionTokens), `ALLOWED_ACCOUNT_ID`,
`BASE_URL` (stable liveUrl), `PORT` (8080), `USE_LOCAL_STORAGE` (dev/tests only).

Deploys ONLY via the pipeline (root CLAUDE.md): merge to `develop` → draft,
merge to `main` → live. Server-type app: the workflow pushes the app root
(no `-c`), so `public/admin/` must be built in CI before push (it is — the
build step runs `vite build`).

## Tests

`npm test` (vitest). Server suite is TDD-gated via test-guard (red→green +
mutation spot-checks). monday-facing test doubles are built ONLY from the
probe-captured fixtures in `tests/fixtures/` (see its README for provenance —
sandbox workspace, WZ- board, 2026-07-14). Spec §15 acceptance scenarios 1-11
map to `tests/confirm-route.test.js` / `tests/oauth.test.js` /
`tests/admin-api.test.js`.
