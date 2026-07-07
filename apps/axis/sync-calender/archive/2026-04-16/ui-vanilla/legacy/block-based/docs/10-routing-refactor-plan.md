# Plan: Routing Refactor — Cache-by-triggerUuid + Subscription State

## Context

### Why

Two real problems were observed in production on 2026-04-15:

1. **Silent data loss when user leaves routing inputs unmapped.** When `eventStatus` was not wired in the workflow builder, `inboundFieldValues` arrived without the key at all (confirmed against the logs in `docs/logs/sync-logs-3-rsvp-test.log` and `docs/raw-payloads-full.json`). The v3 condition `if (eventId && eventStatus)` fell to v2 fallback, which re-fetched Google with an already-consumed `syncToken` and silently processed zero events. End result: the calendar event was never synced to the board and no error was surfaced.

2. **Every recipe edit loses the `syncToken`.** Each time the user edits a saved automation, monday fires `POST /triggers/unsubscribe` (`unsubscribeReason: "resubscribing"`) followed by `POST /triggers/subscribe` with a new `subscriptionId`. Our current code tears down the old channel (including its `syncToken`) on unsubscribe, then the new subscribe does a fresh `events.list()` to rebuild it. Events that occurred between the unsubscribe and subscribe calls are lost; the initial sync only sees events from the new watch start.

Research in `docs/09-routing-fields-ux-research.md` confirmed monday has no hidden/auto-mapped field mechanism — the only clean solution is to stop exposing routing data in the recipe UI and move it server-side.

### Intended outcome

- Users see only domain fields in the recipe builder (Event Name, Start Date, etc.) — nothing to map for routing. No silent failure mode.
- `syncToken` survives automation edits via `previousSubscriptionId` migration.
- v2 legacy fallback and `sync-engine.js` are deleted — single-path architecture.
- No backwards compatibility required (existing automations will be re-created after deploy).

## New architecture — one-line summary

