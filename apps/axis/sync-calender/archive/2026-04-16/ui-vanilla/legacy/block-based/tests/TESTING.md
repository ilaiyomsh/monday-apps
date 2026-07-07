# Testing Guide — sync-calender

Complete guide to the end-to-end test suite. If you just want to run the tests, jump to [Quick start](#3-quick-start). If you're debugging a failure, jump to [Troubleshooting](#9-troubleshooting). If you're adding a new test, see [How to write a new scenario](#7-how-to-write-a-new-scenario).

---

## 1. Overview

The app syncs Google Calendar events → monday.com board items in two hops:

1. **Google webhook** — Google pushes a change notification to `/webhook/calendar`.
2. **Trigger → action** — the app fetches the changed events from Google, fires a rich trigger per event to monday, which in turn invokes `/actions/sync-events`. The action creates / updates / deletes items on the board.

The test suite exercises both hops in two tiers:

```
Tier 1 (action-direct)    — fast, hits the DEPLOYED /actions/sync-events
                            directly with a signed JWT. Skips the webhook
                            path entirely. Great for verifying CRUD on
                            monday without spinning up Google.

Tier 2 (full E2E)         — spawns the app LOCALLY with a file-based
                            storage shim + a mock Google server. Exercises
                            the webhook → trigger → action loop end-to-end.
                            monday is always real; only Google is mocked.
```

Every scenario writes a timestamped entry to both `tests/results.log` (human-readable) and `tests/results.jsonl` (machine-parseable). Test items created on the board are **left in place** — delete them manually when done inspecting.

---

## 2. Prerequisites

Populate `.env` at the repo root:

| Env var | Tier 1 | Tier 2 | Where to get it |
|---|---|---|---|
| `MONDAY_SIGNING_SECRET` | ✓ | ✓ | Dev Center → app 11119011 → Build → General settings |
| `MONDAY_API_TOKEN` | ✓ | ✓ | monday.com → profile → Admin → API |
| `TEST_APP_URL` | ✓ | — | Defaults to `https://live1-service-27549619-d2f728f4.us.monday.app` |
| `TEST_CHANNEL_ID` | ✓ | — | `grep "subscribe complete" $(mapps code:logs -i <live-id> -s live -t console)` — pick the most recent channelId |
| `TEST_BOARD_ID` | ✓ | ✓ | Defaults to `1953193772` (the test board) |
| `TEST_LINK_COLUMN_ID` | ✓ | ✓ | Defaults to `link_mm2dfvy3` |
| `TEST_DATE_COLUMN_ID` | ✓ | ✓ | Defaults to `date_mkqwkw4q` |
| `TEST_TEXT_COLUMN_ID` | ✓ | ✓ | Defaults to `text_mkqwc4p1` |
| `TEST_LOCAL_PORT` | — | ✓ | Defaults to `8081` (local app port) |
| `MOCK_PORT` | — | ✓ | Defaults to `9999` (mock Google port) |

> **Tier 2 does not use `TEST_CHANNEL_ID`** — each scenario seeds its own channel row directly into the local storage file.

`.env` is git-ignored; the API token never leaves your machine.

---

## 3. Quick start

```bash
# Single scenario (any tier)
node tests/run.js action/create-event
node tests/run.js e2e/self-organized-create

# All Tier 1 scenarios (~60s — hits deployed server)
node tests/run.js all action

# All Tier 2 scenarios (~4–6 min — local server + mock Google)
node tests/run.js all e2e

# Everything
node tests/run.js all

# Manual cleanup of test-* items afterwards
node -e "import('./tests/lib/cleanup.js').then(m=>m.deleteItemsByPrefix().then(console.log))"
```

Pass `VERBOSE=1` to stream subprocess stdout/stderr:

```bash
VERBOSE=1 node tests/run.js e2e/accept-then-decline
```

---

## 4. Architecture

### Tier 1 — action-direct

```
┌────────────────┐ signed JWT ┌─────────────────────────────┐
│  tests/run.js  │───────────▶│  DEPLOYED /actions/sync-    │
│  (signs JWT    │            │  events  (live1-*.monday.app)│
│   locally)     │            └──────────┬──────────────────┘
└────────────────┘                       │
                                         │ monday GraphQL (real token)
                                         ▼
                                ┌──────────────────┐
                                │  monday.com API  │  ← test board 1953193772
                                └──────────────────┘
```

The outer JWT wraps the user's real monday API token as `shortLivedToken`. The app's authenticationMiddleware verifies the signature; then the server uses the API token to do CRUD on monday — exactly like production, just without the trigger-fire hop.

### Tier 2 — full E2E

```
                   ┌──────────────────────────────────────┐
                   │                        monday API   ←│── test board 1953193772
                   └──────────────────────────────────────┘
                                    ▲
                                    │  (real GraphQL)
                                    │
  ┌──────────────┐    ┌──────────────────────┐    ┌──────────────────────────┐
  │  tests/run.js│───▶│ local app  :8081     │───▶│ mock-google :9999        │
  │  (test runner│    │  USE_LOCAL_STORAGE=t │◀───│   • /calendar/v3/* (API) │
  │   seeds mock │    │  GOOGLE_API_BASE_URL │    │   • /mock-monday/relay/* │
  │   + fires    │    │    = :9999           │    │     (re-signs JWT +      │
  │   webhook)   │    │                      │    │      forwards to app)    │
  └──────────────┘    └──────────────────────┘    └──────────────────────────┘
                            │                           ▲
                            │ fireTrigger               │
                            │   (to webhookUrl in       │
                            │    channel storage =      │
                            │    mock-monday/relay)     │
                            └───────────────────────────┘
```

**Key insight**: the app's `webhookUrl` (usually monday.com) is pointed at mock-google's `/mock-monday/relay/:channelId`. The relay receives the trigger payload, re-signs a proper action JWT wrapping the test's API token, and POSTs to the app's `/actions/sync-events`. This closes the loop entirely on localhost — monday API is the only real external dependency.

---

## 5. Scenario catalog

### Tier 1 — `tests/scenarios/action/`

| Scenario | Purpose | Action taken | Expected |
|---|---|---|---|
| `create-event` | Create an item end-to-end with date + link column. | POST signed JWT, `eventStatus=confirmed`, new `eventId`. | Item appears; link URL populated; date column UTC-converted. |
| `update-title` | Same eventId, different `itemName` → the item should be renamed (not duplicated). | 2 invocations. | Same `itemId`, new name; old name gone from board. |
| `update-time` | Same eventId, different `startDate`. | 2 invocations. | Same `itemId`, date column reflects new UTC time. |
| `update-description` | Same eventId, different text-column value. | 2 invocations. | Text column updated; itemId unchanged. |
| `update-location` | Mirror of update-description (semantic "location"). | 2 invocations. | Column updated. |
| `update-multiple` | One invocation changes title + date + description together. | 2 invocations (create, then multi-update). | All three reflect v2; same itemId. |
| `delete-event` | `eventStatus=cancelled` for an existing item. | 2 invocations. | Item removed from board. |
| `cancelled-no-item` | `eventStatus=cancelled` for an eventId that was never created. | 1 invocation. | 200 no-op; no stray item. |
| `timezone-edge` | Israel 23:45 +03:00 ⇒ UTC 20:45 **same day** (no day flip). | 1 invocation. | Date column has same date, time `20:45:00`. |

### Tier 2 — `tests/scenarios/e2e/` (core)

_All-day events are skipped entirely — see `edge/all-day-event`._

| Scenario | Purpose |
|---|---|
| `self-organized-create` | User is sole organizer (no attendees). Webhook fires; item created. |
| `accepted-create` | User invited; has already accepted. Webhook fires; item created. |
| `invited-no-response` | User invited; `responseStatus=needsAction`. Webhook **skips** — no item. |
| `invited-then-accept` | Phase 1 needsAction (skipped). Phase 2 accepted → item created. |
| `accept-then-decline` | Phase 1 accepted (item). Phase 2 declined — **R8 fix**: webhook re-maps to cancelled; item deleted. |
| `accept-then-cancel-event` | Phase 1 accepted. Phase 2 `event.status=cancelled` (organizer cancelled) — item deleted. |
| `batch-multiple-events` | One webhook surfaces 3 events; 3 items created. |
| `create-then-update-same-batch` | Same eventId appears twice in one batch; last write wins on monday. |
| `update-title-via-webhook` | Verify rename propagates through the full webhook flow. |
| `update-time-via-webhook` | Verify date-column update via webhook flow. |
| `update-description-via-webhook` | Verify text-column update via webhook flow. |
| `update-location-via-webhook` | Verify location (text column) update via webhook flow. |
| `update-multiple-via-webhook` | Verify name + date + text all update in one webhook. |
| `duration-field` | Verify the computed `duration` (minutes) is present in the trigger output, ready to be mapped to a numbers column. |

### Tier 2 edge cases — `tests/scenarios/e2e/edge/`

| Scenario | Purpose |
|---|---|
| `all-day-event` | Google all-day event (`start.date`, no `start.dateTime`) → webhook SKIPS; no item is created. |
| `dst-boundary` | Israel DST transition date → UTC conversion stays correct. |
| `unicode-title-description` | Hebrew + emoji + newlines round-trip cleanly through all layers. |
| `long-title` | 300-char title. **Documents** monday's 256-char `ItemNameTooLongException`. The test passes but records that monday rejects. |
| `empty-title` | Google allows no-summary events → action falls back to `"(no title)"`. |
| `utc-midnight` | Event at exactly `00:00:00Z` — no off-by-one in date extraction. |
| `multi-day-event` | Event spanning multiple days; trigger output carries both ISO strings. |
| `sync-token-expired` | Mock returns HTTP 410 → webhook catches, falls back to v2 single-channelId fire. |
| `empty-changes` | Webhook with no events (empty `items`) → 200 no-op, no triggers fired. |
| `pagination` | Mock forces page size 3 with 6 events → server walks 2 pages. |
| `duplicate-in-batch` | Same eventId twice in one batch → 2 trigger fires, last wins. |
| `event-already-deleted` | Pre-cancelled event arriving with no prior item → no-op delete, no crash. |

---

## 6. Life cycle of an event (walkthrough)

Following `e2e/invited-then-accept.js` — the most instructive scenario.

### Phase 1 — invited, no response

1. **Harness setup** (`setupE2e`):
   - Writes `.dev/invited-then-accept-storage.json` with a pre-seeded channel row whose `webhookUrl` points at `http://localhost:9999/mock-monday/relay/{channelId}`.
   - Spawns `tests/mock-google/server.js` on `:9999`.
   - Spawns `src/index.js` on `:8081` with `USE_LOCAL_STORAGE=true`, `GOOGLE_API_BASE_URL=http://localhost:9999`.
   - POSTs `/admin/configure` on the mock with signing secret, monday token, board id, column mapping.

2. **Seed event** on mock:
   ```
   POST http://localhost:9999/admin/seed-events
   Body: { events: [ { id: 'test-evt-...', attendees: [..., { self:true, responseStatus:'needsAction' }] ... } ] }
   ```

3. **Fire webhook** — simulates Google:
   ```
   POST http://localhost:8081/webhook/calendar
   Headers: X-Goog-Channel-Token, X-Goog-Channel-Id, X-Goog-Resource-State: exists
   ```

4. **App behavior** (webhook handler):
   - Looks up channel in local storage → finds it.
   - Calls mock Google: `GET /calendar/v3/calendars/primary/events?syncToken=...`
   - Mock returns the needsAction event.
   - App runs `shouldSync` → `false` (self.responseStatus !== 'accepted').
   - Event is not cancelled and not declined → **skip**. No trigger fired.

5. **Assertions**:
   - `assertNoRelay(mockBaseUrl)` — confirms no entries in the relay log.
   - `waitForItemByName` — no item on the real board.

### Phase 2 — accept

1. **Re-seed** with `acceptedInvite(...)` (same `eventId`).
2. **Fire webhook** again.
3. App: shouldSync now returns `true` → builds trigger output (channelId, eventId, eventStatus=confirmed, eventName, startDate, endDate, description) → POSTs to webhookUrl (mock relay).
4. **Mock relay**:
   - Reads `state.config.mapping` — knows to set `itemName = outputFields.eventName` and `item.date_mkqwkw4q = outputFields.startDate`.
   - Signs a proper outer JWT with `shortLivedToken = state.config.shortLivedToken` (= MONDAY_API_TOKEN).
   - POSTs to `http://localhost:8081/actions/sync-events`.
5. **Action handler**:
   - Verifies the JWT signature with `MONDAY_SIGNING_SECRET`.
   - Extracts inboundFieldValues — sees `eventId + eventStatus` → v3 path.
   - `resolveUserEmail` from stored channel data → `e2e-tester@example.com`.
   - `buildEventUrl` → `https://www.google.com/calendar/event?eid=<base64url>`.
   - `findItemByColumnValue(linkColumnId, eventUrl)` → not found.
   - `createItem` with `{ [linkColumnId]: {url, text: url}, [dateCol]: {date, time} }`.
   - monday returns `{id: ...}`.
6. **Assertions**:
   - `waitForRelayAfter(sinceCount)` — picks up the new relay entry.
   - `waitForItemByName` — item appears on the real board.

Every step is visible in logs (run with `VERBOSE=1`) and in the mock's `/admin/state` endpoint for live inspection.

---

## 7. How to write a new scenario

Copy `tests/scenarios/action/create-event.js` (Tier 1) or `tests/scenarios/e2e/accepted-create.js` (Tier 2) as a template.

### Tier 1 skeleton

```js
import { loadTestConfig } from '../../lib/config.js';
import { invokeAction, buildInbound, waitForItemByName, getColumn, parseColumnValue } from '../../lib/action-helper.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const cfg = loadTestConfig();
  const runCtx = startRun('action/my-scenario', 'action');
  const r = createRecorder(runCtx);

  const ts = Date.now();
  const eventId = `test-evt-my-${ts}`;
  const itemName = `test-my-${ts}`;
  r.record('eventId', eventId);

  const res = await invokeAction({
    cfg,
    inboundFieldValues: buildInbound({
      cfg, eventId, itemName,
      item: { [cfg.dateColumnId]: new Date(ts + 3600_000).toISOString() },
    }),
  });
  r.assertEq(res.status, 200, 'action 200');

  const items = await waitForItemByName({
    token: cfg.mondayApiToken, boardId: cfg.boardId, name: itemName,
  });
  r.assertEq(items.length, 1, 'item created');
  if (items[0]) r.record('itemId', items[0].id);

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
```

Save it under `tests/scenarios/action/my-scenario.js`. `run.js` auto-discovers it:

```bash
node tests/run.js action/my-scenario
```

### Tier 2 skeleton

```js
import { setupE2e, fireWebhook } from '../../lib/e2e-setup.js';
import { seedEvents, waitForRelay, waitForItemByName } from '../../lib/e2e-helper.js';
import { buildGoogleEvent } from '../../lib/event-builder.js';
import { startRun, createRecorder, finishRun } from '../../lib/results-log.js';

export async function run() {
  const runCtx = startRun('e2e/my-scenario', 'e2e');
  const r = createRecorder(runCtx);

  const ctx = await setupE2e({ scenarioName: 'my-scenario' });
  try {
    const ts = Date.now();
    const eventId = `test-evt-my-${ts}`;
    await seedEvents(ctx.mock.baseUrl, [buildGoogleEvent({ id: eventId, summary: `test-my-${ts}`, start: new Date(ts+3600_000).toISOString(), end: new Date(ts+2*3600_000).toISOString() })]);
    await fireWebhook({ app: ctx.app, channelId: ctx.channelId });
    const relay = await waitForRelay(ctx.mock.baseUrl, { eventId });
    r.assert(!!relay, 'relay fired');
    // your assertions here
  } finally {
    await ctx.cleanup();
  }

  const summary = await finishRun(runCtx);
  if (summary.failed > 0) { console.error(`\n✗ FAILED`); process.exitCode = 1; return; }
  console.log(`\n✓ PASSED  (${summary.passed}/${summary.total})`);
}
```

### Multi-phase scenarios

Use `snapshotRelayCount(mockBaseUrl)` before phase N+1 and `waitForRelayAfter(mockBaseUrl, { eventId, sinceCount })` afterwards. Otherwise you'll match the phase-N entry.

---

## 8. Mock Google internals

`tests/mock-google/server.js` — Express on `:9999`.

### Google Calendar API endpoints

| Method + path | What it does |
|---|---|
| `POST /calendar/v3/calendars/:cal/events/watch` | Returns a mock channel `{id, resourceId, expiration}`. |
| `POST /calendar/v3/channels/stop` | Returns 204. |
| `GET /calendar/v3/calendars/:cal/events` | Paginated. Supports `syncToken`, `pageToken`, `maxResults`. Returns `state.events`. If `state.force410Once` is set, first call returns HTTP 410. |
| `GET /oauth2/v2/userinfo` | Returns `{ email: state.userEmail }`. |

### Admin endpoints (test control)

| Endpoint | Purpose |
|---|---|
| `GET /admin/health` | Liveness ping. |
| `POST /admin/configure` | Sets `state.config`: `appBaseUrl`, `signingSecret`, `shortLivedToken` (= monday API token), `appId`, `accountId`, `userId`, `boardId`, `linkColumnId`, `mapping`. |
| `POST /admin/seed-events` | Replaces `state.events`. |
| `POST /admin/set-user-email` | Overrides the email returned by `/oauth2/v2/userinfo`. |
| `POST /admin/force-next-sync-token` | Forces a specific `nextSyncToken` on the next `events.list` response. |
| `POST /admin/force-410-next` | Next `events.list` returns HTTP 410. |
| `POST /admin/set-page-size` | Overrides pagination page size (for the `pagination` edge test). |
| `POST /admin/reset` | Resets everything. |
| `GET /admin/state` | Returns current state including recent request log and relay log. |

### Mock monday relay

`POST /mock-monday/relay/:channelId` — the crown jewel of the E2E harness.

When the app fires a trigger (to what it thinks is monday), the body arrives here:
```json
{ "trigger": { "outputFields": { "channelId": "...", "eventId": "...", "eventStatus": "confirmed", "eventName": "...", "startDate": "...", ... } } }
```

The relay:
1. Applies `state.config.mapping` to map trigger outputs → action inboundFieldValues (exactly like monday's recipe resolver does in production).
2. Signs a proper action JWT with `state.config.signingSecret`, wrapping `state.config.shortLivedToken` inside.
3. POSTs to `${state.config.appBaseUrl}/actions/sync-events`.
4. Records the entry (and forwarded status) in `state.relayLog` so tests can assert.

Every relay entry includes:
- `timestamp`, `channelId`
- `outputFields` (what the app fired)
- `inboundFieldValues` (what was mapped → forwarded to action)
- `status` (`forwarded` | `error` | `not-configured`)
- `forwardedStatus` (HTTP status from the action endpoint)

---

## 9. Troubleshooting

### "unknown channelId in webhook"
The channel row is missing from `.dev/*-storage.json`. Tier 2 scenarios seed this automatically in `setupE2e`. If running Tier 1, verify `TEST_CHANNEL_ID` refers to an existing subscription in monday code's live storage (re-subscribe if stale).

### "Unauthorized" from monday API
`MONDAY_API_TOKEN` in `.env` is wrong, expired, or missing. Regenerate at monday.com → profile → Admin → API.

### `invalid value` on date column
The server's `normalizeColumnValue` in `actions.js` is expected to convert ISO date-times to `{date, time}` in UTC. If this assertion fails, the server-side normalization has regressed. Check `src/routes/actions.js` for `normalizeColumnValue`.

### `ItemNameTooLongException`
monday rejects item names ≥ 256 chars. The `edge/long-title` scenario documents this. Production considerations: truncate to 255 chars before sending.

### Port in use (`EADDRINUSE`)
A previous test run left a subprocess alive. `lsof -ti:8081 -ti:9999 | xargs kill -9`. Or override with `TEST_LOCAL_PORT=8082 MOCK_PORT=9998 node tests/run.js ...`.

### Tier 2 items "don't appear on board" but were created
Monday's search indexing has a small lag. `findItemsByName` uses `items_page_by_column_values` on the `name` column (indexed immediately), not the slower `items_page` scan. If this still fails, check that `items_page_by_column_values` is returning the item — add a debug log in `tests/lib/monday-query.js`.

### Local app crashes on boot with `@mondaycom/apps-sdk` error
The SDK tries to talk to monday's Vault server. For local runs you must set `USE_LOCAL_STORAGE=true` so `channel-storage.js` uses the file-backed shim instead. The harness sets this automatically; if running the app manually, prepend the env var.

---

## 10. Manual cleanup

Each scenario creates an item named `test-<scenario>-<timestamp>` and **leaves it on the board** so you can inspect it. After a testing session, bulk-delete:

```bash
node -e "import('./tests/lib/cleanup.js').then(m=>m.deleteItemsByPrefix().then(r=>console.log('Deleted:', r.deletedCount)))"
```

To narrow:

```bash
# Only batch-* items
node -e "import('./tests/lib/cleanup.js').then(m=>m.deleteItemsByPrefix({prefix:'test-batch'}).then(console.log))"
```

The helper uses `MONDAY_API_TOKEN` + `TEST_BOARD_ID` from `.env` by default.

`tests/results.log` and `tests/results.jsonl` are append-only — truncate them yourself if they grow too large (they're git-ignored).

---

## 11. Change log

_Append new entries at the top when the test suite changes significantly._

- **2026-04-15** — Product change: **all-day events are no longer synced**. `shouldSync` rejects events without `start.dateTime`. Added `duration` (minutes, stringified) to the trigger payload so the user can map elapsed time to a numbers column. Test `edge/all-day-event` was inverted to assert no-sync; new `duration-field` scenario verifies the trigger output. Requires DevCenter updates: add `duration` as a trigger output field AND as an action input field (both String, key=`duration`).
- **2026-04-15** — Initial test suite: Tier 1 (9 scenarios), Tier 2 (13 scenarios), Tier 2 edge cases (12 scenarios). Two production bugs surfaced and fixed along the way:
  - **rename-on-update** (`src/services/monday-api.js` — `changeItemName`): item names used to not update when the event's summary changed.
  - **R8 / RSVP decline** (`src/routes/webhook.js`): accepted → declined transitions now fire a cancellation so the action deletes the existing item.

---

## 12. Where to read the run history

Every scenario appends to two files:

- **`tests/results.log`** — human-readable. Each run is a ~10-line block:
  ```
  === 2026-04-15 10:42:10 — action/create-event (action) ===
  Status: PASS   Duration: 4.0s
  Assertions: 8/8 passed
  Observations:
    eventId: test-evt-create-...
    itemId: 2840833123
    linkUrl: https://www.google.com/calendar/event?eid=...
  ---
  ```

- **`tests/results.jsonl`** — one JSON object per run, machine-readable. Every assertion `{name, passed, details}` and every `record()` observation is captured.

To watch live results:
```bash
tail -f tests/results.log
```

To grep all failures:
```bash
grep "Status: FAIL" -A1 tests/results.log | less
```

To extract a historical metric from the JSONL file:
```bash
jq -r 'select(.scenario=="action/create-event") | "\(.timestamp) \(.durationMs)ms \(.status)"' tests/results.jsonl
```

Both files are append-only — never truncated by the runner. Rotate or archive manually when they get unwieldy.
