# Deadline Confirm — Implementation Spec

**Deliverable:** a monday.com app running on **monday code**, providing (1) a public one-click confirmation endpoint triggered from an email button, and (2) an **Administration View** feature for configuration.
**Executor:** Claude Code. This document is the source of truth. Where it conflicts with defaults or "best practices", this document wins.
**Runtime:** Node.js on monday code. Server: Express (or monday code scaffold default). Client (admin view): React + `monday-sdk-js`.
**Language of UI strings:** Hebrew, RTL. Use the exact strings given in this spec.

---

## 1. Product summary

A monday workflow sends a deadline-reminder email (internal email automation, static HTML template with placeholder mapping). The email contains a button — a plain `<a>` link — pointing at this app's endpoint with the item ID mapped in by the workflow. Clicking it transitions the item's status column from one configured label to another configured label (**confirm-only transition, not a status picker**), records who confirmed via an update on the item, and shows a static confirmation page.

---

## 2. System overview

```
monday workflow (email automation)
        │  static HTML template; workflow maps {ITEM_ID} into the button URL
        ▼
User's email client ── click ──► GET https://<deployment>/confirm?itemId={ITEM_ID}&k=<SECRET>
                                          │
                                   monday code server
                                          │ 1. k check (constant-time, before any API call)
                                          │ 2. rate limit, input validation
                                          │ 3. GraphQL query: item board + status + people (+ optional deadline)
                                          │ 4. guards: board match, status == from-label (+ optional expiry)
                                          │ 5. mutation: status → to-label
                                          │ 6. create_update: "אושר במייל על ידי {assignee}"
                                          ▼
                                 static HTML result page (RTL)

Administration View (iframe in monday admin section)
   ├─ board / status column / from–to label pickers  → client-side monday.api() (seamless auth)
   ├─ config + secret management                     → server routes, sessionToken-authenticated
   └─ OAuth connect (opens new tab)                  → /oauth/start → auth.monday.com → /oauth/callback
```

Single-tenant v1: one monday account, one board, one status column, one transition.

---

## 3. Locked decisions & accepted risks — DO NOT "IMPROVE"

These were decided deliberately. Do not add, remove, or replace them.

1. **One-click direct from email.** No interstitial confirmation page, no POST relay. Residual risk (corporate mail scanners following GET links) is accepted; the only mitigations are the HEAD no-op and the from-status guard. Do not add an interstitial.
2. **Static shared secret `k`.** The email template is static — per-item HMAC signing is impossible by construction. One long random secret, identical in every email, is the ceiling. Accepted: any email recipient technically holds the key for all items; damage is bounded by the single allowed transition. `k` blocks everyone who never received an email and acts as a kill switch (rotate → all old links die).
3. **No automatic secret rotation.** Rejected: the key lives inside a static template that cannot be updated programmatically, and deadline emails are clicked late by nature. Rotation is manual, event-driven (suspected leak, offboarding), via the admin view.
4. **No user identity in the URL.** Attribution comes from the item's People column (single assignee guaranteed by the customer). The endpoint never trusts or receives clicker identity.
5. **Auth for mutations: OAuth authorization-code flow**, token stored in SecureStorage. Not a pasted personal token. **The OAuth consent must be performed while logged in as a low-privilege user with edit rights on the target board only — not an account admin.** The stored token's permission scope is the blast radius. Surface this as a warning in the admin view (string in §10).
6. **The endpoint never returns account data.** Response space is exactly three static pages (§7). No item fields — not even the task name — are echoed. Config-derived strings (e.g., the target label) are permitted.
7. **`/confirm` deliberately bypasses monday's board permission model** (it acts as the token's user). This is contained by: the k gate, the single-board guard, and the single allowed transition.

---

## 4. Storage schema

Use `@mondaycom/apps-sdk`.

**Storage** (non-secret config), key `config`:

```json
{
  "boardId": "1234567890",
  "statusColumnId": "status",
  "fromIndex": 0,
  "fromLabel": "בעבודה",
  "toIndex": 1,
  "toLabel": "בוצע",
  "peopleColumnId": "person",
  "expiryDateColumnId": null,
  "expiryGraceDays": 0
}
```

- `fromIndex`/`toIndex` are the status **label indices** parsed from the column's `settings_str` at config time. Compare and mutate by index (labels can be renamed; indices are stable).
- `expiryGraceDays = 0` (or null `expiryDateColumnId`) disables link expiry. When enabled: a click is valid only while `today <= deadline_date + expiryGraceDays`.