**Webhook fires a trigger per event with DOMAIN DATA only; server caches routing state (`subscriptionId`, `eventId`, `eventStatus`, `eventLink`) keyed by `triggerUuid` (captured from monday's fire-response); action reads its `runtimeMetadata.triggerUuid`, looks up the cache, and executes.**

Evidence that `triggerUuid` is the right key: verified against logs — 9 fire-response UUIDs matched 9 action-invocation UUIDs exactly (see `docs/raw-payloads-full.json`).

## Storage schema changes

### Before (current)

| Key | Value |
|---|---|
| `channel_<channelId>` | `{ webhookUrl, syncToken, userId, userEmail, resourceId, expiration, accessToken, accessTokenUpdatedAt }` |
| `user_channels_<userId>` | `[channelId, ...]` |
| `all_active_channels` | `[{ channelId, webhookUrl, userId, expiration }, ...]` |

`channelId` is our-generated UUID (current code: `crypto.randomUUID()`).

### After

| Key | Value |
|---|---|
| `subscription_<subscriptionId>` | `{ webhookUrl, syncToken, userId, accountId, userEmail, resourceId, expiration, accessToken, accessTokenUpdatedAt, createdAt }` |
| `user_subscriptions_<userId>` | `[subscriptionId, ...]` |
| `all_active_subscriptions` | `[{ subscriptionId, webhookUrl, userId, expiration }, ...]` |
| `trigger_cache_<triggerUuid>` | `{ subscriptionId, eventId, eventStatus, eventLink, expiresAt }` — short-lived (2 min TTL) |

- **Primary key is `subscriptionId`** (monday-provided). This means Google watch channel ID (`x-goog-channel-token`) is also `subscriptionId` — no translation step.
- `triggerUuid` cache is ephemeral: written when webhook fires a trigger, read once when the matching action fires, deleted on read (or swept by TTL after 2 min).

No backwards-compatibility code. Old entries in `channel_*`, `user_channels_*`, `all_active_channels` remain inert and will orphan-expire naturally; they can be manually purged via `storage:export` + `storage:set` if desired.

## Flow changes

### Webhook — `POST /webhook/calendar`

```
Google → /webhook/calendar (headers only, no body)
  ↓
subscription_<x-goog-channel-token> from storage
  ↓ (not found → WARN, 200)
events.list({ accessToken, syncToken })
  ↓ (fetch fails → ERROR log, NO fallback fire, 200, keep old syncToken)
for each event passing shouldSync filter (or status=cancelled):
  ↓
  fireTrigger(webhookUrl, { eventName, startDate, endDate, description })   // DOMAIN ONLY
  ↓
  receive { success, triggerUuid } from monday
  ↓
  trigger_cache_<triggerUuid> = { subscriptionId, eventId, eventStatus, eventLink, expiresAt: now + 120_000 }
  ↓
  sleep 100ms
persist newSyncToken
200
```

**No more v2 fallback fires**. If Google fetch fails, the webhook just logs and returns 200; the next successful sync will include the missed events (syncToken untouched).

### Action — `POST /actions/sync-events`

```
monday → /actions/sync-events  with inboundFieldValues + runtimeMetadata.triggerUuid
  ↓
extract triggerUuid from runtimeMetadata
  ↓
trigger_cache_<triggerUuid> from storage
  ↓ (missing → ERROR log, 500 response so monday retries)
delete cache entry (consume-once)
  ↓
subscription_<subscriptionId> from storage
  ↓
refresh accessToken from credentialsValues
  ↓
v3 decision matrix on { eventStatus, eventLink }:
  - cancelled + item exists → deleteItem
  - cancelled + !exists → skip
  - confirmed + exists → updateItem + changeItemName
  - confirmed + !exists → createItem
(columnValues built from inboundFieldValues.item + linkColumnId + optional peopleColumnId → personsAndTeams)
  ↓
maybeRenewWatchChannel
  ↓
200 { ok: true }
```

### Subscribe — `POST /triggers/subscribe`

```
monday → /triggers/subscribe with { subscriptionId, previousSubscriptionId, webhookUrl, credentialsValues }
  ↓
if previousSubscriptionId:
  old = subscription_<previousSubscriptionId>
  if old:
    migratedSyncToken = old.syncToken
    stop old Google watch (channels.stop with fresh accessToken; log-only on error)
    delete subscription_<previousSubscriptionId>
    remove from user_subscriptions_<userId>, all_active_subscriptions
  else:
    migratedSyncToken = null
else:
  migratedSyncToken = null
  ↓
watchCalendar(accessToken, { channelId: subscriptionId, baseUrl })
  → { resourceId, expiration }
  ↓
if migratedSyncToken:
  syncToken = migratedSyncToken    // events added since old channel stop will be picked up on next notification
else:
  syncToken = getInitialSyncToken(accessToken)  // first-time subscribe
  ↓
userEmail = fetchUserEmail(accessToken)
  ↓
subscription_<subscriptionId> = { webhookUrl, syncToken, userId, accountId, userEmail, resourceId, expiration, accessToken, accessTokenUpdatedAt: Date.now(), createdAt: Date.now() }
add to user_subscriptions_<userId>, all_active_subscriptions
  ↓
200 { webhookId: subscriptionId }
```

### Unsubscribe — `POST /triggers/unsubscribe`

```
monday → /triggers/unsubscribe with { webhookId: subscriptionId, unsubscribeReason, credentialsValues }
  ↓
if unsubscribeReason === 'resubscribing':
  // Do NOTHING. The imminent subscribe with previousSubscriptionId will migrate and clean up.
  log info, return 200
  ↓
else:  // real removal
  sub = subscription_<subscriptionId>
  if sub:
    channels.stop(accessToken, subscriptionId, sub.resourceId)   // log-only on error
    delete subscription_<subscriptionId>
    remove from user_subscriptions_<userId>, all_active_subscriptions
  return 200
```

### Scheduler — `POST /scheduler/renew-channel`

Current design fires triggers to round-trip through monday → action. In the new architecture there's no "empty-payload" path in the action, so the scheduler must renew server-side directly.

```
monday scheduler cron → /scheduler/renew-channel (no body, no auth)
  ↓
index = all_active_subscriptions
expiring = index.filter(e => e.expiration - now < 24h)
for each:
  sub = subscription_<subscriptionId>
  if !sub: skip (stale index entry)
  channels.stop(sub.accessToken, subscriptionId, sub.resourceId)   // log-only on error
  { resourceId, expiration } = watchCalendar(sub.accessToken, { channelId: subscriptionId, baseUrl })
  subscription_<subscriptionId>.{ resourceId, expiration } updated
  update all_active_subscriptions entry
200
```

**Caveat:** scheduler runs once a day (`0 8 * * *` UTC). If a subscription's `accessToken` has gone stale (no action in the last hour), renewal will fail with 401. Not a regression vs current behavior; same risk exists today. Mitigation (future, out of scope): refresh the token via monday's Credentials API before attempting channels.stop/watch.

## Phased implementation

Work on branch `refactor/routing-via-trigger-uuid` (already checked out, baseline commit `b10572a`).

### Phase 1 — Storage layer

**File:** rename `src/storage/channel-storage.js` → `src/storage/subscription-storage.js`

- Rename exported singleton `channelStorage` → `subscriptionStorage`
- Rename methods: `getChannel → getSubscription`, `setChannel → setSubscription`, `updateChannel → updateSubscription`, `deleteChannel → deleteSubscription`, `addUserChannel → addUserSubscription`, `removeUserChannel → removeUserSubscription`, `getChannelIndex → getSubscriptionIndex`, `addToChannelIndex → addToSubscriptionIndex`, `removeFromChannelIndex → removeFromSubscriptionIndex`
- Change key prefixes: `channel_` → `subscription_`, `user_channels_` → `user_subscriptions_`, `all_active_channels` → `all_active_subscriptions`
- **Add new methods** for trigger cache:
  - `getTriggerCache(triggerUuid)` — read `trigger_cache_<triggerUuid>`; auto-delete if `expiresAt < now`
  - `setTriggerCache(triggerUuid, { subscriptionId, eventId, eventStatus, eventLink }, ttlMs = 120_000)` — writes with `expiresAt = Date.now() + ttlMs`
  - `deleteTriggerCache(triggerUuid)` — explicit consume-once delete

Keep the existing in-memory cache + retry wrappers; they apply equally to subscription and trigger-cache keys.

### Phase 2 — Google helpers + RSVP filter relocation

**File:** `src/services/google-calendar.js`

- Add exported `shouldSync(event)` here — moved from `sync-engine.js`. Preserve existing rules: skip cancelled (caller handles separately), skip all-day events (no `start.dateTime`), skip events without the user's `accepted` RSVP.
- No changes to `watchCalendar`, `listChanges`, `getInitialSyncToken`, `fetchUserEmail`, `buildEventUrl`, `stopChannel`, `compactEvent`.
- Remove the `accessTokenUpdatedAt` etc. — unchanged.

### Phase 3 — `monday-triggers.js` returns `triggerUuid`

**File:** `src/services/monday-triggers.js`

- `fireTrigger(webhookUrl, outputFields)` currently returns void. Change it to parse the 200-response JSON and return `triggerUuid` (or `null` on failure).
- Response shape confirmed from logs: `{"success":true,"triggerUuid":"<hex>"}`. Parse with `JSON.parse(responseText)` inside the existing `if (response.ok)` branch.
- On non-200: return null (already logs error).

### Phase 4 — Webhook rewrite

**File:** `src/routes/webhook.js` (rewrite end-to-end)

- Replace `channelStorage` import with `subscriptionStorage`.
- Replace all `channelId` variable names with `subscriptionId` for clarity; the underlying identifier is the monday subscription ID.
- Drop the "v2 fallback fire" block entirely. If `listChanges` errors, log ERROR and return 200 without firing anything.
- Build new `buildTriggerPayload(event)` → returns domain-only fields: `{ eventName, startDate, endDate, description }`. No `channelId`, `eventId`, `eventStatus`, `eventLink`.
- After each `fireTrigger`, capture the returned `triggerUuid` and call `subscriptionStorage.setTriggerCache(triggerUuid, { subscriptionId, eventId: event.id, eventStatus: event.status, eventLink: event.htmlLink })`. If `triggerUuid` is null (fire failed), log WARN and skip cache write for that event.
- Import `shouldSync` from `google-calendar.js` (new location).
- Handle self-declined-as-cancelled the same way: if user's RSVP changed accepted→declined, set eventStatus to `'cancelled'` in the cache write, not the outputFields (outputFields don't carry status any more).
- Persist new `syncToken` via `subscriptionStorage.updateSubscription(subscriptionId, { syncToken: newSyncToken })`.

