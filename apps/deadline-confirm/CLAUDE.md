# CLAUDE.md — deadline-confirm

App-internal facts for agents. Repo-wide rules live in the root CLAUDE.md;
the product spec (source of truth, wins over "best practices") is
`docs/spec.md`. V6 decisions brief: `docs/v6-amp-only-decisions.md`.
Operator setup lives in `README.md`.

## What this is

One-click status actions from email (monday code server + admin view), **V6 —
AMP-only with a signed manifest per FORM, and since 0.13.0 one form per ROW**.
The digest is sent as `multipart/alternative` with **three** parts, in the order
`text/plain` → `text/x-amp-html` → `text/html` (0.10.3): a non-actionable plain
fallback (task list only, no links/credentials), the part Gmail renders as
dynamic email, and a non-actionable HTML fallback **derived from the plain part**
(`helpers/digest-html-fallback.js`). Keep all three — the HTML part sources the
inbox preheader and some clients render only the last part — but **the order is
NOT the `INTERNAL_ERROR` fix**: that hypothesis, and the base64-CTE one, were both
disproven by live sends on 2026-08-03. Read
**`docs/amp-email-verified-findings.md`** before any AMP work; it is the measured
account of what actually blocks rendering (the Gmail API strips the AMP part; SPF
must pass on its own; a self-send can never render). The AMP forms post to **`POST /amp/confirm`**
— the app's **only** public write endpoint. Each FORM carries one HMAC signature
over an explicit manifest of authorized (task × button) pairs; since 0.13.0 that
is one form (and one signature) per row, covering that row's task only, and a
status pick submits it immediately. The base link secret never leaves the server
(D3).

Multi-tenant: every account's config/secret/token live under `${accountId}:`
SecureStorage keys. App ID **11704868**, dev-center slug
`yomsheni-il_status-email`.

**Locked decisions (V6 — docs/v6-amp-only-decisions.md) — do not "improve":**
- AMP-only: no **actionable** `text/html` body, no `/confirm` route family
  (D1/D2). Since 0.10.3 an INERT `text/html` fallback IS shipped — derived from
  the plain part, no anchors/forms/scripts/remote images, asserted in
  `tests/digest-html-fallback.test.js`. D1/D2 bans actionable HTML, not HTML.
- One signature per FORM over a signed manifest — per row since 0.13.0, which
  refines D10's "per message" for the rendered email (the route is unchanged and
  still accepts a multi-item manifest); slot derived from scheduled send hour
  (`digest.sendHour`, default 8, Asia/Jerusalem) (D5/D6/D10).
- Link secret is write-only — never returned by any endpoint; rotation is the
  kill switch (D3/D4).
- No clicker identity — AMP carries no verified user; D11 compares signed
  `recipientPersonId` against item assignees at execution time only.
- OAuth token of a LOW-PRIVILEGE user as the blast radius; in-memory rate limit
  (two buckets on `/amp/confirm`: per-IP + per-account).