**SecureStorage:**

| key | value |
|---|---|
| `link_secret` | current `k` (base64url, 32 random bytes) |
| `oauth_token` | monday OAuth access token |
| `oauth_state:<nonce>` | short-lived CSRF nonce for the OAuth flow (TTL ~10 min; delete on use) |

Cache `config`, `link_secret`, and `oauth_token` in memory with a 60s TTL to avoid a storage round-trip per click. Invalidate the cache on any admin write.

---

## 5. Environment variables (monday code secrets, via `mapps code:env`)

| var | purpose |
|---|---|
| `MONDAY_CLIENT_ID` | OAuth + admin view |
| `MONDAY_CLIENT_SECRET` | OAuth token exchange **and** sessionToken JWT verification |
| `ALLOWED_ACCOUNT_ID` | single-tenant lockdown; admin routes reject sessionTokens from any other account |
| `BASE_URL` | public deployment URL, used for the OAuth redirect URI and the generated button snippet |

---

## 6. Public endpoint — `GET /confirm`

Query params: `itemId` (digits), `k` (secret).

Algorithm — **exact order**:

1. **`HEAD /confirm`** → `200`, empty body, **no side effects, no storage/API reads**. (Mail-scanner mitigation.)
2. Parse query. If `itemId` fails `/^\d{1,20}$/` or `k` is missing → **400** page (§7.3).
3. **Secret check first, before anything that costs API quota:** compare `sha256(k)` to `sha256(link_secret)` with `crypto.timingSafeEqual` (hashing first equalizes length; never compare raw strings). Fail → **generic invalid page** (§7.2), HTTP 200.
4. **Rate limit** per IP: in-memory token bucket, **30 req/min per IP** → over limit: plain `429`. Do not tighten below 30 — corporate NAT funnels many users through one IP. In-memory is acceptable (single container).
5. Load config + oauth token (memory cache per §4). Missing/incomplete → generic invalid page; `console.error` the reason.
6. **GraphQL query** (§11.1): item's `board.id`, status column `index`, people column `text`, optional deadline `date`.
7. **Guards** — any failure → generic invalid page (log the specific reason server-side only):
   a. item exists;
   b. `item.board.id === config.boardId` (scopes the endpoint to the one board — mandatory);
   c. if expiry enabled: `today <= date + graceDays`;
   d. `status.index === config.fromIndex`. (This is also the idempotency mechanism — a second click finds the status already changed and lands here.)
8. **Mutation** `change_column_value` → `{"index": <toIndex>}` (§11.2).
9. **Mutation** `create_update` with body: `אושר במייל על ידי {peopleColumnText}` (§11.3). If the people column text is empty, body: `אושר במייל`. An update failure after a successful status change is logged but still returns the success page.
10. Return **success page** (§7.1).
11. Any monday API error / 401 → generic invalid page; log full error server-side.

Log every attempt as one structured line: `{ts, ip, itemId, outcome}` where outcome ∈ `ok | bad_key | rate_limited | wrong_status | wrong_board | expired | not_found | no_config | api_error`.

---

## 7. Response pages

Three static HTML documents. Requirements: `<html dir="rtl" lang="he">`, inline CSS only, no JS, no external assets, mobile-friendly (large text, centered card), `Cache-Control: no-store`.

**7.1 Success** (HTTP 200):
- Title/heading: `המשימה עודכנה ✓`
- Body line: `הסטטוס שונה ל"{toLabel}".` (config-derived only)

**7.2 Generic invalid** (HTTP 200 — uniform for: bad `k`, not found, wrong board, wrong status, already done, expired, missing config, API error):
- Heading: `הקישור אינו בתוקף`
- Body line: `ייתכן שהמשימה כבר טופלה או שהקישור הוחלף. אפשר לבדוק את הסטטוס ישירות בלוח.`

**7.3 Bad request** (HTTP 400): heading `בקשה שגויה`.

---

## 8. OAuth flow

Standard monday authorization-code flow (a reference example will be provided to the executor separately; follow it for mechanics, this spec for parameters):