### Phase 5 — Actions rewrite

**File:** `src/routes/actions.js` (rewrite end-to-end)

- Drop entire v2 fallback block (`sync-engine.processEvents`, `columnMapping`, `calendarEvent` field).
- New flow:
  1. Extract `triggerUuid` from `req.body.payload.runtimeMetadata?.triggerUuid`.
  2. If missing → 400.
  3. `cache = await subscriptionStorage.getTriggerCache(triggerUuid)`. If missing → 500 (let monday retry).
  4. `subscriptionStorage.deleteTriggerCache(triggerUuid)` (consume-once).
  5. Destructure `{ subscriptionId, eventId, eventStatus, eventLink }` from cache.
  6. Read `inboundFieldValues` for USER-CONFIGURED fields only: `boardId`, `linkColumnId`, `peopleColumnId`, `itemName`, `item`. NO `channelId` / `eventId` / `eventStatus` / `eventLink`.
  7. Load `subscription_<subscriptionId>`, refresh stored `accessToken` from `credentialsValues`.
  8. Call existing `handleV3SingleEvent` with the resolved values (keep its body as-is — it already does the decision matrix).
  9. `maybeRenewWatchChannel` → update to use `subscriptionStorage`.
- Keep the `peopleColumnId` + `assignedUserId = subscription.userId` handling (already added in `b10572a` commit).
- Remove `resolveUserEmail` helper — `userEmail` is always stored by subscribe; the action doesn't need to fetch it (only the webhook used it for url reconstruction, and the action now gets `eventLink` from cache, not reconstruction).
- Remove the `buildEventUrl` call from actions.js (no longer reconstructing).

