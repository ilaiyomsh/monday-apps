# Architecture v2 — Google Calendar → monday.com Sync

## Project Goal

One-way sync from **Google Calendar → monday.com board**, hosted on **monday code** (serverless Node.js).

Events are synced only when the authenticated user has **accepted** the invitation (RSVP filter). The app supports full CRUD: create new items, update existing items, and delete items when events are cancelled or declined.

---

## Design Principles

1. **Thin relay webhook** — webhook handler does no business logic, just forwards `channelId` to monday via webhookUrl
2. **Fresh tokens always** — the Action receives fresh Google + monday tokens on every invocation from monday (no stored token expiration issues)
3. **Event identity via board column** — event-to-item mapping lives in a **Link column** on the board (not in SecureStorage), storing the Google Calendar event URL which contains the event ID
4. **Separation of concerns** — Trigger handles Google connection + watch channel; Action handles board, column mapping, and CRUD
5. **User-configured mapping** — column mapping is defined by the user in the Action block, not hardcoded

---

## monday.com App Features

| Feature | Type | Slug | Purpose |
|---------|------|------|---------|
| Google Calendar | Credentials | `google-calendar-credentials` | Google OAuth 2.0 managed by monday |
| Google Calendar Trigger | Automation Block (Trigger) | `calendarevents` | Fires when calendar changes, emits channelId |
| Sync Calendar Events | Automation Block (Action) | `sync-calendar-events` | Full CRUD: fetch events, search board, create/update/delete items |
| Calendar Event | Custom Field for Automation Block | `calendar-event-field` | Defines event field schema for column mapping (Object + Dynamic Schema) |

---

## Block Configuration

### Trigger: Google Calendar Trigger

**Credentials:**
- Google Calendar account (`google_credentials`)

**Input fields:** None (no user configuration besides credentials)

**Output fields:**

| Key | Type | Purpose |
|-----|------|---------|
| `channelId` | String | Identifies the watch channel → Action uses this to look up syncToken |

### Action: Sync Calendar Events

**Credentials:**
- Google Calendar account (`google_credentials`) — receives **fresh** accessToken on every invocation

**Input fields (configured by user in Workflow Builder):**

| Key | Type | Source | Purpose |
|-----|------|--------|---------|
| `channelId` | String | From trigger output | Look up syncToken in SecureStorage |
| `boardId` | Board selector | User selects | Which board to create/update/delete items in |
| `linkColumnId` | Column selector | User selects (depends on boardId) | Link column for storing event URL (= event identity) |
| `calendarEvent` | Calendar Event (Custom Field) | User maps columns | Maps event fields → board columns |

### Workflow Builder UI

```
Step 1: Google Calendar Trigger
  → Connect Google account
  (no other configuration)

Step 2: Sync Calendar Events (Custom Action)
  → Board: [user selects board]
  → Event Link Column: [user selects a Link column]
  → Calendar Event: [user maps event fields to board columns]
      Event Name    → Name column
      Start Date    → Date column
      End Date      → Date column
      Description   → Text column
      Location      → Text column
      Organizer     → Text column
      Event Link    → (auto-saved to Link column above)
```

---

## High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ SETUP (subscribe — when user activates workflow)                │
│                                                                 │
│  monday calls POST /triggers/subscribe with:                    │
│    • credentialsValues.google_credentials.accessToken            │
│    • webhookUrl                                                 │
│                                                                 │
│  Server:                                                        │
│    1. Generate channelId (UUID)                                 │
│    2. Register Google Calendar Watch Channel                    │
│       (callback: APP_BASE_URL/webhook/calendar, token: channelId)│
│    3. Fetch initial syncToken via events.list()                 │
│    4. Store in SecureStorage:                                   │
│       channel_<channelId> = { webhookUrl, syncToken,            │
│                               userId, resourceId, expiration }  │
│    5. Return { webhookId: channelId }                           │
│                                                                 │
│  Note: NO board/mapping info stored — Action receives it fresh  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ RUNTIME (per calendar change — two-phase relay)                 │
│                                                                 │
│  Phase 1: Webhook handler (thin relay, NO tokens needed)        │
│                                                                 │
│    Google POSTs to /webhook/calendar                            │
│      → Verify X-Goog-Channel-Token → channelId                 │
│      → SecureStorage.get(channelId) → { webhookUrl }            │
│      → POST to webhookUrl:                                      │
│          Authorization: JWT signed with MONDAY_SIGNING_SECRET   │
│          Body: { trigger: { outputFields: { channelId } } }    │
│      → Return 200 to Google immediately                         │
│                                                                 │
│  Phase 2: Action handler (all business logic, FRESH tokens)     │
│                                                                 │
│    monday calls POST /actions/sync-events with:                 │
│      • Fresh credentialsValues.google_credentials.accessToken   │
│      • Fresh shortLivedToken (monday API)                       │
│      • inboundFieldValues:                                      │
│          channelId     ← from trigger output                    │
│          boardId       ← user-configured                        │
│          linkColumnId  ← user-configured                        │
│          calendarEvent ← column mapping (user-configured)       │
│                                                                 │
│    Action:                                                      │
│      1. SecureStorage.get(channelId) → { syncToken }            │
│      2. events.list(syncToken) with fresh Google token          │
│         → returns changed events + newSyncToken                 │
│      3. For each changed event:                                 │
│         a. Search board: query items where linkColumnId          │
│            contains event URL (= event identity)                │
│         b. Apply decision matrix (see below)                    │
│      4. Store newSyncToken in SecureStorage                     │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ SCHEDULED (daily cron — channel renewal)                        │
│                                                                 │
│  POST /scheduler/renew-channel                                  │
│    → Read all active channels from SecureStorage                │
│    → For channels nearing expiration (< 24 hours):              │
│        POST to webhookUrl with:                                 │
│        { trigger: { outputFields: { channelId, action: "renew" } } } │
│    → monday fires Action with fresh tokens                      │
│    → Action sees action="renew" → re-registers Watch Channel    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sync Decision Matrix

