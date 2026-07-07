# End-to-End Test Plan — Full Payload Capture

**Goal:** exercise every server endpoint with live traffic on V6 (now live), capture the full `req.body` for each, and specifically observe what happens when `eventId` / `eventStatus` are **not** mapped in the action, plus what happens when the recipe is edited while items already exist.

**Prerequisites:**

1. Two terminals open:
   - Terminal A (log streaming, leave running):
     ```bash
     mapps code:logs -i 14023109 -s live -t console
     ```
   - Terminal B (ad-hoc mapps / curl commands as needed)

2. Test board in monday with these columns (IDs will show up in the logs):
   - **Link column** — for event URL / identity
   - **People column** — to verify `peopleColumnId` assignment
   - **Date column** — to map `startDate`
   - **Number column** — to map `duration`
   - **Text column** — to map `description`

3. Clean slate (Phase 0).

---

## Phase 0 — Clean state

1. On the test board, remove any existing "Sync Calendar Events" automation.
   - **Expected endpoint:** `POST /triggers/unsubscribe`
   - **Expected log line:** `incoming request | path=/triggers/unsubscribe | body={...}` (full body dump), followed by `unsubscribe received`, `google watch channel stopped`, `channel storage cleaned up`.
2. Delete the matching Google Calendar watch if it's still active (optional safety — usually handled by unsubscribe). Done automatically by step 1.
3. Optional: inspect SecureStorage for stale entries.
   ```bash
   mapps storage:export -a 11119011 2>&1 | grep -E '(channel_|user_channels_|all_active_channels)'
   ```
   Expect no `channel_<uuid>` keys for your user.

---

## Phase 1 — Initial subscribe (happy path, full mapping)

1. In the workflow builder, pick the recipe "When a Google Calendar event …, then Sync Calendar Events".
2. **Step 1 (Trigger) — Google Calendar:** connect your Google account.
   - **Expected endpoint:** `POST /auth/google-identifier` (first time you add Credentials)
   - **Log:** `incoming request | path=/auth/google-identifier | body={"token":"<google token>"}` → `google identifier received | userId=... | hasToken=true`.
3. **Step 2 (Action) — Sync Calendar Events:** map **every** field:
   - `Board` → test board
   - `linkColumnId` → the Link column
   - `peopleColumnId` → the People column
   - `itemName` ← Trigger's "Event Name"
   - `channelId` ← Trigger's "Channel ID"
   - `eventId` ← Trigger's "Event ID"
   - `eventStatus` ← Trigger's "Event Status"
   - `eventLink` ← Trigger's "Event Link" (if required)
   - Item Values mapping: map each board column to the relevant trigger output (startDate → Date column, duration → Number column, description → Text column).
4. Save the automation.
   - **Expected endpoint:** `POST /triggers/subscribe`
   - **Log:** `incoming request | path=/triggers/subscribe | body={"payload":{"webhookUrl":"...","subscriptionId":"...","credentialsValues":{...}}}` → `subscribe received` → `google events.watch response` → `subscribe complete`.
   - Note: also triggers an immediate `POST /webhook/calendar` from Google with `x-goog-resource-state: sync` (verification ping) — logs `google sync verification received`, returns 200.

**Action items:**
- ✔ Capture: exact `subscribe` body (full credential token format).
- ✔ Capture: exact `auth/google-identifier` body.
- ✔ Capture: the Google verification webhook (headers only — no body).

---

## Phase 2 — Create event (create path)

1. In Google Calendar, create a new event in the primary calendar.
   - Title: `"Test Event A"`
   - Start: any future time (today)
   - Make sure your own RSVP is accepted (no attendees = self-organized, treated as accepted by our RSVP filter).
2. Wait ~1–5 seconds.
   - **Expected endpoint sequence:**
     1. `POST /webhook/calendar` (from Google, body empty, headers carry `x-goog-channel-token`)
     2. `POST <monday webhookUrl>` (outgoing from our server — fire trigger with rich `outputFields`)
     3. `POST /actions/sync-events` (from monday workflow engine)
   - **Log for (1):** `incoming request | path=/webhook/calendar | headers={...x-goog-channel-token...} | body={}` → `google webhook received` → `webhook fetched events | eventCount=1` → `webhook v3 fire complete | triggersFired=1`.
   - **Log for (3):** `incoming request | path=/actions/sync-events | body={"payload":{"credentialsValues":{"google_credentials":{"accessToken":"ya29..."}}, "inboundFieldValues":{"channelId":"...", "eventId":"...", "eventStatus":"confirmed", "itemName":"Test Event A", "item":{...}, "peopleColumnId":"..."}}}` → `action invoked | eventStatus=confirmed` → `v3 event created | itemId=...`.