- **Scopes:** `me:read boards:read boards:write updates:write`
- **`GET /oauth/start`**: generate nonce → store `oauth_state:<nonce>` → `302` to `https://auth.monday.com/oauth2/authorize?client_id=...&redirect_uri=<BASE_URL>/oauth/callback&scope=...&state=<nonce>`.
- **`GET /oauth/callback`**: validate + delete `state` nonce → POST `https://auth.monday.com/oauth2/token` (`code`, `client_id`, `client_secret`, `redirect_uri`) → store `access_token` in SecureStorage → query `me { id name }` and cache `{id, name}` in Storage key `oauth_identity` for display → respond with a minimal RTL page: `החיבור הושלם ✓ אפשר לסגור את החלון ולרענן את מסך ההגדרות.`
- The admin view opens `/oauth/start` with `window.open` (new tab) — `auth.monday.com` may refuse to render inside the iframe.
- **monday OAuth tokens do not expire and there is no refresh token.** Any `401` from the API means the token was revoked or the user was removed → treat as "connection broken": log, return generic invalid page on `/confirm`, and expose the broken state in the admin view with a reconnect button.
- Register `<BASE_URL>/oauth/callback` as the redirect URI in the app's OAuth settings.

---

## 9. Admin API (server routes for the admin view)

All routes require a valid monday **sessionToken**: `Authorization` header, JWT verified with `MONDAY_CLIENT_SECRET`, and `accountId === ALLOWED_ACCOUNT_ID` (else 403). These routes are the only place the secret is readable — never expose it on any unauthenticated route.

| route | behavior |
|---|---|
| `GET /api/state` | returns `config`, masked secret (`****` + last 4), OAuth status (`connected` + identity name / `disconnected` / `broken`), `BASE_URL` |
| `PUT /api/config` | validates and saves `config`; invalidates memory cache |
| `POST /api/secret/rotate` | generates 32 random bytes → base64url, saves, invalidates cache, returns the **full new secret once** (for snippet regeneration) |
| `GET /api/snippet` | returns the button HTML (§12) rendered with `BASE_URL` + current secret |

Board/column/label pickers do **not** go through the server: the client calls `monday.api()` directly (seamless auth) for `boards`, the board's `columns (types: [status, people, date]) { id title type settings_str }`, and parses status labels from `settings_str`.

---

## 10. Admin view (Administration View feature)

React app, Hebrew RTL, served from monday code client hosting. Sections top-to-bottom:

1. **חיבור** — OAuth status. Connected: `מחובר כ: {name}` + `נתק/חבר מחדש`. Disconnected/broken: `התחבר ל-monday` button (opens `/oauth/start` in a new tab). Permanent warning line under the button:
   `⚠ יש לבצע את החיבור כשמחוברים כמשתמש עם הרשאת עריכה ללוח היעד בלבד — לא כאדמין. הטוקן שנשמר קובע את היקף הנזק האפשרי.`
2. **הגדרת לוח** — board picker → status column picker (status columns of that board only) → `סטטוס מקור` and `סטטוס יעד` dropdowns populated from the column's labels (store label + index). Also: people column picker (default: first people column), optional deadline date column + `ימי חסד` number input (expiry feature; 0 = off).
3. **מפתח קישור (Secret)** — masked value; `צור מפתח חדש` with a confirm dialog: `החלפת המפתח תנתק את כל הקישורים שכבר נשלחו במייל. להמשיך?`
4. **קוד לכפתור** — read-only `<textarea>` with the §12 snippet (server-rendered via `/api/snippet`), a `העתק` button, and the instruction line: `יש למפות את מזהה האייטם מה-workflow במקום {ITEM_ID}. אל תשנו את הפרמטר k.`
5. **שמירה** — single save button → `PUT /api/config`; disable until required fields are set; show inline success/error.

Keep it one screen, no routing, no state library.

---

## 11. GraphQL operations

Pin the current **stable** API version via the `API-Version` header (check developer.monday.com/api-reference/docs/api-versioning at implementation time; never rely on the unpinned default). All values go through **GraphQL variables — string interpolation of user input is forbidden.**

**11.1 Query item state**

```graphql
query GetItem($itemIds: [ID!], $columnIds: [String!]) {
  items(ids: $itemIds) {
    id
    board { id }
    column_values(ids: $columnIds) {
      id
      text
      ... on StatusValue { index }
      ... on DateValue  { date }
    }
  }
}
```

`$columnIds` = `[statusColumnId, peopleColumnId, expiryDateColumnId?]`. The people column's `text` is the assignee display name — no extra `users` query.

**11.2 Change status**

```graphql
mutation SetStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
}
```

`$value` = `JSON.stringify({ index: config.toIndex })`.

**11.3 Attribution update**

```graphql
mutation AddUpdate($itemId: ID!, $body: String!) {
  create_update(item_id: $itemId, body: $body) { id }
}
```

---

## 12. Email button snippet (generated by the admin view)

