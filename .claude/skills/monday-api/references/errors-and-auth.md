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