3. Verify on the board:
   - New item appears with name "Test Event A"
   - Link column contains the event URL
   - Date column contains the start date
   - People column contains you
   - All mapped Item Values present

**Action items:**
- ✔ Capture: full `/actions/sync-events` body with `inboundFieldValues` populated.
- ✔ Capture: the outgoing trigger-fire body (in `fire trigger request` log).

---

## Phase 3 — Update event (update path)

1. In Google Calendar, edit "Test Event A":
   - Rename to `"Test Event A (edited)"`
   - Change start time
2. Wait.
   - Same endpoint sequence as Phase 2.
   - **Log:** `action invoked | eventStatus=confirmed` → `v3 event updated | itemId=<same as create>` (NOT a new item).
3. Verify: item renamed, date updated, NOT duplicated.

---

## Phase 4 — Decline event (RSVP → cancelled delete)

1. Have a colleague invite you to a new event, OR: create the event, add yourself as attendee via the invitees list, then change your response to "Declined".
2. Wait.
   - **Expected log:** `webhook firing declined event as cancelled` (special handling in webhook.js) → action receives `eventStatus=cancelled` → `v3 event deleted` **if** the item existed; otherwise `v3 cancelled event has no matching item, skipping`.

---

## Phase 5 — Delete event (delete path)

1. In Google Calendar, delete "Test Event A (edited)".
2. Wait.
   - **Expected log:** webhook reports event with `status=cancelled`, fires trigger with `eventStatus=cancelled`, action calls `deleteItem` → `v3 event deleted`.
3. Verify: the item is removed from the board.

---

## Phase 6 — Mid-session recipe change (critical test)

**Purpose:** find out whether editing an already-saved automation (changing column mappings) causes `/triggers/unsubscribe` + `/triggers/subscribe`, or whether monday only updates the mapping internally. Also verify that events created BEFORE the change keep their old mapping, while events created AFTER use the new one.

1. Create a fresh event "Test Event B" in Google Calendar. Let it sync (same sequence as Phase 2). Verify item lands with the current mapping.
2. Now in monday workflow builder, edit the same automation:
   - Swap which board column receives `startDate` (map it to a different date column, or unmap and remap).
3. Save the edited automation.
   - **Observation question:** does this fire `/triggers/unsubscribe` + `/triggers/subscribe`? Or nothing at all?
   - **Capture whatever endpoint(s) fire** — this is the data point we want.
4. Create a new event "Test Event C" in Google Calendar.
   - **Expected:** the new item uses the NEW column mapping.
5. Edit the older event "Test Event B" in Google Calendar (change its description).
   - **Expected:** the existing "Test Event B" item gets updated using the NEW mapping too — because the action always writes whatever `inboundFieldValues.item` contains at invocation time, regardless of when the item was originally created. The old columns that were mapped previously stay stale; new columns that are now mapped get populated.

**Action items:**
- ✔ Log whatever fires (or nothing) when editing the recipe mid-session.
- ✔ Confirm: does `channelId` change after a recipe edit? (If `/triggers/subscribe` re-runs, a new channel is registered.)

---

## Phase 7 — Misconfigured action (eventId + eventStatus UNMAPPED)

**Purpose:** capture what monday actually sends to `/actions/sync-events` when the user left the routing inputs empty. This is the bug that bit us on 2026-04-15.

1. Edit the automation again:
   - Clear the `eventId` input field (empty it)
   - Clear the `eventStatus` input field (empty it)
   - Leave everything else mapped