Email-client-safe: table wrapper, inline styles, no JS. `{ITEM_ID}` stays literal — the workflow maps the item ID there.

```html
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:16px auto;">
  <tr>
    <td style="border-radius:8px;background-color:#00854d;">
      <a href="<BASE_URL>/confirm?itemId={ITEM_ID}&amp;k=<SECRET>" target="_blank"
         style="display:inline-block;padding:12px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">
        ✓ סמן כבוצע
      </a>
    </td>
  </tr>
</table>
```

Note in the UI: if the workflow template editor renders `&amp;` literally, replace it with a plain `&`.

---

## 13. Security checklist (must all hold at review)

- [ ] `k` compared constant-time (hash-then-`timingSafeEqual`), **before** any storage/API call beyond the cached secret.
- [ ] `itemId` validated by regex and passed only as a GraphQL variable.
- [ ] Board-scope guard (`item.board.id === config.boardId`) enforced.
- [ ] Per-IP throttle 30/min → 429; HEAD → 200 no-op.
- [ ] `/confirm` responses contain zero item/account-derived data; only §7 static pages.
- [ ] Secret and OAuth token only in SecureStorage; readable only via sessionToken-authenticated routes; secret masked in `GET /api/state`.
- [ ] sessionToken verified with client secret + `ALLOWED_ACCOUNT_ID` enforced on every `/api/*` and rejected otherwise.
- [ ] OAuth `state` nonce validated and single-use.
- [ ] No secrets in logs; log line format from §6 only.
- [ ] Nothing beyond this list — no WAF, no captcha, no distributed rate limiting (explicitly out of scope).

---

## 14. App setup & deployment

1. Create the app in the monday Developer Center; add features: **Administration View** (client build URL) and enable OAuth with scopes from §8 + redirect URI `<BASE_URL>/oauth/callback`.
2. Deploy server with `mapps code:push`; set env vars (§5) with `mapps code:env`.
3. Build client, host via monday code client hosting; point the Administration View at it.
4. Manual setup afterwards (documented in README, performed by the operator): log in as the low-privilege user → OAuth connect; configure board/column/labels; generate secret; paste snippet into the workflow email template and map the item-ID placeholder; verify the board's permission mode allows that user to edit items.

---

## 15. Acceptance tests

1. Happy path: click → status `from → to`, update created with assignee name, success page.
2. Second click on the same link → generic invalid page, status unchanged, no duplicate update.
3. Item in a different status (neither from nor to) → generic invalid, unchanged.
4. Item from another board (valid k) → generic invalid.
5. Wrong / missing `k` → generic invalid / 400; **zero monday API calls made** (assert via logs).
6. Rotate secret → old link dies (generic invalid), regenerated snippet works.
7. `HEAD /confirm` → 200, no state change, no log-worthy API activity.
8. 31st request in a minute from one IP → 429.
9. Revoke OAuth token in monday → click → generic invalid; admin view shows `broken` + reconnect works.
10. `/api/*` without sessionToken, with an invalid signature, or from another account → 401/403.
11. Expiry enabled, deadline + grace passed → generic invalid.

---

## 16. Explicit non-goals (v1)

Multi-tenant / marketplace packaging (requires account-keyed storage and per-account OAuth), multiple boards or multiple transitions, per-item signed links, interstitial confirmation page, auto secret rotation, custom domain, localization beyond Hebrew.

---

# V2 Amendment — Dynamic Status Buttons (owner decisions, 2026-07-15)

This amendment SUPERSEDES the conflicting parts of the v1 spec above. Email
scheduling (when to send which template) is implemented OUTSIDE the app.

## Product behavior

- The app exposes **N dynamic action buttons**. Each button carries its own
  URL identifier and defines: a status column (per button!), a target label
  (by stable label id), a display name, and a style (color / icon / size
  sm|md|lg).
- Click semantics: set the button's status column to its target label,
  **regardless of the current status** (the v1 from-status guard and the
  expiry/grace-days feature are REMOVED).
- If the status already equals the target: show the success page, perform
  **no mutation and no update** (emails are re-sent daily by design — silent
  idempotency, outcome `already_done` in logs only).
- Attribution update on success: `סומן "{targetLabel}" במייל על ידי {assignee}`
  (or without the name when the people column is empty).

## URL and scanner protection

- `GET /confirm?itemId={ITEM_ID}&k=<shared secret>&btn=<button id>`.
  One shared secret remains THE kill switch (rotation invalidates all
  buttons in all templates).
