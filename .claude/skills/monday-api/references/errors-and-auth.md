# Errors & Auth — read `extensions.code`, then think

<!-- Error-code table verified against developer.monday.com/api-reference/docs/errors on 2026-07-02. -->

## THE rule: HTTP 200 does not mean success

Most monday errors arrive as **HTTP 200 with an `errors` array** — application-level
failures ride a successful transport. **Always inspect `errors[].extensions.code`** and
never treat a 200 as success without checking. `data` can be PARTIAL alongside errors — one
bad field can fail an entire compound query, which looks like a bigger break than it is:
isolate by removing the suspect field/sub-selection.

```js
const res = await monday.api(query, { variables });
if (res.errors) {
  const codes = res.errors.map(e => e.extensions?.code);
  // classify by code — res.data may still hold partial results
}
```

Response anatomy: `errors[].message`, `errors[].extensions.{code, status_code, error_data,
retry_in_seconds}`, top-level `extensions.request_id` and `extensions.warnings[]`
(deprecation warnings, `code: "deprecatedField"` — surface these, they are your early alarm).

## Error-code table (live docs, 2026-07-02)

| Code | HTTP | Meaning | Retry? |
|---|---|---|---|
| `COMPLEXITY_BUDGET_EXHAUSTED` | 429 | Budget spent for the rolling minute | ✅ wait `retry_in_seconds` |
| `IP_RATE_LIMIT_EXCEEDED` | 429 | >5,000 req / 10s from one IP | ✅ backoff |
| `Rate Limit Exceeded` | 429 | Per-minute request cap (1k/2.5k/5k by plan) | ✅ `Retry-After` |
| `maxConcurrencyExceeded` | 429 | Too many simultaneous queries (40/100/250 by plan) | ✅ backoff |
| `FIELD_LIMIT_EXCEEDED` | 429 | Field-level concurrency (e.g. subitems) | ✅ wait `retry_in_seconds` |
| `REQUEST_MAX_COMPLEXITY_EXCEEDED` | — | Single request over the 5M cap (2025-10+) | simplify, then retry |
| `DAILY_LIMIT_EXCEEDED` | — | Daily call cap (1k/10k/25k by plan) | ❌ wait for next day |
| `IDEMPOTENCY_CONFLICT` | 409 | Same idempotency key still processing | ✅ after it settles |
| `Resource locked` (423) | 423 | Board locked by a concurrent update | ✅ short backoff |
| `API_TEMPORARILY_BLOCKED` | 200 | Platform-side API incident | ✅ later |
| `Internal Server Error` | 500 | Server-side — BUT see misdiagnosis playbook below | ⚠️ verify query first |
| `USER_ACCESS_DENIED` | 403 | User inactive / view-only / unconfirmed | ❌ |
| `UserUnauthorizedException` | 403 | User lacks permission for the action | ❌ |
| `missingRequiredPermissions` | 200 | OAuth scopes insufficient | ❌ fix scopes/token |
| `UNAUTHORIZED_FIELD_OR_TYPE` | 200 | Field/mutation outside token's scopes | ❌ see stale-token playbook |
| `ColumnValueException` | 200 | Wrong column value format | ❌ fix format (column-formats.md) |
| `CorrectedValueException` | 200 | Value type mismatch on column update | ❌ |
| `InvalidColumnIdException` / `InvalidBoardIdException` / `InvalidUserIdException` | 200 | Bad/inaccessible id | ❌ |
| `InvalidColumnTypeException` | 200 | `query_params` rule on a column type that cannot be filtered server-side — **mirror is the big one** (`error_data.actual_type: "lookup"`, `column_id: null`). Nulls the WHOLE board node (`data.boards: [null]`), so one bad rule in an `and` group kills every result. Verified 2026-07-29 at 2025-04/2026-04/2026-07 | ❌ filter that column client-side (column-formats.md → Mirror columns) |
| `InvalidArgumentException` | 200 | Bad argument / pagination overrun / board missing | ❌ |
| `InvalidVersionException` | 200 | Malformed API-Version header | ❌ (versioning.md) |
| `ItemsLimitationException` | 200 | Board >10,000 items | ❌ |
| `ItemNameTooLongException` | 200 | Item name >255 chars | ❌ |
| `ResourceNotFoundException` | 200/404 | Item/group/board/user id doesn't exist | ❌ |
| `DeleteLastGroupException` | 409 | Deleting a board's only group | ❌ |
| `RecordInvalidException` | 422 | Subscriber (400+) / board (10k+) limits | ❌ |
| `CreateBoardException` | 200 | Board create/duplicate failed | ❌ |
| `JsonParseException` / `Parse error` | 400/200 | Malformed JSON / query syntax | ❌ |
| `Unauthorized` | 401 | Bad/missing token (plain HTTP, not GraphQL) | ❌ |

