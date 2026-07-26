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
│   ├── amp.js                # V5 POST/OPTIONS /amp/confirm — Gmail dynamic email, BULK confirm
│   ├── oauth.js              # /oauth/start + /oauth/callback (§8)
│   └── admin-api.js          # /api/state|config|secret/rotate|snippet?btn|email-template?tpl
│                             # + v4: /api/digest/preview|send (guards → board reads → render → send)
├── middlewares/session-token.js  # JWT (client secret) + optional allowlist → 401/403; verifySessionToken export
├── services/
│   ├── monday-api.js         # THE GraphQL funnel; API-Version pinned; soft errors thrown
│   │                         # + v4 getBoardItems (items_page→next_items_page, truncated surfaced)
│   ├── confirm-service.js    # resolveButton / configIsComplete / performAction (v2 outcomes)
│   ├── digest-service.js     # v4 PURE core: users-board matching + pending classification
│   ├── email-sender.js       # v4 Resend funnel (RESEND_API_KEY + DIGEST_FROM; absent → 409)
│   ├── storage.js            # SecureStorage wrapper + 60s read cache + nonce lifecycle
│   └── secret.js             # generate / constant-time compare / mask
├── helpers/                  # pages (3 static + landing + oauth), rate-limit, snippet (per-button),
│                             # email-template (full email renderer), digest-email (v4 digest renderer),
│                             # digest-amp + amp-cors (V5 Gmail dynamic email), logger, environment
├── storage/                  # secure-storage-backend (prod) / memory-backend (dev+tests)
└── client/admin/             # React 19 + Vite 7 + @vibe/core SPA → built to public/admin/
                              # v4: two tabs — "הגדרות" (v2 flow) + "מייל מסכם" (DigestSection)
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
  no item/account data ever (only the config-derived target label). v4: the
  SUCCESS page (alone) auto-closes after 2s via one inline script.
- **V5 Gmail dynamic email (`/amp/confirm`, spec V5):** the digest gained a
  `text/x-amp-html` part (checkbox per task, one submit per section) that Gmail
  renders as dynamic email; the v4 `text/html` body is UNCHANGED and is the
  universal fallback. The endpoint is the app's only BULK path (cap 50 items)
  and its gate order differs from `/confirm`: the **AMP CORS gate runs FIRST**
  (pure header work → an unlisted sender never reaches storage and cannot probe
  secrets; a rejection carries NO CORS headers so the client discards it).
  Default deny — `AMP_ALLOWED_SENDERS` empty admits nobody; wildcard `*` is
  deliberately unsupported. Unlike Outlook Actionable Messages, an AMP POST
  carries **no clicker identity** — the link secret is still the only
  credential. Sending the AMP part is NOT wired yet (Resend AMP support
  undocumented): the admin panel copies it out of `/api/digest/preview`.
- **v4 digest (phase 1, manual-only):** recipients come from a dedicated
  USERS BOARD (people column → person ids, email column → address); matching
  is person-id intersection with the tasks board's `peopleColumnId`. Pending
  = date < today (strict, Asia/Jerusalem) AND status ≠ the section button's
  target label id — an UNSET status is pending, label id 0 is valid. Rows
  without email/person are skipped+reported, duplicate emails merge. Board
  reads paginate items_page→next_items_page with a page cap that is SURFACED
  (`truncated`), never silent. NOTE: getBoardItems shapes await a sandbox
  probe (fixtures README) before release.

## Env & deploy

Env (platform: `mapps code:env -i 11704868`; local: `.env`): `MONDAY_CLIENT_ID`,
`MONDAY_CLIENT_SECRET` (also verifies sessionTokens), `ALLOWED_ACCOUNT_IDS`
(optional comma-separated allowlist; empty = any installing account; legacy
single `ALLOWED_ACCOUNT_ID` is merged in), `BASE_URL` (stable liveUrl),
`PORT` (8080), `USE_LOCAL_STORAGE` (dev/tests only), v4:
`RESEND_API_KEY` + `DIGEST_FROM` (both optional — without them
`/api/digest/send` answers 409 `email_not_configured`), and V5:
`AMP_ALLOWED_SENDERS` (comma-separated sender addresses allowed to call
`/amp/confirm`; **empty/unset = that endpoint admits nobody**).

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