For each event returned by `events.list(syncToken)`:

| shouldSync(event) | Item exists in board? | Action |
|-------------------|----------------------|--------|
| `true` | No (event URL not found) | **Create** item + set link column with event URL |
| `true` | Yes (event URL found) | **Update** item columns |
| `false` | Yes (event URL found) | **Delete** item (RSVP declined, event cancelled) |
| `false` | No | **Skip** — nothing to do |

### shouldSync (RSVP filter)

```javascript
function shouldSync(event) {
  if (event.status === 'cancelled') return false;
  if (!event.attendees?.length) return true;  // sole organizer → always sync
  const self = event.attendees.find(a => a.self === true);
  return self?.responseStatus === 'accepted';
}
```

---

## Event Identity: Link Column

Instead of storing `eventId → itemId` mappings in SecureStorage (which doesn't scale), the event identity lives **on the board itself** in a Link column:

- **URL:** `https://www.google.com/calendar/event?eid=<encoded>` (from `event.htmlLink`)
- **Display text:** Event title or "Google Calendar"
- **Lookup:** To find an existing item, query monday API for items where the link column contains the event URL

**Advantages:**
- No SecureStorage entries per event (was hundreds of thousands of keys)
- Visible to the user — they can see which Calendar event an item is linked to
- Survives app redeployment — data lives in monday, not in ephemeral storage
- Clickable — user can open the Calendar event directly

**How the lookup works:**

```graphql
query {
  items_page_by_column_values(
    board_id: $boardId,
    columns: [{ column_id: $linkColumnId, column_values: [$eventUrl] }]
  ) {
    items { id }
  }
}
```

---

## Token Flow

| Endpoint | Google Token | Monday Token | Source |
|----------|-------------|-------------|--------|
| `/triggers/subscribe` | `credentialsValues` (fresh) | `shortLivedToken` from JWT | monday-initiated |
| `/triggers/unsubscribe` | `credentialsValues` (fresh) | `shortLivedToken` from JWT | monday-initiated |
| `/webhook/calendar` | **None** (thin relay) | **None** (thin relay) | Google-initiated |
| `/actions/sync-events` | `credentialsValues` (fresh!) | `shortLivedToken` (fresh!) | monday-initiated via webhookUrl |
| `/field-definitions/calendar-event` | None | None | monday-initiated (UI) |
| `/auth/google-identifier` | From Credentials feature | None | monday-initiated |
| `/scheduler/renew-channel` | **None** (relay only) | **None** (relay only) | monday scheduler |

**Key advantage over previous design:** All endpoints that need Google tokens receive them **fresh** from monday. No stored tokens that can expire.

---

## Trigger Output: Calendar Event Object

The trigger output `calendarEvent` is defined by a Custom Field (Object + Dynamic Schema). The Schema URL (`/field-definitions/calendar-event`) returns the structure:

| Field Key | Title | Type | Nullable | Description |
|-----------|-------|------|----------|-------------|
| `event_name` | Event Name | string | No | Event title (summary) |
| `start_date` | Start Date | date | Yes | Start date/time (ISO 8601) |
| `end_date` | End Date | date | Yes | End date/time (ISO 8601) |
| `description` | Description | string | Yes | Event description |
| `location` | Location | string | Yes | Event location |
| `organizer` | Organizer | string | Yes | Organizer name or email |
| `event_link` | Event Link | string | Yes | Link to Google Calendar event |

**Note:** In v2, the trigger does NOT emit event data directly. It only emits `channelId`. The Action fetches the events itself using fresh tokens. The Calendar Event custom field is used by the Action for **column mapping configuration**, not for runtime data transfer.

---

## Storage Schema (SecureStorage)

| Key | Value | Purpose |
|-----|-------|---------|
| `channel_<channelId>` | `{ webhookUrl, syncToken, userId, resourceId, expiration }` | Watch channel metadata |
| `user_channels_<userId>` | `["channelId1", ...]` | Active channels per user (for cleanup) |
| `all_active_channels` | `[{ channelId, webhookUrl, userId, expiration }, ...]` | Global index for cron renewal |

**What is NOT stored:**
- `boardId` — Action receives it from monday on every invocation
- `columnMapping` — Action receives it from monday on every invocation
- `accessToken` — Action receives fresh token from monday on every invocation
- `eventId → itemId` — Lives on the board in the Link column

---

## Server Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `POST` | `/triggers/subscribe` | Register Google Watch Channel | monday JWT |
| `POST` | `/triggers/unsubscribe` | Stop Watch Channel, cleanup storage | monday JWT |
| `POST` | `/webhook/calendar` | Thin relay: forward channelId to webhookUrl | X-Goog-Channel-Token |
| `POST` | `/actions/sync-events` | Full CRUD: fetch events, search board, create/update/delete | monday JWT (via webhookUrl) |
| `POST` | `/field-definitions/calendar-event` | Return Calendar Event object schema | None |
| `POST` | `/auth/google-identifier` | Return user email for Credentials display | monday JWT |
| `POST` | `/scheduler/renew-channel` | Daily cron: relay to webhookUrl for channel renewal | monday scheduler |

---

## Module Structure

```
sync-calender/
├── src/
│   ├── index.js                    # Express server entry (port 8080)
│   ├── routes/
│   │   ├── webhook.js              # Thin relay: channelId → webhookUrl
│   │   ├── triggers.js             # subscribe + unsubscribe
│   │   ├── actions.js              # Full CRUD: fetch events + search board + create/update/delete
│   │   ├── field-definitions.js    # Schema URL: Calendar Event object definition
│   │   ├── auth.js                 # Google identifier for Credentials feature
│   │   └── scheduler.js            # Cron: relay to webhookUrl for channel renewal
│   ├── services/
│   │   ├── google-calendar.js      # watch(), events.list(), channels.stop()
│   │   ├── monday-api.js           # GraphQL: create_item, update_item, delete_item, search by column
│   │   ├── monday-triggers.js      # POST to webhookUrl (JWT signed)
│   │   ├── sync-engine.js          # RSVP filter + decision matrix + dispatch
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

| Variable | Value | Purpose |
|----------|-------|---------|
| `MONDAY_SIGNING_SECRET` | `43f7c...` | Sign JWTs for webhookUrl POST + verify incoming JWTs |
| `MONDAY_APP_ID` | `11119011` | JWT payload when firing triggers (must be Number) |
| `APP_BASE_URL` | `https://d72cb-service-...monday.app` | Construct Google Watch Channel callback URL |

---

## Edge Cases & Scenarios

### Event created (no other attendees)
Google webhook → relay → Action fetches event → `shouldSync=true` (sole organizer) → search board by link column → not found → **Create item**

### Event updated (title/time changed)
Google webhook → relay → Action fetches event → `shouldSync=true` → search board → found → **Update item**

### Event deleted
Google webhook → relay → Action fetches event with `status: "cancelled"` → `shouldSync=false` → search board → found → **Delete item**

### Event created, user declines
Google webhook → relay → Action fetches event → `shouldSync=false` (RSVP not accepted) → search board → not found → **Skip**

### User changes RSVP from declined to accepted
Google webhook → relay → Action fetches event → `shouldSync=true` → search board → not found → **Create item**

### User changes RSVP from accepted to declined
Google webhook → relay → Action fetches event → `shouldSync=false` → search board → found → **Delete item**

### Watch channel nearing expiration
Daily cron → relay with `action: "renew"` → Action receives fresh token → re-register Watch Channel

---

## Open Questions / Future Work

1. **Calendar Event custom field rendering** — shows "No options available" in Automation Builder. Works in Workflow Builder. Need to verify Dynamic Schema Object renders correctly as Action input.
2. **Link column search** — need to verify `items_page_by_column_values` works with Link column type. If not, may need to use `items_page` with `query_params` or store event ID in a Text column instead.
3. **Multiple events per webhook** — Google may batch multiple changes in one push notification. `events.list(syncToken)` returns all changes since last sync. The Action must process all of them in a single invocation.
4. **Concurrent webhooks** — Google may send multiple push notifications in quick succession. Need to handle syncToken updates atomically to avoid processing the same events twice.
5. **Action block visibility** — currently visible in Workflow Builder but not in classic Automation Builder. May need configuration adjustment.