### Phase 6 — Triggers rewrite

**File:** `src/routes/triggers.js`

- `subscribe` handler:
  - Extract `subscriptionId`, `previousSubscriptionId` from `req.body.payload` (both confirmed present in `docs/raw-payloads-full.json`).
  - If `previousSubscriptionId`: load `subscription_<previousSubscriptionId>`, capture `migratedSyncToken = old.syncToken`, stop old Google watch (using `previousSubscriptionId` as channelId), delete old subscription storage.
  - Register new Google watch with `channelId: subscriptionId` (not `crypto.randomUUID()` any more).
  - Use `migratedSyncToken` if available, otherwise `getInitialSyncToken`.
  - Write `subscription_<subscriptionId>` with all state.
  - Return `{ webhookId: subscriptionId }`.
- `unsubscribe` handler:
  - If `unsubscribeReason === 'resubscribing'` → log info, return 200. Do nothing.
  - Otherwise: stop Google channel using `subscriptionId` as channel id, delete storage, return 200.

### Phase 7 — Scheduler rewrite

**File:** `src/routes/scheduler.js`

- Stop firing triggers. Instead, loop over `all_active_subscriptions`, filter expiring, and for each: `channels.stop` + `watchCalendar` directly.
- Update the subscription's `{ resourceId, expiration }` in storage + refresh `all_active_subscriptions` entry.
- Keep both URL paths (`/scheduler/renew-channel` and `/mndy-cronjob/renew-channel`).

### Phase 8 — Delete legacy code

- **Delete file** `src/services/sync-engine.js` entirely (after moving `shouldSync` to `google-calendar.js` in Phase 2).
- **Delete file** `src/routes/field-definitions.js` entirely and remove its `app.use` registration in `src/index.js` (the `/field-definitions/calendar-event` route only served the legacy `calendarEvent` Custom Field).
- In `src/services/monday-api.js`: delete unused exports — `buildColumnValues`, `toDate`, `toTime` (all only used by the deleted sync-engine).

### Phase 9 — CLAUDE.md rewrite