- **Mail-scanner protection replaces the from-guard:** GET performs NO
  action and NO monday API call — after the secret gate + rate limit it
  serves a landing page whose inline JS immediately auto-POSTs the hidden
  form back to `POST /confirm`, which performs the action. `<noscript>`
  shows a manual submit button. Link-following scanners (no JS) can never
  change a status. This intentionally amends v1 §7's "no JS" rule for THIS
  page only; the three static result pages stay JS-free.

## Admin panel v2

- Board + attribution people column (global), buttons manager (per-button
  column/label/style + live preview + per-button snippet copy), and a
  **block-based email template editor**: named saved templates composed of
  text blocks (direction rtl/ltr, email-safe font, size 10–32, alignment)
  and button rows; live preview; **copy of the full email-client-safe HTML**
  (600px table, inline styles, {ITEM_ID} literal) per template.
- Config schema and validation: see `src/routes/admin-api.js` module header
  (the authoritative contract) — ids `b_*`/`t_*` generated server-side when
  absent.

## Unchanged from v1

Shared-secret constant-time gate before anything else; 30/min/IP rate
limit; HEAD no-op; the three static result pages as the ONLY action
responses; OAuth flow + broken-state handling; sessionToken-guarded admin
API; single-tenant lockdown; SecureStorage-only persistence; log line
format {ts, ip, itemId, outcome} (outcome enum extended: page_served,
already_done, unknown_button, bad_request).

# V3 Amendment — Multi-Tenant (owner decision, 2026-07-15)

The single-tenant lockdown is replaced by structural per-account isolation.
Motivation: the app is offered to multiple customers; SecureStorage is
segregated per APP only, so account isolation is the storage layer's job
(monday multitenancy best practice: namespace keys by account id).

## Storage

- Every tenant key lives under its account prefix:
  `<accountId>:config | <accountId>:link_secret | <accountId>:oauth_token |
  <accountId>:oauth_identity`. Access ONLY via
  `createAppStorage(...).forAccount(accountId)`.
- OAuth state nonces stay unprefixed (`oauth_state:<nonce>`, globally-unique
  nonce) but the record carries `{ createdAt, accountId }`;
  `consumeOauthState` returns `{ accountId } | null`.
- The 60s read cache is keyed by the full prefixed key — one account's hot
  entry can never serve another. Any write still flushes the whole cache.
- NO migration from v2's bare keys (pre-customer decision): after deploy the
  admin reconfigures and reconnects; old bare-key values are orphaned.

## Links & /confirm

- Confirm URLs carry the tenant:
  `/confirm?itemId={ITEM_ID}&a=<accountId>&k=<secret>&btn=<buttonId>`
  (`a` validated `/^\d{1,20}$/`; missing/invalid → 400 bad_request).
- The secret gate compares against `forAccount(a)`'s secret; the POST action
  runs on that account's config/token. Rate-limit buckets are per
  `${a}:${ip}`.
- v2 links (no `a=`) become invalid (400) — tenants re-copy email HTML from
  the admin after the rollout.

## Admin, OAuth and the allowlist

- `/api/*` handlers operate on the SESSION's account
  (`storage.forAccount(req.session.accountId)`) — cross-tenant reads are
  structurally impossible; snippets/templates embed the session's `a=`.
- `/oauth/start` requires `?st=<sessionToken>` (the SPA passes it): the
  account is extracted server-side (verifySessionToken), stamped into the
  state nonce, and the callback stores the token under that account.
  Missing/invalid st → 401; account outside a non-empty allowlist → 403.
- `ALLOWED_ACCOUNT_ID` (single) is superseded by OPTIONAL
  `ALLOWED_ACCOUNT_IDS` (comma-separated allowlist). Empty/unset = every
  installing account is admitted (isolation is structural). The legacy
  variable, when still set, is merged into the list — existing deployments
  keep their lockdown until env is updated.

# V4 Amendment, Phase 1 — Per-User Digest Email (owner decisions, 2026-07-19)

Design log: `docs/v4-digest-decisions.md` (rev 3). Phase 1 deliberately keeps
the v3 click mechanism (static shared secret, `/confirm` auto-POST landing)
and adds a per-user summary email ON TOP of everything that exists. Nothing
was removed: the per-task template editor + external workflow path keeps
working unchanged. Interactive email (Adaptive Cards) is deferred — see the
decision log §3.

## Product behavior

- The app composes and sends ONE email per user listing all their pending
  tasks, replacing email-per-task fatigue (decision log §1 problem 4).