- **Sending identity is PER ORGANIZATION** (owner decision 2026-07-29 —
  supersedes D12/D13's single vendor-owned mailbox + app-global storage key):
  each tenant connects a Gmail mailbox in its own Workspace under its own OAuth
  client, stored at `${accountId}:google_sender`. This is what keeps DKIM aligned
  with the `From` domain, which Gmail requires before rendering the AMP part.
  D13's operator-only gate on the connect flow is retired with it — a tenant can
  only ever rebind its own sender.
- **Send channel is SMTP XOAUTH2 with scope `https://mail.google.com/`, testing
  phase** (owner decision 2026-08-04 — suspends D12's no-mail-read-scope rule;
  supersession trail: D12/D13 single vendor mailbox → per-org sender 2026-07-29
  → SMTP XOAUTH2 + broad scope 2026-08-04). Forced by measurement, findings §2 +
  §5: the Gmail API strips the AMP part, and SMTP AUTH rejects `gmail.send`.
  Pre-change grants report `broken` in `/api/state` until re-consent; the
  production channel is STILL an open owner decision (findings §5 table).

## Module layout

```
src/
├── index.js                  # env + wiring + listen (nothing testable here)
├── app.js                    # createApp factory — DI for tests (trust proxy, routers, /admin static)
├── routes/
│   ├── amp.js                # POST/OPTIONS /amp/confirm — V6 signed-manifest confirm, ONLY write path
│   │                         # (rendered mail posts ONE row per request; the bulk path stays for hand-built bodies)
│   ├── oauth.js              # /oauth/start + /oauth/callback (§8)
│   ├── oauth-google.js       # /oauth/google/start|callback — connect the tenant's Gmail mailbox (T9b/T9c)
│   └── admin-api.js          # /api/state|config|secret/rotate + /api/digest/preview|send
├── middlewares/session-token.js  # JWT (client secret) + optional allowlist → 401/403
├── services/
│   ├── monday-api.js         # THE GraphQL funnel; API-Version pinned; soft errors thrown
│   ├── confirm-service.js    # performAction (v2 outcomes + D11 assignee check)
│   ├── digest-service.js     # users-board matching + pending classification (single personId per recipient)
│   ├── digest-notes.js       # required-note rules (pure): extractNotes / resolveNoteColumn / classifyNote, cap 500
│   ├── manifest-signature.js # build/parse/sign/verify manifest + currentSlot (pure, no I/O)
│   ├── storage.js            # SecureStorage wrapper + 60s read cache + nonce lifecycle
│   ├── secret.js             # generate / constant-time compare / mask
│   ├── smtp-sender.js        # THE send funnel (emailSender seam): SMTP XOAUTH2 → smtp.gmail.com:465
│   │                         # (the Gmail API strips the AMP part — findings §2); scope pre-flight
│   ├── google-token.js       # Google token lifecycle: per-account memo, 60s cushion, invalid_grant kill switch
│   ├── gmail-sender.js       # SUPERSEDED by smtp-sender (2026-08-04) — kept for reference/rollback, nothing constructs it
│   └── providers/google/oauth.js  # Google token transport (exchange / refresh / auth URL)
├── helpers/                  # pages (oauth only), rate-limit, digest-plain, digest-amp,
│                             # digest-html-fallback (inert text/html part), mime-alternative,
│                             # rfc822 (RFC822 assembly + header-injection refusal, optional Date header),
│                             # digest-email (legacy, unreferenced — superseded by the smtp-sender funnel), amp-cors, logger, environment
├── storage/                  # secure-storage-backend (prod) / memory-backend (dev+tests)
└── client/admin/             # React 19 + Vite 7 + @vibe/core SPA → public/admin/
                              # amp-debug.ts — pure rules behind the AMP editor (size/guards)
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
- **Section order = priority (owner decision 2026-08-04):** a task matching
  several sections' conditions appears ONLY in the first section in config
  order (per recipient — `claimed` set in `digest-service.js`). The admin ↑/↓
  arrows are the whole priority UI; no priority field exists. A rendered email
  can therefore never produce `conflict_item` — that guard remains for
  hand-crafted POSTs only.
- **ONE FORM PER ROW — a status pick writes that item immediately (0.13.0, owner
  decision 2026-08-04).** There is NO global submit button. Every task is a card
  that is its own `<form>`; the loader, the ✓ and any error come from that form's
  own `submitting` / `submit-success` / `submit-error` children, which is the
  whole reason the layout had to leave the table (those blocks must be children
  of the form, and a `<form>` cannot span two `<td>`s). Three things here are
  load-bearing and must not be "simplified":
  1. **The selection rides a radio**, not an amp-bind-bound hidden input.
     `AMP.setState(...)` then `form.submit` in one chain is a RACE — amp-bind
     mutates on the next vsync frame, the submit does not wait — so the POST
     would carry the previous value. The setState in that chain is cosmetic
     (close menu, repaint trigger).
  2. **`change` on the radio submits; `tap` only repaints and closes the menu.**
     `change` is the supported AMP-for-Email pattern for a form control (owner,
     2026-08-04) and fires after the radio is checked. Do NOT merge them: both
     fire on a first pick, so submitting from each double-posts every selection
     and the duplicate answers `already_done`, overwriting the ✓ of the write
     that had just succeeded. The cost of this split is that re-tapping the SAME
     option fires no `change` and does not resubmit — a row whose request failed
     is retried by picking a different status, or from the board.
  3. **Each form is signed over ITS OWN pairs** (one item), so a leaked form
     authorizes one task. `/amp/confirm` is unchanged — it verifies whatever
     manifest arrives.
  Consequence for the wire: one POST per task. `perAccount` capacity is 120/min
  for that reason (`helpers/rate-limit.js` — the constants live there because
  `index.js` binds a port on import), and a one-selection reply says "עודכן" /
  "היה מעודכן כבר" instead of counting.
- **TWO LAYOUTS, ONE DOCUMENT (0.13.0):** a card per task on a narrow screen,
  aligned columns + a per-cluster header strip (`.thead`) on a wide one. The
  DIRECTION is the decision: the card layout is the BASE and the wide layout is
  added inside `@media (min-width:601px)`. A media query is the only width signal
  an amp4email document has (no JS, no viewport API, and the `media` attribute
  applies to amp-* elements only), so a client that strips queries must land on
  the layout that works at any width — cards. Never invert this to a table base +
  `max-width`. Both variants (3-column, and 4-column when a note column is
  mapped) MUST use the same breakpoint, or the header strip and the rows switch at
  different widths. The wide layout is a VISUAL table, not a `<table>`: a `<form>`
  cannot span two `<td>`s. Columns line up because every row is the same width and
  shares the same percentages — which is why those percentages deliberately stop
  short of 100%: inline-blocks carry a whitespace gap between them and a full 100%
  wraps the status column onto its own line, under the row. Nothing interactive
  may ever be styled inside the query (`tests/digest-amp-responsive.test.js`
  asserts it): a layout bug must not be able to hide a tap target.
- **Per-task required note (0.12.0):** a digest section MAY map
  `noteColumnId` + `noteColumnTitle` (a TEXT column on the TASKS board). When it
  does, every row of that cluster gets a text field **inside that row's form**
  and the task **cannot be marked without it**. Enforcement is in three places
  and all three matter: **`disabled` + `[disabled]="dd.n<id> == ''"` on the row's
  status trigger** (owner decision 2026-08-04 — the dropdown does not open at all
  until the field holds text; the STATIC attribute is the initial state, because
  amp-bind does not evaluate bindings on load, and `pointer-events` is outside
  the strict CSS set so `disabled` is the only lever; UX only — AMP runs in the
  reader's client), `routes/amp.js` per-item refusal (the authority), and a final
  guard inside `performAction`. Clearing the field after picking a status is
  deliberately NOT handled (owner: ignore) — by then the write already happened.
  **The lock lives or dies by the `n<id>` state**, which the text input feeds via
  `on="change:…;input-throttled:…"` — `input-throttled` was measured dead in
  Gmail (see `renderNoteField`), so `change` (fires on leaving the field) is what
  is expected to carry it. If BOTH ever fail in a client, that client's mapped
  rows are locked shut — verify with a real send (`send-raw` lane) after any
  change here, and note the wrinkle: the tap that blurs the field only unlocks
  the trigger, so the reader's first tap may need a second.
- **`change:<form>.submit` is CONFIRMED supported in Gmail** (owner, 2026-08-04)
  — that is why the submit hangs off `change` and not off `tap`. What is still
  unverified is narrower: `change` on a TEXT input, which the note lock's
  `dd.n<id>` mirror depends on (`input-throttled` was already measured dead
  there). Without it, a mapped row's trigger stays locked; rows with no mapped
  text column are unaffected. One real send through the `send-raw` lane settles
  it.
- A task listed in TWO clusters (hand-built; the section-priority dedup stops
  buildDigest producing it) now renders TWO independent forms — two ids, two
  signatures, two POSTs. They still share the display state (`l`/`c`) and the
  note key `n<id>`, because it is one task: typing in either field unlocks both
  triggers. Status + note go out in ONE `change_multiple_column_values`
  write, so a marked task can never lack its note; the value **overwrites** the
  column. Target column resolves from the SELECTED BUTTON's section (the wire
  carries no cluster identity) — a button shared by two mapped clusters takes the
  first. Wire field: `note_<itemId>`, ONE per item even across clusters. Cap 500
  chars. `already_done` still short-circuits: no mark, so no note write.
  **`required=` is deliberately NOT used** — one bulk form per message means it
  would block rows the reader never marked.
- **V6 preview:** `GET /api/digest/preview` → `{ plain, amp }` (no `html`).
- **AMP debug lane:** `POST /api/digest/send-raw` `{ amp, to, subject?, plain? }`
  sends the operator's **edited** amp4email document **byte for byte** (no
  re-render) through the same `buildMultipartAlternative` + Gmail funnel. Needs
  neither config nor link secret nor monday token — it tests the MESSAGE, not the
  data. Guards: `invalid_amp` / `invalid_recipient` / `invalid_subject` (400),
  `amp_too_large` >1MB (413), `email_not_configured` (409), `send_failed` (502
  carrying Gmail's own message — that message IS the debug output). Because of it
  `express.json()` runs at a **2mb** limit, not express's 100kb default, and an
  oversized body answers 413 `payload_too_large` instead of 500.
  **`POST /api/secret/rotate` → `{ ok: true, secret: '****xxxx' }`** (masked
  only — full secret never leaves the server).
- **V6 scheduler — full account in `docs/scheduling.md`** (registered 2026-08-05;
  before that date NOTHING was sent automatically): `POST /mndy-cronjob/digest-send` (+ `/scheduler/digest-send`)
  walks `ALLOWED_ACCOUNT_IDS`, runs tenants whose `digest.sendHour` matches the
  current Asia/Jerusalem hour; then optional operator summary to
  `OPERATOR_EMAIL`. The platform cron must be **hourly** (`0 * * * *` UTC) — the
  hour filter lives in the app, so a non-hourly expression means tenants on other
  hours never send at all. Job as stored: `retryConfig { maxRetries: 3,
  minBackoffDuration: 60 }`, `timeout: 300`, `targetUrl /digest-send`.
  - **`-r 0` is NOT reachable from the CLI** — it treats 0 as "not supplied",
    prompts, and stores the default 3. So retries are a fact of life, and the
    handler carries the guard: the cron passes **`skipAlreadySent: true`**, which
    consults a per-slot marker (`digest_sent` = `{ slot, personIds }`, read/write
    THROUGH the cache because the 60s backoff equals the 60s cache TTL) and
    persists it **after every successful send**. A tick killed at 300s therefore
    RESUMES on retry instead of re-mailing everyone. The marker is per
    (slot × personId) for exactly that reason.
  - **Only the cron opts in.** `/api/digest/send` and `resend-today` deliberately
    do not — a deliberate re-send inside the same slot is what they are for. Do
    not "fix" that by defaulting the flag on.
  - The operator summary counts only tenants that were really due (`t.due`). The
    old filter tested a `wrong_hour` skip reason no code produces, so an account
    that had merely never configured a digest counted as due on every tick — an
    hourly summary mail, measured.
  - **Per-employee summary CSV (0.14.0, owner decision 2026-08-05 —
    `docs/scheduling.md` §5.2).** After a tick, each tenant that RAN gets a
    `multipart/mixed` mail — plain body + `digest-summary-<slot>.csv` — sent to
    **its own sending mailbox** (`${accountId}:google_sender`, a send to itself),
    deliberately NOT `OPERATOR_EMAIL`: the report follows whatever mailbox the
    admin screen connected, so there is no second setting to drift. Four things
    are load-bearing: the **UTF-8 BOM** (without it Excel opens Hebrew as
    mojibake — written as `\uFEFF`, never a literal); the cluster columns are
    **derived from `config.digest.sections` in order** so the file tracks the
    settings; there is **a row per employee including everyone who got nothing**
    (`kind` = sent / failed / already_sent / no_tasks / skipped, and the reason
    rides in the `שגיאה` column since it is the only free-text slot in the
    owner's column list); and a failed report is **logged, never fatal** — the
    digests are already out, and a non-2xx here would retry the whole tenant.
    Only `routes/scheduler.js` mails it: `runDigestForAccount` returns
    `summaryRows`/`summarySections` to every caller, and the admin routes ignore
    them (the screen shows its own result). An unrecognized `kind` THROWS
    (`unknown_summary_row_kind`) rather than printing a row of zeros that reads
    as "fine". Attachments need `helpers/mime-mixed.js`, which nests a
    `multipart/alternative` body **byte-for-byte** with no CTE of its own — a
    re-wrap is exactly what strips the AMP part (findings §2).
  - **`durationMs` per tenant (0.14.0)** — `tenant run finished` in the log AND
    in the tick response, so `scheduler:run` answers "does 300s suffice?" (§7.3)
    without log spelunking. It is measured with two `now()` reads around the run;
    the run itself still receives the FROZEN tick clock (`() => clock`) so a long
    batch cannot straddle a slot boundary and sign two slots.
- **V6 resend:** `POST /api/digest/resend-today` — all recipients, current slot.

## Env & deploy

Env (platform: `mapps code:env -i 11704868`; local: `.env`): `MONDAY_CLIENT_ID`,
`MONDAY_CLIENT_SECRET`, **`ALLOWED_ACCOUNT_IDS` (required tenant roster —
empty = default-deny: nobody admitted, nobody sent)**, `BASE_URL`, `PORT`,
`USE_LOCAL_STORAGE` (dev/tests), `AMP_ALLOWED_SENDERS` (empty = nobody admitted
to `/amp/confirm`), `OPERATOR_EMAIL` (optional; D8 summary destination),
**`GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET`** (T9b; absent → no
sender is constructed and `/api/digest/send` answers 409 `email_not_configured`).
Sending is WIRED (0.10.0, channel swapped to SMTP XOAUTH2 in 0.12.x) — a tenant
must still connect a mailbox via `/oauth/google/start` before anything sends,
with the broad scope (a pre-2026-08-04 grant reports `broken` until re-consent).
Per-org setup: `docs/google-setup-guide.md`. Post-merge manual verification
(sandbox probe, two-mailbox send, scheduler round, the outbound-465 risk):
`docs/manual-verification-checklist.md`.

Deploys ONLY via the pipeline (root CLAUDE.md): merge to `develop` → draft,
merge to `main` → live. Server-type app: workflow pushes app root; CI runs
`vite build` → `public/admin/`.

## Tests

`npm test` (vitest). Server suite is TDD-gated via test-guard. monday-facing
doubles from `tests/fixtures/` only. Key suites: `tests/amp-route.test.js`,
`tests/manifest-signature.test.js`, `tests/admin-api*.test.js`,
`tests/digest-*.test.js`.