## Playbook: "500 / GraphQL validation errors" is often YOUR query, not their server

monday wraps genuine query-validity problems (bad operator, wrong `compare_value` shape,
unknown field) in the SAME `"Graphql validation errors"` / 500 `service: "monolith"`
envelope as real transient errors. Real incident: `compare_value: ["2026-01-01"]` instead of
`["EXACT","2026-01-01"]` was misdiagnosed as a transient 500 and "fixed" with retries; monday
later switched the same bad query to **empty success**, masking the bug entirely.

**Before adding retry/resilience to a failing call:** (1) check operator names /
`compare_value` shape / field types against the schema and docs, (2) cross-check a working
app in this workspace with the same query shape, (3) only treat as transient AFTER the query
is proven valid. Resilience on a malformed query hides the bug.

Seamless-iframe variant (PROVEN 2026-07-12, discussions incident): an in-iframe
`monday.api()` rejection can surface as `"Graphql validation errors"` with ALL detail
fields null (`statusCode`/`responseErrors`/`requestId` null — the seamless parent strips
the errors array) even when the underlying error is an ordinary SOFT error. In the incident
the real error (reproduced via token probe on a scratch managed column) was
`ColumnValueException: "The dropdown label 'X' does not exist"` — see the managed-column
rule in column-formats.md. Diagnosis order for a detail-stripped seamless failure: prove
the document valid (schema check) → probe the byte-identical payload via token on scratch
data — the token path returns the REAL `extensions.code` the seamless path hid.

## Playbook: `UNAUTHORIZED_FIELD_OR_TYPE` on a newly-scoped mutation = stale OAuth token

OAuth tokens **freeze their scopes at grant time**. If a scope was added to the app AFTER a
user's token was minted, that stored token fails with `UNAUTHORIZED_FIELD_OR_TYPE` on the
newly-scoped field (e.g. `create_notification`, `team_subscribers`) even though the
app-level scope is enabled and newer tokens work on the identical call.

Diagnosis: does the failing token predate the scope addition? Does a newer token succeed on
the same call? → **The fix is the user re-authenticating (re-grant OAuth), not a code
change.** Verified in two independent incidents.

Related: `team_subscribers` can return null / unauthorized at an app's OAuth scope while
`owners`/`subscribers` in the same query succeed — isolate the failing field.

## Board membership & subscribers

- **People-column writes need board subscribership**: assigning a person fails
  (`invalidPersonAssignment`) unless they are a member of the board — grant membership first.
- **`board_kind: public` makes `delete_subscribers_from_board` futile**: it "succeeds"
  (returns the removed id) but the person still appears in `subscribers` — public boards
  grant implicit account-wide access not modeled as individual subscriptions. Individual
  add/remove only means something on `private`/`share` boards. Platform behavior, not a bug.
- Subscriber/team mutations take `ID!`/`[ID!]!` — but passing them as GraphQL **variables**
  has failed through the SDK; **inline numeric id literals** into the query string (ints
  coerce to ID!). Enum casing differs between sibling mutations: `add_teams_to_board` kind is
  lowercase (`owner`/`subscriber`); `add_subscribers_to_object` kind is UPPERCASE
  (`OWNER`/`SUBSCRIBER`). Re-adding an existing owner as `subscriber` DEMOTES them.
  `delete_teams_from_board` cannot remove the "everyone at account" team (id `-1`).

