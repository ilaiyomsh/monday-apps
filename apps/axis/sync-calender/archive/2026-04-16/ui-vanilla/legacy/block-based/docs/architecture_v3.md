# Architecture v3 — Google Calendar → monday.com Sync

## Project Goal

One-way sync from **Google Calendar → monday.com board**, hosted on **monday code** (serverless Node.js).

Events are synced only when the authenticated user has **accepted** the invitation (RSVP filter). The app supports full CRUD: create new items, update existing items, delete items when events are cancelled or declined.

---

## Design Principles

1. **100% NEW infrastructure** — uses only monday workflows infrastructure (Automation Block + Field for Automation Block), exposed exclusively in the **Workflow Builder**. Zero legacy components.
2. **Thin relay webhook** — webhook handler does no business logic; just forwards `channelId` to monday via webhookUrl
3. **Fresh tokens always** — Action receives fresh Google + monday tokens on every invocation (no stored token expiration issues)
4. **Flat primitive outputs** — Trigger emits each event field as an individual primitive variable (not nested in an Object)
5. **Column pickers** — Action has one Primitive field per column type (link, name, date, text, etc.) with Remote Options URL filtered to that type
6. **Event identity via Link column** — event-to-item mapping lives in a Link column on the board (not in SecureStorage); scales infinitely
7. **Self-healing renewal** — Action checks watch channel expiration on every invocation and renews if needed
8. **No `action` flag needed** — both webhook and scheduler fire the trigger with `{ channelId }` only

---

## What This Architecture Does NOT Use (Legacy / Deprecated)

All of the following are scheduled for deprecation by **April 30, 2026** and are NOT used in this app:

| Legacy Component | Why Not |
|------------------|---------|
| ❌ "Integration" app feature | Replaced by Automation Block |
| ❌ "Field Types" tab in Integration feature | Replaced by Field for Automation Block |
| ❌ Dynamic Mapping field type | Returns array format; replaced by per-column Primitive pickers |
| ❌ List field type (legacy) | Replaced by Primitive with Remote Options URL |
| ❌ `itemMapping` field | Built-in monday "Create item" mapping not supported in custom actions |
| ❌ Sentence Builder UI | Replaced by Workflow Builder canvas |
| ❌ Automation Builder (classic Automation Center) | Set `Automation builder: Off`, `Workflow builder: On` for all blocks |
| ❌ Object + Dynamic Schema as trigger output | Doesn't expose subfields as individual variables; use flat primitives instead |

---

## monday.com App Features

| Feature | Type | Slug | Purpose |
|---------|------|------|---------|
| Google Calendar | Credentials | `google-calendar-credentials` | Google OAuth 2.0 managed by monday |
| Google Calendar Trigger | **Automation Block (Trigger)** | `calendarevents` | Fires on calendar changes; outputs flat event variables |
| Sync Calendar Events | **Automation Block (Action)** | `sync-calendar-events` | Full CRUD with column pickers + self-healing renewal |

**Note:** No Custom Field for Automation Block is needed in v3 — the trigger emits individual primitive output fields directly.

---

## Block Configuration

### Trigger: Google Calendar Trigger

**Builder visibility:**
- Workflow builder: **On**
- Automation builder: **Off**

**Credentials:**
- Google Calendar account (`google_credentials`)

**Input fields:**

| Field | Type | Key | Title | Source | Notes |
|-------|------|-----|-------|--------|-------|
| Board | Primitive (number) | `boardId` | Board | Recipe sentence | User picks board at recipe setup |

**Output fields (flat primitives — appear as individual variables in downstream actions):**

| Field | Type | Key | Title |
|-------|------|-----|-------|
| String | `channelId` | Channel ID | Internal routing |
| Number | `boardId` | Board | Echoed for action input |
| String | `eventName` | Event Name | |
| String | `startDate` | Start Date | ISO 8601 |
| String | `endDate` | End Date | ISO 8601 |
| String | `description` | Description | |
| String | `location` | Location | |
| String | `organizer` | Organizer | |
| String | `eventLink` | Event Link | Google Calendar URL |

**Note on date types:** Use `string` (ISO 8601) instead of `date` primitive — two `date` fields on the same trigger may cause UI issues per docs.

**API Configuration:**
- Subscribe URL: `/triggers/subscribe`
- Unsubscribe URL: `/triggers/unsubscribe`

---

### Action: Sync Calendar Events

**Builder visibility:**
- Workflow builder: **On**
- Automation builder: **Off**

**Credentials:**
- Google Calendar account (`google_credentials`) — receives **fresh** accessToken on every invocation

**Input fields:**

