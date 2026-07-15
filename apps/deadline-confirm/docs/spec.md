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