2. Save.
3. Create a new event "Test Event D" in Google Calendar.
4. Wait.
   - **Expected sequence in logs:**
     1. `/webhook/calendar` fires as normal.
     2. Outgoing trigger fire: `fire trigger request | outputFields={..., "eventId":"...", "eventStatus":"confirmed", ...}` — the trigger DOES include these.
     3. `/actions/sync-events` incoming. **The key log line** is `incoming request | path=/actions/sync-events | body=<FULL>`. Inspect the `body.payload.inboundFieldValues` object: `eventId` and `eventStatus` should be **absent** (not `null`, not `""` — the keys don't exist), proving that monday strips unmapped inputs.
     4. `action invoked | eventStatus=undefined` → `action using v2 fallback path`.
     5. v2 fallback re-fetches events with the same `syncToken` the webhook just consumed → 0 events → `processing events | eventCount=0` → silent no-op.
5. **Result:** the event is NOT synced to the board. Silent data loss confirmed.
6. **Optional:** re-run by creating "Test Event E". Same result — until the user re-maps the fields or we change the code.

**Action items:**
- ✔ Capture the **raw** `inboundFieldValues` when eventId/eventStatus unmapped. Confirms whether monday sends `undefined`, `null`, `""`, or omits the key entirely.
- ✔ Confirm the silent-data-loss failure mode documented in `09-routing-fields-ux-research.md` Open Question 4.

---

## Phase 8 — Restore mapping + verify recovery

1. Edit the automation, remap `eventId` and `eventStatus` to Trigger outputs.
2. Save.
3. Create "Test Event F".
4. **Expected:** v3 path runs again, event syncs cleanly.
5. **Important side-effect:** any events created during Phase 7 (D, E) were NOT recorded because v2 consumed their `syncToken`. They won't retroactively sync. If this is a problem, note it — a full re-sync would require invalidating the stored `syncToken`.

---

## Phase 9 — Unsubscribe

1. Delete the automation from the board.
   - **Expected endpoint:** `POST /triggers/unsubscribe` with full body.
   - **Log:** `unsubscribe received` → `google watch channel stopped` → `channel storage cleaned up`.
2. Create a new event in Google Calendar. Verify that **nothing** fires in the logs (channel is closed).

---

## Phase 10 — Cron / scheduler (time-gated, optional)

The daily `/scheduler/renew-channel` fires at `0 8 * * *` UTC (monday's scheduler). It only runs on channels expiring in < 24h. To test it manually:

**Option A — wait:** trigger the cron at 08:00 UTC, inspect log lines starting with `incoming request | path=/mndy-cronjob/renew-channel` or `path=/scheduler/renew-channel`.

**Option B — force a renewal:** set a channel's expiration to < 24h manually (requires storage write), then wait until 08:00 UTC, OR invoke the scheduler through monday's cron management if exposed.

**Option C — simulate locally:** skip this phase if time-bounded testing is enough for now.

---

## Phase 11 — Field definitions endpoint (v2 legacy, optional)

`POST /field-definitions/calendar-event` only fires when the workflow builder renders the **legacy v2** `calendarEvent` Custom Field. If you want to test it:

1. In Developer Center, temporarily enable the `calendarEvent` Custom Field on the action block.
2. Save the block.
3. Open the workflow builder and attempt to configure the action — the UI will call this endpoint to learn the schema.
   - **Expected body:** empty or a minimal request identifying the field to render.
   - **Expected response:** the JSON schema object documented in CLAUDE.md.
4. Capture the request body from the `incoming request` log.

---

## Summary — Which endpoints to expect in each phase

| Phase | Endpoints triggered |
|-------|---------------------|
| 0 | `/triggers/unsubscribe` |
| 1 | `/auth/google-identifier`, `/triggers/subscribe`, `/webhook/calendar` (verification) |
| 2 | `/webhook/calendar`, outgoing trigger fire, `/actions/sync-events` |
| 3 | same as Phase 2 |
| 4 | same as Phase 2 (with `eventStatus=cancelled`) |
| 5 | same as Phase 2 (with `eventStatus=cancelled`) |
| 6 | unknown — that's what we're testing; then same as Phase 2 |
| 7 | `/webhook/calendar`, outgoing trigger fire, `/actions/sync-events` (v2 fallback) |
| 8 | `/webhook/calendar`, outgoing trigger fire, `/actions/sync-events` (v3 restored) |
| 9 | `/triggers/unsubscribe` |
| 10 | `/mndy-cronjob/renew-channel` (optional) |
| 11 | `/field-definitions/calendar-event` (optional) |

## Per-phase data to capture

For each phase, from terminal A's log stream, extract and save:
1. Every `incoming request` line — this is the full dump of method, path, headers, query, and body. Correlate by timestamp.
2. Every `fire trigger request` line — the outgoing JWT + outputFields we send to monday's webhookUrl.
3. Action branch taken: `action invoked | eventStatus=<value>` followed by either `v3 event created/updated/deleted` or `action using v2 fallback path`.

Suggested capture method: save the full log per phase to a file so you can diff across phases.
```bash
# in terminal B, filter and save logs for Phase N
mapps code:logs -i 14023109 -s live -t console | tee /tmp/sync-phase-N.log
```

---

## What to bring back

After running, paste (or summarize) for each phase:

1. The complete `incoming request` payload for every endpoint.
2. For Phase 6: what fired when the recipe was edited.
3. For Phase 7: the exact shape of `inboundFieldValues` when `eventId` / `eventStatus` unmapped (absent vs `null` vs `""`).

With those three data points we can close Open Questions 1 and 4 from `09-routing-fields-ux-research.md`.