| Field | Type | Key | Title | Source | Dependency | Remote Options |
|-------|------|-----|-------|--------|-----------|----------------|
| String | `channelId` | Channel ID | Trigger Output | — | — |
| Number | `boardId` | Board | Trigger Output | — | — |
| String | `eventName` | Event Name | Trigger Output | — | — |
| String | `startDate` | Start Date | Trigger Output | — | — |
| String | `endDate` | End Date | Trigger Output | — | — |
| String | `description` | Description | Trigger Output | — | — |
| String | `location` | Location | Trigger Output | — | — |
| String | `organizer` | Organizer | Trigger Output | — | — |
| String | `eventLink` | Event Link | Trigger Output | — | — |
| String | `linkColumnId` | Link Column | Recipe Sentence | `boardId` | `/options/columns?type=link` |
| String | `nameColumnId` | Name Column (optional) | Recipe Sentence | `boardId` | `/options/columns?type=name` |
| String | `startDateColumnId` | Start Date Column | Recipe Sentence | `boardId` | `/options/columns?type=date` |
| String | `endDateColumnId` | End Date Column | Recipe Sentence | `boardId` | `/options/columns?type=date` |
| String | `descriptionColumnId` | Description Column | Recipe Sentence | `boardId` | `/options/columns?type=text` |
| String | `locationColumnId` | Location Column | Recipe Sentence | `boardId` | `/options/columns?type=text` |
| String | `organizerColumnId` | Organizer Column | Recipe Sentence | `boardId` | `/options/columns?type=text` |

**Output fields:** None

**API Configuration:**
- Execution URL: `/actions/sync-events`

---

### Workflow Builder UX

```
Step 1: Google Calendar Trigger
  → Connect Google account
  → Pick Board

Step 2: Sync Calendar Events
  → Link Column        [dropdown: Link columns from board]
  → Name Column        [dropdown: Name/Text columns]
  → Start Date Column  [dropdown: Date columns]
  → End Date Column    [dropdown: Date columns]
  → Description Column [dropdown: Text columns]
  → Location Column    [dropdown: Text columns]
  → Organizer Column   [dropdown: Text/People columns]
  
  (Trigger output values flow automatically — channelId, boardId, eventName, startDate, etc.)
```

---

## High-Level Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ SETUP (subscribe — when user activates workflow)                 │
│                                                                  │
│  monday calls POST /triggers/subscribe with:                     │
│    • credentialsValues.google_credentials.accessToken             │
│    • inputFields.boardId                                          │
│    • webhookUrl                                                  │
│                                                                  │
│  Server:                                                         │
│    1. Generate channelId (UUID)                                  │
│    2. Register Google Calendar Watch Channel                     │
│    3. Fetch initial syncToken via events.list()                  │
│    4. Store in SecureStorage:                                    │
│       channel_<channelId> = {                                    │
│         webhookUrl, syncToken, boardId, userId,                  │
│         resourceId, expiration                                   │
│       }                                                          │
│    5. Return { webhookId: channelId }                            │
│                                                                  │
│  Note: Column mapping NOT stored — Action receives column IDs    │
│  fresh from inboundFieldValues on every invocation.              │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ RUNTIME (per calendar change — two-phase relay)                  │
│                                                                  │
│  Phase 1: Webhook handler (thin relay, NO tokens needed)         │
│                                                                  │
│    Google POSTs to /webhook/calendar                             │
│      → Verify X-Goog-Channel-Token → channelId                  │
│      → SecureStorage.get(channelId) → { webhookUrl, ...,         │
│                                          accessToken (stored?) } │
│      → Fetch events from Google with stored accessToken          │
│         (needed because trigger outputs require event data)      │
│      → For each event passing RSVP filter:                       │
│          POST to webhookUrl with all event fields:               │
│          {                                                       │
│            trigger: {                                            │
│              outputFields: {                                     │
│                channelId, boardId,                               │
│                eventName, startDate, endDate,                    │
│                description, location, organizer, eventLink       │
│              }                                                   │
│            }                                                     │
│          }                                                       │
│      → Update syncToken in SecureStorage                         │
│      → Return 200 to Google                                      │
│                                                                  │
│  Phase 2: Action handler (FRESH tokens, performs CRUD)           │
│                                                                  │
│    monday calls POST /actions/sync-events with:                  │
│      • Fresh credentialsValues.google_credentials.accessToken    │
│      • Fresh shortLivedToken (monday API)                        │
│      • inboundFieldValues:                                       │
│          channelId, boardId,                                     │
│          eventName, startDate, endDate, description, ...,        │
│          linkColumnId, nameColumnId, startDateColumnId, ...,     │
│                                                                  │
│    Action:                                                       │
│      1. Search board: query items where linkColumnId             │
│         contains eventLink (= event identity)                    │
│      2. Apply decision matrix:                                   │
│         - exists + has data        → update item                 │
│         - not exists + has eventLink → create item               │
│         - exists + no eventLink (cancelled) → delete item        │
│      3. Self-healing: check expiration of channel; renew if      │
│         < 24h remain (uses fresh accessToken)                    │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ SCHEDULED (daily cron — channel renewal trigger)                 │
│                                                                  │
│  POST /scheduler/renew-channel (called by monday scheduler)      │
│    → Read all_active_channels from SecureStorage                 │
│    → For channels expiring < 24h:                                │
│        Fetch dummy event (or use stored token) and fire trigger  │
│        for at least one event so action runs and renews channel  │
│                                                                  │
│  Note: Self-healing makes scheduler partly redundant — any       │
│  webhook-driven action call also renews if needed.               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Critical Design Decision: Token in Webhook Handler

