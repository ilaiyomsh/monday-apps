# CLAUDE.md — deadline-confirm

App-internal facts for agents. Repo-wide rules live in the root CLAUDE.md;
the product spec (source of truth, wins over "best practices") is
`docs/spec.md`. Operator setup lives in `README.md`.

## What this is

One-click status actions from email (monday code server + admin view), **v3 —
multi-tenant dynamic buttons**.
`GET /confirm?itemId=…&a=<account id>&k=<shared secret>&btn=<button id>`
serves a JS auto-confirm landing page; its auto-POST sets the button's status
column to the button's target label on the ACCOUNT's configured board (NO
from-status guard, NO expiry), records attribution via `create_update`, and
answers with one of three static RTL pages. Already-at-target → silent
success (no writes). The admin view also carries a block-based EMAIL TEMPLATE
editor whose full HTML output is pasted into the external monday workflow
(email scheduling lives OUTSIDE this app). Multi-tenant: every account's
config/secret/token live under `${accountId}:` SecureStorage keys — isolation
is structural, the env allowlist is optional. App ID **11704868**, dev-center
slug `yomsheni-il_status-email`.

**Locked decisions (spec §3 + V2 Amendment) — do not "improve":** static
shared secret in every email (the kill switch), manual rotation only, no
clicker identity in the URL, OAuth token of a LOW-PRIVILEGE user as the blast
radius, `/confirm` returns zero account data, in-memory rate limit, scanner
protection = the JS-auto-POST landing page (GET performs NO action and NO
monday API call — mail scanners without JS can never change statuses).

## Module layout

```
src/
├── index.js                  # env + wiring + listen (nothing testable here)
├── app.js                    # createApp factory — DI for tests (trust proxy, routers, /admin static)
├── routes/
│   ├── confirm.js            # HEAD + GET (landing page) + POST (action) — header comment = the contract
│   ├── oauth.js              # /oauth/start + /oauth/callback (§8)
│   └── admin-api.js          # /api/state|config|secret/rotate|snippet?btn|email-template?tpl
├── middlewares/session-token.js  # JWT (client secret) + optional allowlist → 401/403; verifySessionToken export
├── services/
│   ├── monday-api.js         # THE GraphQL funnel; API-Version pinned; soft errors thrown
│   ├── confirm-service.js    # resolveButton / configIsComplete / performAction (v2 outcomes)
│   ├── storage.js            # SecureStorage wrapper + 60s read cache + nonce lifecycle
│   └── secret.js             # generate / constant-time compare / mask
├── helpers/                  # pages (3 static + landing + oauth), rate-limit, snippet (per-button),
│                             # email-template (full email renderer), logger, environment
├── storage/                  # secure-storage-backend (prod) / memory-backend (dev+tests)
└── client/admin/             # React 19 + Vite 7 + @vibe/core SPA → built to public/admin/
```

## Non-obvious semantics (bugs waiting to happen)

- **`buttons[].targetIndex` holds a status LABEL ID** — from
  `settings.labels[].id`, NOT display order (`labels[].index` is display
  order). monday's value JSON `{"index": N}` carries the id. Label id **0 is
  valid** — never truthy-check (`targetIndex: -1` is the client draft's
  "not picked" sentinel). Probe-verified; fixtures in `tests/fixtures/`.
- `settings_str` is deprecated (2025-10) — labels are parsed from the typed
  `settings` field (client: `services/monday.ts#parseStatusLabels`). This is
  a deliberate, documented deviation from the spec's wording (§4/§9).
- Never-set columns read as: status `index: null`, people `text: ""`, date
  `date: ""` (empty STRINGS, not null) — normalized in `monday-api.js`.
- API version pin: `API_VERSION = '2026-07'` in `src/services/monday-api.js`
  (the one place). Bumps go through the monday-api skill's versioning page.
- The request order is a security contract (both GET and POST): HEAD no-op →
  parse (itemId, a, k, btn) → **secret gate** (constant-time, against
  `forAccount(a)`'s secret, before any storage/API beyond it) → rate limit
  (bucket `${a}:${ip}`). GET then STOPS at the landing page (zero config/API
  access); only POST loads config, queries, and mutates — all under account
  `a`. Idempotency = the `already_done` silent skip (no from-guard).
- ALL storage is SecureStorage (owner decision 2026-07-14), and v3 is
  multi-tenant: SecureStorage is segregated per APP only, so every tenant key
  is prefixed `${accountId}:` and reached ONLY via `storage.forAccount(id)`
  (v3 owner decision 2026-07-15; no migration from v2 bare keys). 60s read
  cache on config/link_secret/oauth_token, keyed by the full prefixed key;
  ANY write invalidates all of it.
- `/oauth/start` requires `?st=<sessionToken>` (the SPA sends it) — that is
  where the connecting account comes from; the state nonce record carries it
  to the callback. A tab opened without st is 401 by design.
- monday OAuth tokens don't expire and have no refresh token — any API 401 =
  revoked → admin shows `broken` + reconnect; /confirm answers generic
  invalid.
- The three /confirm pages are the ENTIRE response space (plus plain 429) —
  no item/account data ever (only the config-derived target label).

## Env & deploy

Env (platform: `mapps code:env -i 11704868`; local: `.env`): `MONDAY_CLIENT_ID`,
`MONDAY_CLIENT_SECRET` (also verifies sessionTokens), `ALLOWED_ACCOUNT_IDS`
(optional comma-separated allowlist; empty = any installing account; legacy
single `ALLOWED_ACCOUNT_ID` is merged in), `BASE_URL` (stable liveUrl),
`PORT` (8080), `USE_LOCAL_STORAGE` (dev/tests only).

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