## monday.storage hazards (client-side apps)

- `monday.storage.getItem` can transiently return `{success:true, value:null}` for an
  instance that IS configured — byte-identical to a truly-new instance. The `version` field
  is NOT a reliable discriminator. **Data-loss risk:** misreading a false-empty as "new" and
  saving defaults (with nulled `previous_version`) silently overwrites real settings. Guard
  writes with an independent "really unconfigured?" signal (e.g. a localStorage breadcrumb —
  separate failure domain).
- Backend `@mondaycom/apps-sdk` Storage: `get/set/delete`, `previousVersion` for optimistic
  locking; limits 6MB per key, 12 req/s.
- **Keys must be short plain ASCII — free text (Hebrew) in a key gets the write REJECTED.**
  Inferred from production behavior 2026-08-05 (discussions round360): `setItem` under a key
  embedding a percent-encoded Hebrew name (`..._%D7%93...`) resolves
  `{data:{success:false, error:{…}}}` while the SAME (even larger) value saves fine under a
  short ASCII key. Undocumented — the docs state only a 256-char key cap and 6MB value cap.
  Two corollaries: (1) never build storage keys from user-entered names — digest them
  (e.g. FNV-1a over UTF-8 bytes) or key by a stable id; (2) `setItem` rejections resolve with
  an OBJECT in `error`, not a string — stringify before interpolating, and always check
  `success` (a rejected write otherwise looks exactly like a saved one).

## Seamless SDK quirks

- Iframe `monday-sdk-js` **ignores `setApiVersion()`** — see versioning.md.
- Client-only apps (`mapps code:push --client-side`) have **no backend**: telemetry/webhook
  designs must target a browser-reachable third-party sink, and the sink's host must not be
  blocked by monday's iframe CSP `connect-src` (verify live, not statically determinable).

## Docs lookup without a browser

`ask_developer_docs` is a live GraphQL field usable through the token-safe wrapper:

```bash
.claude/skills/mapps/mapps-api.sh '{ ask_developer_docs(query: "...") { answer } }'
```

Note: introspection fields and regular fields cannot be mixed in one query — split them.

## Playbook: `USER_UNAUTHORIZED` on create_item while the monday UI ALLOWS the same action (new board-roles accounts)

Verified live 2026-08-05 on a customer account (identifiers + monday request_ids kept in the
owner's private incident notes — this repo is public, so no live account/board ids here):

- The board carried the CLASSIC permission `permissions: "collaborators"` with a single
  classic owner. A second full member (not guest, not viewer) was granted edit via the NEW
  board-roles system (default role "Contributor") — and could create items **in the monday
  UI**. The **API** (`create_item`, and even `add_users_to_board` to self-elevate) returned
  `USER_UNAUTHORIZED` (403) for that same user. The two permission layers genuinely diverge:
  the UI honours the new roles, the API enforces the classic subscribers/owners lists.
- Through the seamless iframe this surfaced as the detail-stripped `"Graphql validation
  errors"` envelope (see the seamless-variant playbook above) — the playground was what
  exposed the real 403.
- **Fix is classic-layer, and only a classic owner (or account admin) can apply it:** either
  board ⋯ → Board permissions → "Everyone can edit", or add the affected user to the board's
  members/owners. The blocked user cannot self-repair (`add_users_to_board` is refused too).
- App-design consequence: an app whose writes run as the viewing user can fail for users who
  look fully entitled in the UI. When provisioning creates boards, the INSTALLER becomes the
  sole classic owner — other users of the same install hit this the moment the board's
  classic permission is anything but "everyone". Diagnosis in the API playground as the
  affected user — **read-only first**: `me { is_guest is_view_only }` +
  `boards(ids:){ permissions owners { id } }` names the exact gap without touching data.
  A WRITE reproduction (`create_item`) against a live customer board is a last resort:
  only with the owner's explicit go-ahead, and the created test item must be deleted
  immediately — otherwise reproduce on a sandbox clone (golden rule 4).