**Problem:** The webhook handler must fetch event data from Google to populate the trigger's flat output fields, but it has no fresh Google token (Google doesn't authenticate when calling our webhook).

**Solution:** Store the Google `accessToken` in SecureStorage during subscribe. Use it in the webhook handler.

**Limitation:** Google access tokens expire after ~1 hour. Mitigations:
- **Re-subscribe on workflow re-activation** refreshes the stored token
- **Self-healing renewal** (in action) keeps the watch channel alive even if webhook calls fail
- **Future:** if monday's Credentials feature provides `refresh_token`, store and use it for refresh

**Alternative (rejected):** Webhook fires trigger with only `channelId` → action fetches events with fresh token → but then action must also do the column mapping work, which conflicts with the "flat trigger outputs" model.

---

## Sync Decision Matrix

For each event change received from Google:

| Condition | shouldSync(event) | Item exists in board? | Action |
|-----------|------------------|----------------------|--------|
| New accepted event | `true` | No | **Create** item; set `linkColumnId` to `event.htmlLink` |
| Updated accepted event | `true` | Yes | **Update** item columns |
| Event cancelled | `false` (status=cancelled) | Yes | **Delete** item |
| RSVP changed accepted → declined | `false` | Yes | **Delete** item |
| Event declined from start | `false` | No | **Skip** |

### shouldSync (RSVP filter)

```javascript
function shouldSync(event) {
  if (event.status === 'cancelled') return false;
  if (!event.attendees?.length) return true;  // sole organizer → always sync
  const self = event.attendees.find(a => a.self === true);
  return self?.responseStatus === 'accepted';
}
```

### Implementation Note

The webhook handler applies `shouldSync` BEFORE firing the trigger. Only events that should sync (or already exist in the board for deletion) trigger the action.

For deletions (event no longer matches `shouldSync` but item exists), the webhook handler still fires the trigger — but with a special marker (e.g., empty `eventLink` plus the original `eventLink` in a separate field for lookup). The action handler interprets this as "delete the item with this URL".

**Simpler alternative:** Always fire the trigger for all changed events (let the action decide). Action queries board for existing item, then decides create/update/delete based on RSVP status.

---

## Event Identity: Link Column

Event identity lives in a Link column on the board (no SecureStorage entries per event):

- **URL:** `event.htmlLink` from Google Calendar API
- **Display text:** Event title or "Google Calendar"
- **Lookup query:**

```graphql
query FindItem($boardId: ID!, $columnId: String!, $value: CompareValue!) {
  items_page_by_column_values(
    board_id: $boardId,
    columns: [{ column_id: $columnId, column_values: [$value] }],
    limit: 1
  ) {
    items { id }
  }
}
```

**Advantages:**
- Scales to unlimited events without polluting SecureStorage
- Visible to user (clickable link to original Calendar event)
- Survives app redeployment (data lives in monday)

---

## Server Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `POST` | `/triggers/subscribe` | Register Google Watch Channel | monday JWT |
| `POST` | `/triggers/unsubscribe` | Stop Watch Channel, cleanup storage | monday JWT |
| `POST` | `/webhook/calendar` | Fetch events with stored token, fire trigger per event | X-Goog-Channel-Token |
| `POST` | `/actions/sync-events` | Search board, apply decision matrix, CRUD, self-heal | monday JWT (via webhookUrl) |
| `POST` | `/options/columns` | Return board columns filtered by type (for Remote Options URL) | monday JWT |
| `POST` | `/auth/google-identifier` | Return user email for Credentials display | monday JWT |
| `POST` | `/scheduler/renew-channel` | Daily cron: fire trigger for expiring channels | monday scheduler |