- Recipients come from a dedicated USERS BOARD: a people column identifies
  the user (person ids), an email column is the address. Task ↔ user matching
  is person-id intersection with the tasks board's `peopleColumnId`.
  Rows missing an email/person are reported as skipped, never guessed.
  Duplicate emails merge (person ids united).
- The digest is split into SECTIONS (1..4; default two, per the approved
  mock). Each section = a date column on the tasks board + one action button +
  a **status condition**. **Pending rule (owner spec 2026-07-20):** date set
  AND date ≤ today (a past date **includes today**; Asia/Jerusalem) AND the
  task's status (on the button's status column) is **one of the section's
  `includeStatusLabelIds`** — "show by status", only the listed statuses enter
  (label id 0 valid; unset status matches nothing). This replaces the earlier
  "≠ button target" rule, which let already-done tasks appear in a
  not-yet-done section. A recipient with zero pending tasks gets no email; an
  empty section is omitted.
- **Email date-column header** = the ORIGINAL board column title
  (`section.dateColumnTitle`), captured when the column is picked in the admin
  (re-save after a board-side rename to refresh).
- Each task row carries the button as a REAL v3 `/confirm` link
  (`itemId + a + k + btn`) — one click, auto-POST, done.
- **Phase 1 sending is MANUAL ONLY** — the "שלח עכשיו" button in the admin's
  new "מייל מסכם" tab. A scheduler is a later phase.

## §7 change — success page auto-close

The success page (and only it) now carries ONE inline script: `window.close()`
2s after render, with a visible fallback line ("אפשר לסגור את החלון…").
Invalid/bad-request pages stay JS-free — a human should read them. This
amends §7's "no JS" wording for the success page alone.

## Storage & config schema (extends §4)

`config.digest` (nullable; absent on old configs — normalized to `null`):

```
digest: {
  usersBoardId: "222",                 // digits
  usersPeopleColumnId: "people_u",
  usersEmailColumnId: "email_u",
  subject: "המשימות שלך — נדרש עדכון סטטוס",   // 1..120
  sections: [ { id: "s_xxxxxxxx", title: "…", dateColumnId: "date_x",
                dateColumnTitle: "תאריך התחלה",   // board title → email <th>
                buttonId: "b_xxxxxxxx",           // must exist
                includeStatusLabelIds: [0, 2] } ] // 1..4 sections; >=1 label id (0 valid)
}
```

A digest block requires `peopleColumnId` to be set (matching column).

**Section order = priority (owner decision 2026-08-04).** The `sections` array
order is meaningful: a task whose conditions match several sections is claimed
by the FIRST section in array order and skipped by the rest — each task appears
exactly once per message (per recipient). The admin UI reorders with ↑/↓ arrows;
no separate priority field exists.

## Environment (extends §5)

- `RESEND_API_KEY`, `DIGEST_FROM` — the Resend sender funnel
  (`src/services/email-sender.js`). Both optional; when either is missing
  `/api/digest/send` answers 409 `email_not_configured`.

## Admin API (extends §9)

- `GET /api/digest/preview[?recipient=<email>]` → 200
  `{ recipients: [{email,name,taskCount}], skippedUsers, truncated, html }`;
  409 `digest_not_configured` / `no_secret` / `not_connected`;
  502 `monday_api_failed`.
- `POST /api/digest/send` → same guards + 409 `email_not_configured`; sends
  per recipient (per-recipient failures isolated), returns
  `{ ok, results: [{email,name,taskCount,ok,error?}], skippedUsers, truncated }`.

## GraphQL (extends §11)

- `getBoardItems` — whole-board read, `items_page` → `next_items_page` cursor
  pagination (page 100, cap 20 pages, `truncated` surfaced — never silent),
  typed fragments Status/Date/People; people filtered to `kind: person`.
  **Pre-release gate:** sandbox probe (WZ- board) + `/monday-api check` — the
  cloud session that authored this had no token (see tests/fixtures/README.md).

---

# V5 Amendment — Gmail Dynamic Email (owner decisions, 2026-07-26)

Design log: `docs/v5-gmail-dynamic-email.md`. The client's organization runs on
**Google Workspace (Gmail)**, so Outlook **Actionable Messages / Adaptive Cards**
— explored earlier — is off the table: it renders in Outlook only. Gmail's
equivalent is **AMP for Email**, which Gmail calls **dynamic email**: a
`text/x-amp-html` MIME part with real form controls that posts to our server
from inside the message.