- Update the "Architecture v3" summary paragraph to reflect the cache-by-triggerUuid pattern and removal of v2 fallback. Bump to v4 or keep v3 label — **keep "v3" but mark it "revised 2026-04-15"** (cheaper for docs that reference v3).
- Rewrite Storage Schema table with the new keys.
- Rewrite each endpoint contract under "Endpoint Contracts" to match new shapes.
- Rewrite the Workflow Builder UX block: no `eventId`/`eventStatus`/`channelId`/`eventLink` in the recipe; only `boardId`, `linkColumnId`, `peopleColumnId`, `itemName`, `item` are visible to the user.
- Remove references to v2 fallback, `calendarEvent` Custom Field, `sync-engine.js`, `/field-definitions/calendar-event`.
- Document the migration note: existing users must delete their old automation block once and re-add it (because the action's input schema changes).

### Phase 10 — Developer Center changes

Not code, but required for the app to work. Document in the plan; user performs manually:

- **Action block "Sync Calendar Events" → Input fields:** REMOVE `channelId`, `eventId`, `eventStatus`, `eventLink`, `calendarEvent`. KEEP `boardId`, `linkColumnId`, `peopleColumnId`, `itemName`, `item`.
- **Trigger block "Google Calendar Trigger" → Output fields:** REMOVE `channelId`, `eventId`, `eventStatus`, `eventLink`. KEEP `eventName`, `startDate`, `endDate`, `description`, `duration` (if the user added it custom-post-v3). The recipe UI now shows only user-mappable domain data.

### Phase 11 — Deploy + verify

- `mapps code:push -a 11119011 --force` → deploys to next draft V8.
- `mapps app:promote -a 11119011 -i <V8 id>` → promotes to live.
- Verification — run a trimmed version of `docs/e2e-test-plan.md`:
  1. Clean state (delete old automation on test board).
  2. Create new automation — ONLY map `boardId`, `linkColumnId`, `peopleColumnId`, and business columns; **the routing fields should not exist in the UI any more.**
  3. Create Google event → verify item created with people column assigned, link populated, columns mapped.
  4. Update event → same item updated.
  5. **Recipe edit test:** save a mapping change. Immediately create a Google event. Verify it syncs AND verify the pre-edit item still updates via new subscription. Use logs to confirm `unsubscribe(resubscribing)` was a no-op and `subscribe` migrated the syncToken (look for new log line "migrated syncToken from previous subscription").
  6. Delete event → item deleted.
  7. Remove automation → `unsubscribe` (without resubscribing reason) cleans up storage AND stops Google channel.

**Logs to watch (via `mapps code:logs -i <V8 id> -s live -t console`):**
- `fire trigger request` — outputFields should contain ONLY domain data.
- `trigger cache written | triggerUuid=... | subscriptionId=...`
- `action invoked` — no channelId / eventId / eventStatus in inboundFieldValues.
- `trigger cache read | triggerUuid=...` and immediately `trigger cache consumed | triggerUuid=...`
- `subscribe: migrating syncToken from previousSubscriptionId=...` on recipe edits.

### Phase 12 — Save this plan to docs/

After approval + implementation complete, copy the final plan to `docs/10-routing-refactor-plan.md` for long-term reference (this file at `/Users/ilaish/.claude/plans/...` is a working scratchpad).

## Critical files (summary)

| File | Change |
|---|---|
| `src/storage/channel-storage.js` → `src/storage/subscription-storage.js` | Rename + new keys + trigger-cache methods |
| `src/services/google-calendar.js` | Add `shouldSync` |
| `src/services/monday-triggers.js` | Return `triggerUuid` |
| `src/routes/webhook.js` | Rewrite — domain-only outputFields + cache write; no fallback |
| `src/routes/actions.js` | Rewrite — read from cache; drop v2 fallback |
| `src/routes/triggers.js` | Rewrite — subscriptionId as key; migrate on `previousSubscriptionId`; no-op unsubscribe when resubscribing |
| `src/routes/scheduler.js` | Rewrite — direct renewal, no trigger fire |
| `src/routes/field-definitions.js` | **Delete file** + unwire from `src/index.js` |
| `src/services/sync-engine.js` | **Delete file** |
| `src/services/monday-api.js` | Remove `buildColumnValues`, `toDate`, `toTime` |
| `CLAUDE.md` | Update architecture, schema, endpoint contracts, UX flow |

Files untouched: `src/index.js` (raw body middleware stays), `src/routes/auth.js`, `src/middlewares/authentication.js`, `src/helpers/environment.js`, `src/services/logger.js`, `tests/`.

## Out of scope (explicitly)

- **Orphan Google watch channel cleanup** (8+ currently pushing). They will expire in <= 7 days.
- **Automatic migration of existing automations.** Users must delete + re-create the automation block once after deploy, because the action's input schema changes. Document in CLAUDE.md migration note.
- **Token refresh fallback in scheduler** when stored accessToken has expired. Same failure mode as today; not a regression.
- **Backfilling missed events when recipe edit happens during webhook burst.** Google events between unsubscribe and subscribe are still picked up on the next webhook because we keep `syncToken` via `previousSubscriptionId` migration. But if a channel was renewed between steps, the syncToken applies to a different watch lineage — acceptable edge case.
- **Rate-limit hardening** on trigger-cache writes. SecureStorage allows 1 write/s per key; since each event gets a distinct `triggerUuid`, concurrent writes are all to different keys — well within the 7 req/s global limit.

## Verification checklist

- [ ] Unit-run: `node --check` on every modified JS file.
- [ ] Recipe UI shows NO routing fields in the action block.
- [ ] Creating an event → item synced end-to-end with people assignment.
- [ ] Editing the recipe → new events sync AND old events update via new subscription.
- [ ] Google fetch failure path (simulate by setting stored accessToken to garbage) → webhook logs error, returns 200, fires nothing; next fresh event picks up backlog.
- [ ] `trigger_cache_*` entries visible in `mapps storage:export` during a burst, disappear within 2 min.
- [ ] No `sync-engine.js` references remain (grep verifies).
- [ ] No `channel_*` keys written or read after deploy.
- [ ] Confirm via a second log capture session that `inboundFieldValues` in `/actions/sync-events` contains **no** `eventId` / `eventStatus` / `channelId` / `eventLink`.