### `/options/columns` Endpoint

Receives `boardId` in `dependencyData` and `?type=link` query string. Returns matching columns:

**Request:**
```json
{
  "payload": {
    "dependencyData": { "boardId": 12345 }
  }
}
```

**Response:**
```json
[
  { "title": "Event Link", "value": "link_mkt7n4ek" },
  { "title": "Source URL", "value": "link_mkn1q2xy" }
]
```

The `?type=` query param filters the column list (`link`, `name`, `date`, `text`, `long_text`, `numbers`, `people`, `dropdown`, etc.).

---

## Token Flow

| Endpoint | Google Token | Monday Token | Source |
|----------|-------------|-------------|--------|
| `/triggers/subscribe` | `credentialsValues` (fresh) | `shortLivedToken` from JWT | monday-initiated |
| `/triggers/unsubscribe` | `credentialsValues` (fresh) | `shortLivedToken` from JWT | monday-initiated |
| `/webhook/calendar` | **Stored** in channel (1h validity) | None | Google-initiated |
| `/actions/sync-events` | `credentialsValues` (fresh!) | `shortLivedToken` (fresh!) | monday-initiated via webhookUrl |
| `/options/columns` | None | `shortLivedToken` from JWT | monday-initiated (UI) |
| `/auth/google-identifier` | From request body (Credentials feature) | None | monday-initiated |
| `/scheduler/renew-channel` | **Stored** if needed | None | monday scheduler |

---

## Storage Schema (SecureStorage)

| Key | Value | Purpose |
|-----|-------|---------|
| `channel_<channelId>` | `{ webhookUrl, syncToken, boardId, userId, accessToken, resourceId, expiration }` | Watch channel metadata + Google token for webhook handler |
| `user_channels_<userId>` | `["channelId1", ...]` | Active channels per user (cleanup index) |
| `all_active_channels` | `[{ channelId, webhookUrl, userId, expiration }, ...]` | Global index for cron renewal |

**What is NOT stored:**
- ❌ Column mapping — Action receives column IDs from `inboundFieldValues` on every call
- ❌ `event_<eventId>` mappings — Event identity lives on the board in Link column
- ❌ `boardId` and `linkColumnId` mapping — flow through trigger output / action input

**What IS stored:**
- ✅ Google `accessToken` (1h validity, refreshed on re-subscribe)
- ✅ `boardId` (used by webhook handler to construct trigger payload)
- ✅ `webhookUrl`, `syncToken`, channel metadata

---

## Module Structure

```
sync-calender/
├── src/
│   ├── index.js                    # Express server entry (port 8080)
│   ├── routes/
│   │   ├── webhook.js              # Fetch events with stored token + fire trigger per event
│   │   ├── triggers.js             # subscribe (store boardId + accessToken) + unsubscribe
│   │   ├── actions.js              # Search board, decision matrix, CRUD, self-heal renewal
│   │   ├── options.js              # /options/columns?type=X — Remote Options URL handler
│   │   ├── auth.js                 # Google identifier for Credentials feature
│   │   └── scheduler.js            # Cron: fire trigger for expiring channels
│   ├── services/
│   │   ├── google-calendar.js      # watch(), events.list(), channels.stop()
│   │   ├── monday-api.js           # GraphQL: getBoardColumns, findItemByColumnValue, create/update/delete item
│   │   ├── monday-triggers.js      # POST to webhookUrl (JWT signed, appId as Number)
│   │   ├── sync-engine.js          # RSVP filter (shouldSync) + event-to-trigger mapping
│   │   └── logger.js               # Structured JSON logging
│   ├── storage/
│   │   └── channel-storage.js      # SecureStorage wrapper
│   ├── middlewares/
│   │   └── authentication.js       # monday JWT verification
│   └── helpers/
│       └── environment.js          # getBaseUrl(), getPort()
├── package.json
└── .env
```

---

## Edge Cases & Scenarios

### Event created (sole organizer, no attendees)
Google webhook → handler fetches event → `shouldSync=true` → fire trigger with all event fields → action searches board (not found) → **Create item** with link column = `event.htmlLink`.

### Event updated (title, time, or description changed)
Google webhook → handler fetches event → `shouldSync=true` → fire trigger → action searches board (found via link column) → **Update item** with new column values.

### Event deleted in Google
Google webhook → handler fetches with `events.list()` → event has `status: "cancelled"` → fire trigger anyway (so action can delete) → action searches board (found) → **Delete item**.

### Event created and immediately declined
Google webhook → handler fetches event → `shouldSync=false` (RSVP declined) → don't fire trigger (item never existed) → **Skip**.