V5 adds that part ALONGSIDE the V4 digest. Nothing is removed or replaced: the
static `text/html` body with per-task links stays the universal fallback, and
every client that does not render AMP (Outlook, Apple Mail, an old Gmail app, a
user who never allow-listed the sender) gets exactly today's email. Graceful
degradation is a locked property, not an accident.

## Product behavior

- The digest email becomes TWO representations of the same digest data:
  - `text/x-amp-html` — one `<amp-form>` per section, a **checkbox per task**
    and ONE submit button per section: tick several tasks, one click, done,
    without leaving the message. This is what the owner asked for from the
    start (in-email interactivity, no landing page).
  - `text/html` — unchanged V4 body, one link-button per task.
- The AMP part must be placed BEFORE the html part inside
  `multipart/alternative` (some clients render only the last part).
- Gmail strips the AMP part on reply/forward and may stop rendering it after
  ~30 days; both fall back to the html part.

## New endpoint (extends §7)

`POST /amp/confirm` — the app's ONLY bulk mutation path. Ordered contract
(security contract, `src/routes/amp.js` header is authoritative):

1. **AMP CORS gate** (`src/helpers/amp-cors.js`) — FIRST, before any I/O.
   Supports both documented variants: v2 `AMP-Email-Sender` →
   `AMP-Email-Allow-Sender`, and v1 `Origin` + `?__amp_source_origin` →
   `Access-Control-Allow-Origin` + `AMP-Access-Control-Allow-Source-Origin` +
   `Access-Control-Expose-Headers`; v2 wins when both are offered.
   **Default deny** (empty allowlist admits nobody) and the wildcard `*` is
   deliberately unsupported. A rejected caller gets 403 with **NO CORS
   headers** — the email client then discards the body — and never reaches
   storage, so it cannot probe whether a secret is valid.
2. parse+validate `a`, `k`, `btn`, `item[]` (each `/^\d{1,20}$/`,
   1..`MAX_ITEMS`=50) → 400 `bad_request` / `no_items` / `too_many_items`.
3. secret gate (constant-time, account-scoped) → 403 `invalid`.
4. rate limit, bucket `${a}:${ip}` → 429.
5. `performAction` per item — the SAME v2/v3 engine, so already-at-target
   stays a silent success and nothing is written twice; duplicate ids collapse.

Responses from step 2 on carry the CORS headers and are JSON (amp-form feeds
them to `<template type="amp-mustache">`): `{ ok, updated, already, failed,
message }` — counts and a Hebrew message ONLY, never item/board/account data.
Authorized-but-nothing-updated answers **502** so the reader sees the error
template instead of a green one. `OPTIONS /amp/confirm` answers the preflight
under the same CORS gate.

## Environment (extends §5)

- `AMP_ALLOWED_SENDERS` — comma-separated sender addresses whose AMP forms may
  call `/amp/confirm` (trimmed, lowercased, de-duplicated). **Empty or unset =
  the endpoint admits nobody.** Holds the production sender address, plus
  `amp@gmail.dev` while testing through the AMP playground.

## Admin API (extends §9)

- `GET /api/digest/preview` gains `amp` — the amp4email document for the same
  recipient as `html` (both `null` when that recipient has nothing pending).
  The admin panel copies it out for the AMP playground while the AMP sending
  path is still manual.

## Deferred (phase 2)

- Sending the AMP MIME part: Resend's support for `text/x-amp-html` is
  undocumented, so the production sender becomes a dedicated Google Workspace
  mailbox via the Gmail API with the `gmail.send` scope only (send, never
  read) — see the design log. Until then the AMP part is exercised manually.
  > **DISPROVEN as the channel, 2026-08-03/04:** the Gmail API strips the
  > `text/x-amp-html` part on external delivery, so it can never carry AMP
  > (`docs/amp-email-verified-findings.md` §2). The shipped channel is **SMTP
  > XOAUTH2** (`src/services/smtp-sender.js`, scope `https://mail.google.com/`,
  > testing phase — owner decision 2026-08-04); the production channel remains
  > an open owner decision (findings §5).
- Per-task status dropdown (`<select>` per row) instead of a checkbox — the
  format supports it; the owner has seen a mock, no decision yet.

---

# V6 Amendment — AMP-only + per-message signed manifest (owner decisions, 2026-07-27)

Design brief: `docs/v6-amp-only-decisions.md`. **Supersedes** the V5 additive
model: the actionable `text/html` body and the entire `/confirm` route family
are **removed**. Resend is retired; Gmail API send is the planned channel (T9).
*(Superseded 2026-08-04: the Gmail API cannot carry AMP — findings §2 — so T9
landed as **SMTP XOAUTH2**, `src/services/smtp-sender.js`; see the 0.12.x
addendum at the end of this file.)*

