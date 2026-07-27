# CLAUDE.md — deadline-confirm

App-internal facts for agents. Repo-wide rules live in the root CLAUDE.md;
the product spec (source of truth, wins over "best practices") is
`docs/spec.md`. V6 decisions brief: `docs/v6-amp-only-decisions.md`.
Operator setup lives in `README.md`.

## What this is

One-click status actions from email (monday code server + admin view), **V6 —
AMP-only with per-message signed manifest**.
The digest is sent as `multipart/alternative`: a non-actionable `text/plain`
fallback (task list only, no links/credentials) plus a `text/x-amp-html` part
that Gmail renders as dynamic email. The AMP form posts to **`POST /amp/confirm`**
— the app's **only** public write endpoint. Each message carries one HMAC
signature over an explicit manifest of authorized (task × button) pairs; the
base link secret never leaves the server (D3).

Multi-tenant: every account's config/secret/token live under `${accountId}:`
SecureStorage keys. App ID **11704868**, dev-center slug
`yomsheni-il_status-email`.

**Locked decisions (V6 — docs/v6-amp-only-decisions.md) — do not "improve":**
- AMP-only: no actionable `text/html` body, no `/confirm` route family (D1/D2).
- One signature per message over a signed manifest; slot derived from scheduled
  send hour (`digest.sendHour`, default 8, Asia/Jerusalem) (D5/D6/D10).
- Link secret is write-only — never returned by any endpoint; rotation is the
  kill switch (D3/D4).
- No clicker identity — AMP carries no verified user; D11 compares signed
  `recipientPersonId` against item assignees at execution time only.
- OAuth token of a LOW-PRIVILEGE user as the blast radius; in-memory rate limit
  (two buckets on `/amp/confirm`: per-IP + per-account).

## Module layout

```
src/
├── index.js                  # env + wiring + listen (nothing testable here)
├── app.js                    # createApp factory — DI for tests (trust proxy, routers, /admin static)
├── routes/
│   ├── amp.js                # POST/OPTIONS /amp/confirm — V6 signed-manifest bulk confirm (ONLY write path)
│   ├── oauth.js              # /oauth/start + /oauth/callback (§8)
│   └── admin-api.js          # /api/state|config|secret/rotate + /api/digest/preview|send
├── middlewares/session-token.js  # JWT (client secret) + optional allowlist → 401/403
├── services/
│   ├── monday-api.js         # THE GraphQL funnel; API-Version pinned; soft errors thrown
│   ├── confirm-service.js    # performAction (v2 outcomes + D11 assignee check)
│   ├── digest-service.js     # users-board matching + pending classification (single personId per recipient)
│   ├── manifest-signature.js # build/parse/sign/verify manifest + currentSlot (pure, no I/O)
│   ├── storage.js            # SecureStorage wrapper + 60s read cache + nonce lifecycle
│   └── secret.js             # generate / constant-time compare / mask
├── helpers/                  # pages (oauth only), rate-limit, digest-plain, digest-amp,
│                             # digest-email (legacy send path until Gmail T9), amp-cors, logger, environment
├── storage/                  # secure-storage-backend (prod) / memory-backend (dev+tests)
└── client/admin/             # React 19 + Vite 7 + @vibe/core SPA → public/admin/
                              # two tabs — "הגדרות" + "מייל מסכם" (DigestSection)
```

## Non-obvious semantics (bugs waiting to happen)

- **`buttons[].targetIndex` holds a status LABEL ID** — label id **0 is valid**.
- **`digest.sendHour`** (0–23, Asia/Jerusalem): slot rolls at send hour, not
  midnight. Resend during the same slot day produces identical signatures (D6/D8).
- **`manifest-signature.js`** is pure — canonical manifest format:
  `itemId:btnId[,btnId…][;itemId:…]` (items ascending, buttons ascending).
- **`POST /amp/confirm` gate order** (security contract, `src/routes/amp.js`):
  AMP CORS → parse wire fields (`a`, `p`, `m`, `s`, `sig`, `item_<id>`) →
  verify signature BEFORE reading selections → slot check → rate limits →
  performAction per selection (D11: `not_assignee` if person not on item).
- ALL storage via `storage.forAccount(id)` with `${accountId}:` prefix; 60s
  read cache invalidated on any write.
- `/oauth/start` requires `?st=<sessionToken>` — connecting account comes from JWT.
- monday OAuth tokens don't expire — any API 401 = revoked → admin `broken`.
- **v4 digest:** recipients from USERS BOARD — **one message per row** (D16; same
  email on two rows → two messages); rows with ≠1 person skipped as
  `multi_person`. Pending = date ≤ today (Asia/Jerusalem) AND status in
  section's `includeStatusLabelIds`.
- **V6 preview:** `GET /api/digest/preview` → `{ plain, amp }` (no `html`).
  **`POST /api/secret/rotate` → `{ ok: true, secret: '****xxxx' }`** (masked
  only — full secret never leaves the server).
- **V6 scheduler:** `POST /mndy-cronjob/digest-send` (+ `/scheduler/digest-send`)
  walks `ALLOWED_ACCOUNT_IDS`, runs tenants whose `digest.sendHour` matches the
  current Asia/Jerusalem hour; then optional operator summary to `OPERATOR_EMAIL`.
- **V6 resend:** `POST /api/digest/resend-today` — all recipients, current slot.

## Env & deploy

Env (platform: `mapps code:env -i 11704868`; local: `.env`): `MONDAY_CLIENT_ID`,
`MONDAY_CLIENT_SECRET`, **`ALLOWED_ACCOUNT_IDS` (required tenant roster —
empty = default-deny: nobody admitted, nobody sent)**, `BASE_URL`, `PORT`,
`USE_LOCAL_STORAGE` (dev/tests), `AMP_ALLOWED_SENDERS` (empty = nobody admitted
to `/amp/confirm`), `OPERATOR_EMAIL` (optional; D8 summary destination). Gmail
OAuth/send (T9/T9b/T9c) not wired yet — `/api/digest/send` answers 409
`email_not_configured` and the scheduler skips with the same reason.

Deploys ONLY via the pipeline (root CLAUDE.md): merge to `develop` → draft,
merge to `main` → live. Server-type app: workflow pushes app root; CI runs
`vite build` → `public/admin/`.

## Tests

`npm test` (vitest). Server suite is TDD-gated via test-guard. monday-facing
doubles from `tests/fixtures/` only. Key suites: `tests/amp-route.test.js`,
`tests/manifest-signature.test.js`, `tests/admin-api*.test.js`,
`tests/digest-*.test.js`.