### User changes RSVP from declined to accepted
Google webhook → handler fetches event → `shouldSync=true` → fire trigger → action searches board (not found) → **Create item**.

### User changes RSVP from accepted to declined
Google webhook → handler fetches event → `shouldSync=false` → fire trigger anyway with deletion marker → action searches board (found) → **Delete item**.

### Watch channel near expiration (any action call)
Action checks `channelData.expiration`; if < 24h, calls `googleCalendar.stopChannel` then `watchCalendar` with same channelId → updates SecureStorage.

### No calendar activity for days, channel about to expire
Daily scheduler reads expiring channels → fires trigger with minimal data (just channelId) → action runs, fetches no new events but **self-healing renews** the watch channel.

### Stored Google token expired (after 1 hour with no activity)
Webhook handler tries to fetch events → 401 from Google → logs error, returns 200 to Google → wait for user to re-activate workflow (re-subscribe with fresh token).

---

## Migration from v2

| Aspect | v2 | v3 |
|--------|----|----|
| Trigger output | `channelId` only | `channelId` + `boardId` + 7 event fields (flat) |
| Trigger input | None | `boardId` (Board picker) |
| Action input | `boardId`, `linkColumnId`, `calendarEvent` (Object) | `boardId` + 7 event fields + 7 column pickers (Primitive) |
| Custom Field | `Calendar Event` (Object + Dynamic Schema) | **None** (deleted) |
| Webhook handler | Thin relay (channelId only) | Fetches events + fires trigger per event |
| Action work | Fetch events itself + CRUD | Receives event data + does CRUD |
| Column mapping config | Custom Field with subfield mapping UI | Per-column dropdowns (Remote Options URL) |
| Builder visibility | Both On | **Workflow only** |
| Stored Google token | No | **Yes** (in channel data) |

### Migration Steps

1. **Code changes:**
   - `webhook.js` → fetch events with stored token, fire trigger per event with full data
   - `triggers.js` → store `boardId` and `accessToken` in channel
   - `actions.js` → read individual column IDs and event fields from `inboundFieldValues`
   - `monday-api.js` → add `getBoardColumns(boardId, type)` for Remote Options URL
   - `routes/options.js` → new file: handle `/options/columns?type=X`
   - `sync-engine.js` → simpler: receives event data ready, no fetching

2. **Developer Center changes:**
   - **Delete** Calendar Event Custom Field
   - **Trigger** → add 7 output fields + boardId input + boardId output; remove Calendar Event input
   - **Action** → replace Calendar Event input with 7 individual column picker inputs + 7 trigger output inputs
   - **All blocks** → set Automation builder: Off, Workflow builder: On

---

## GCP Configuration

| Item | Value |
|------|-------|
| Project ID | `lithe-breaker-491415-p0` |
| APIs enabled | Google Calendar API, Google People API |
| OAuth Client ID | `827989722403-...apps.googleusercontent.com` |
| OAuth type | Web application |
| Redirect URI | `https://apps-credentials.monday.com/authorize/oauth2/redirect-uri` |
| Scopes | `calendar.events.readonly`, `userinfo.email` |
| Consent screen | External, Testing status |

---

## Environment Variables (monday code)

| Variable | Purpose | Updated when |
|----------|---------|--------------|
| `MONDAY_SIGNING_SECRET` | Sign JWTs for webhookUrl POST + verify incoming JWTs | Once (or on rotation) |
| `MONDAY_APP_ID` | JWT payload when firing triggers (Number, not string!) | Once |
| `APP_BASE_URL` | Construct Google Watch Channel callback URL | After every deploy (URL changes) |

---

## Open Questions / Future Work

1. **Refresh token storage** — Credentials feature may not provide `refresh_token`. If access token expires before re-subscribe, webhook handler fails. Need to investigate Credentials feature's refresh mechanism.
2. **Date primitive vs string** — Need to test if two `date` primitive output fields cause UI issues. Fall back to `string` (ISO 8601) if needed.
3. **Column type filtering** — `text` and `long_text` are separate; need to map Description to which? Same for People vs Email for Organizer.
4. **Recurring events** — currently `singleEvents: true` in `events.list()`. Each occurrence appears as separate event with unique ID. May need special handling for series-level updates.
5. **Bulk webhook** — Google may batch many changes in one push. Webhook handler iterates all events; ensure rate limits (monday API + SecureStorage) are respected.
6. **Native "Create item" alternative** — If users prefer monday's native action UI (with built-in column mapping), they can use the trigger with native "Create item" instead of our custom action. Loses update/delete capability but simpler. Document both paths.