## Product behavior

- Digest email = `multipart/alternative`: `text/plain` (non-actionable task list,
  no links/credentials) + `text/x-amp-html` (Gmail dynamic email, the only
  actionable part).
- One **signature per message** over a manifest of authorized (task × button)
  pairs. Wire fields: `a`, `p`, `m`, `s`, `sig` + per-task radio `item_<itemId>`
  (+ since 0.12.0: `note_<itemId>` — one per item, ≤500 chars — when the item's
  cluster maps a required note column; see the 0.12.x addendum below).
  No `k` anywhere in the message (D3/D10).
- Slot = calendar date (YYYYMMDD) of the scheduled send in Asia/Jerusalem;
  configured via `digest.sendHour` (integer 0–23, default 8). No grace window
  for the previous slot (D5/D6).
- D11: at execution, signed `recipientPersonId` must match item assignees
  (`not_assignee` per item — not whole-request rejection).

## Deleted (D2/D4)

- `HEAD/GET/POST /confirm`, landing/success pages, JS auto-submit.
- `GET /api/snippet`, `GET /api/email-template` (secret-unmasking paths).

## Endpoint changes (extends §9)

| Route | V6 change |
|---|---|
| `POST /amp/confirm` | **only** public write path; V6 verification order in `src/routes/amp.js` |
| `POST /api/secret/rotate` | returns `{ ok: true, secret: '****xxxx' }` — full secret never exposed |
| `GET /api/digest/preview` | returns `{ plain, amp }` — drops `html` |
| `PUT /api/config` | `digest.sendHour` validated 0–23, default 8 |

## Deferred (post-V6)

- T9–T12: Gmail multipart send, scheduler, operator summary, resend-today.
  *(Landed; T9's channel is SMTP XOAUTH2, not the Gmail API — see below.)*
- T15: D9 email redesign (multi-button table, one global submit) — awaiting owner briefing.

---

# 0.12.x Addendum — required per-task note + SMTP XOAUTH2 channel (2026-08-03/04)

Shipped state as of 0.12.0; recorded here so §9/§11 stay a complete inventory.
Full semantics: `CLAUDE.md` ("Per-task required note") and
`docs/amp-email-verified-findings.md` (the measured channel facts).

## Required per-task note (extends §9 + the V6 wire contract)

- `config.digest.sections[]` gains optional `noteColumnId` + `noteColumnTitle`
  (a TEXT column on the tasks board), validated by `PUT /api/config`.
- Wire: `note_<itemId>` — one named field inside that row's own form (since
  0.13.0 each row IS a form), cap 500 chars. `routes/amp.js` refuses per item
  (`note_required` / `note_too_long`) and `performAction` guards again; the AMP
  gate is UX only. Since 0.13.0 that gate is `disabled` + `[disabled]` on the
  row's STATUS TRIGGER (no text → the dropdown does not open), not `[disabled]`
  on a bulk submit button, which no longer exists.
- `POST /api/digest/send-raw` (AMP debug lane, extends §9): sends the
  operator's edited amp4email document byte-for-byte through the real MIME +
  send funnel — guards and error codes in `CLAUDE.md`.

## GraphQL (extends §11)

**11.4 Set status + note atomically** — when the selected button's section maps
a note column, §11.2 is NOT used; status and note go out in ONE write so a
marked task can never lack its note (the note value **overwrites** the column):

```graphql
mutation SetColumns($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
  change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
}
```

`$columnValues` = `JSON.stringify({ [statusColumnId]: { index }, [noteColumnId]: text })`.
Sandbox-probe procedure before trusting it live:
`docs/manual-verification-checklist.md` §1.

## Send channel (supersedes "Gmail API send" wherever this file says it)

`users.messages.send` strips the `text/x-amp-html` part on external delivery
(findings §2), so the wired channel is **SMTP XOAUTH2** to `smtp.gmail.com:465`
(`src/services/smtp-sender.js` + `services/google-token.js` + `helpers/rfc822.js`).
SMTP AUTH demands the broad `https://mail.google.com/` scope (findings §5);
granted for the **testing phase** by owner decision 2026-08-04 (D12 suspension —
`docs/v6-amp-only-decisions.md`). The production channel is still an open owner
decision. `gmail-sender.js` is kept for reference/rollback only.

