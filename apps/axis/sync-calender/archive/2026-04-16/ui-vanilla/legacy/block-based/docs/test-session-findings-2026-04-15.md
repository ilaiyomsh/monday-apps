לאים# Test Session Findings — 2026-04-15

**Source logs:** `/tmp/sync-logs.log` (640 lines, primary session 14:08–14:14) and `/tmp/sync-logs-2.log` (86 lines, separate session 14:15–14:17)
**App version:** V6 (id 14023109), now live

## Endpoint call summary

| Endpoint | Hits (log 1) | Hits (log 2) | Total |
|---|---|---|---|
| `/webhook/calendar` | 59 | 10 | 69 |
| `/actions/sync-events` | 9 | 1 | 10 |
| `/triggers/subscribe` | 4 | 1 | 5 |
| `/triggers/unsubscribe` | 4 | 0 | 4 |
| `/auth/google-identifier` | 1 | 0 | 1 |
| `/health` (HEAD, monday probes) | 4 | 2 | 6 |
| `/field-definitions/calendar-event` | 0 | 0 | 0 |
| `/scheduler/renew-channel` | 0 | 0 | 0 |

## 10 action invocations — full map

| # | Time | channelId | eventId | eventStatus | itemName | Phase |
|---|---|---|---|---|---|---|
| 1 | 14:08:28 | 152ce7ec | 24t88… | `confirmed` | `test event a` | 2 (Create) |
| 2 | 14:09:02 | 152ce7ec | 24t88… | `confirmed` | `test event a` | 3 (Update) |
| **3** | **14:09:06** | **152ce7ec** | **`""`** | **`""`** | **`""`** | **Mystery — see Finding 2** |
| 4 | 14:09:18 | 152ce7ec | 24t88… | `cancelled` | `test event a` | 5 (Delete) |
| 5 | 14:09:40 | 152ce7ec | 3pa85… | `confirmed` | `test event b` | 6 (before recipe edit) |
| 6 | 14:10:36 | **9f367a82** | 6iprc… | `confirmed` | `test event c` | 6 (after recipe edit #1 — new channel) |
| 7 | 14:11:06 | 9f367a82 | 3pa85… | `confirmed` | `test event b` | 6 (existing event via new channel) |
| **8** | **14:12:34** | **a6676349** | **3gg68…** | **(key absent)** | **`test event d`** | **7 (user unmapped eventStatus)** |
| 9 | 14:13:51 | 87b16f91 | 2vur5… | `confirmed` | `test event f` | 8 (remapped) |
| 10 | 14:16:50 | e750d52b | 2vur5… | `cancelled` | `test event f` | 9 (delete, separate session) |

Channel turnover: `152ce7ec → 9f367a82 → a6676349 → 87b16f91 → e750d52b` = five distinct watch channels for this one user during the test. Every recipe edit created a new one.

## Findings

### Finding 1 (confirmed) — Editing a saved automation fires `unsubscribe` + `subscribe`

Three times during the test the user edited the mapping in the workflow builder. Each time the logs show:
- `POST /triggers/unsubscribe` (old `channelId`)
- Immediately followed by `POST /triggers/subscribe` (new `channelId`)

Consequences:
- A fresh Google watch channel is registered.
- The `syncToken` starts over — any events Google would have sent between old unsubscribe and new subscribe are not replayed; Google syncs from the moment the new channel starts.
- Items already created on the board are **not** deleted — `unsubscribe` only tears down the subscription, not its outputs. New events created after the edit go through the new mapping. Existing items that receive subsequent updates are re-written with the new column mapping (see invocation #7 — old event "test event b" was edited again after the recipe change; the action wrote it through the new channel with the new mapping).

### Finding 2 (NEW — the key UX insight) — `inboundFieldValues` shape depends on WHY a field is "empty"

This is the most important observation of the session. There are **two distinct ways** a field can arrive "empty" in the action, and they look different on the wire:

**Case A — User did NOT map the input in the workflow builder** (invocation #8, raw payload below):
```json
"inboundFieldValues": {
  "channelId": "a6676349-a97d-469f-8327-3313d86c0a6b",
  "boardId": 1953193772,
  "peopleColumnId": "multiple_person_mkqwq9gz",
  "linkColumnId": "link_mm2dfvy3",
  "itemName": "test event d",
  "item": { "text_mkqwc4p1":"", "date_mkqwkw4q":"2026-04-15T23:00:00+03:00", "numeric_mkqw4pgm":1, "date_mm2etg89":"2026-04-16T00:00:00+03:00" },
  "eventId": "3gg68cut0lngsfpc3kjd825pqe"
}
```
**Note: the `eventStatus` key is completely absent from the object.** monday strips unmapped inputs. In code, `inboundFieldValues?.eventStatus` returns `undefined` because the property does not exist.

**Case B — Input is mapped, but the trigger output itself was empty** (invocation #3, raw payload below):
```json
"inboundFieldValues": {
  "channelId": "152ce7ec-140f-486b-8649-49269bc87fba",
  "boardId": 1953193772,
  "peopleColumnId": "multiple_person_mkqwq9gz",
  "linkColumnId": "link_mm2dfvy3",
  "itemName": "",
  "item": { "text_mkqwc4p1":"", "date_mkqwkw4q":"", "numeric_mkqw4pgm":0 },
  "eventId": "",
  "eventStatus": ""
}
```
Here `eventId` and `eventStatus` keys are **present** but hold empty strings `""`. This fires when the webhook falls to its v2 fallback path (`fireTrigger(webhookUrl, { channelId })` with no other fields), monday's workflow engine still passes every mapped input to the action — filled with type-appropriate defaults (`""` for strings, `0` for numbers, all nested item subfields zeroed out).

**Implications for our code:**
- `if (eventId && eventStatus)` correctly handles both cases — both `undefined` and `""` are falsy, so v2 fallback is taken in both.
- BUT: telling them apart matters for error reporting and future behavior. A user error (Case A) is worth surfacing loudly; a webhook-fetch failure (Case B) is transient.
- This fully answers **Open Question 1** from `09-routing-fields-ux-research.md`: unmapped fields are omitted from the payload, not sent as `null` or `""`.

### Finding 3 (confirmed — known behavior) — Invocation #8 fell silently to v2

Invocation #8 (user unmapped `eventStatus`) took the v2 fallback path. v2 re-fetched events using the stored `syncToken`, got 0 new events (the webhook had just consumed them), and the action returned `{ok: true}` with no item created on monday. The event "test event d" was never synced. Silent data loss, as predicted.

### Finding 4 (NEW — serious cleanup issue) — Five orphaned Google watch channels keep pushing

At the end of the test, unique channel IDs seen pushing `/webhook/calendar` include:

- `015c497b-723e-404c-9519-5398a28dbcfd` — in SecureStorage, `accessToken` is expired → every fetch errors `Invalid Credentials` → falls to v2 relay
- `ef8983b0-2330-4acb-a8a4-f81c26c6ae2c` — same state
- `cfc2dcc3-6a0c-4ed7-98ed-ce08103d901d` — same state (this is the channel from the 2026-04-14 session!)
- `152ce7ec-140f-486b-8649-49269bc87fba` — same state (a `SecureStorage` transient error is also in play here)
- `a6676349-a97d-469f-8327-3313d86c0a6b` / `9f367a82…` / `cb6073b2…` / `87b16f91…` — **unknown** to our storage (handler logs `unknown channelId in webhook`)

Even if our handler correctly returns 200 and takes no action, Google keeps retrying notifications to the live URL. Causes:
- **Unsubscribe never stopped these channels on Google's side** — either the stored `accessToken` had already expired when the user removed the automation, or `channels.stop()` silently failed and the code moved on without retry.
- **Storage entries deleted before `channels.stop()` succeeded** — for the "unknown" ones, we no longer know the `resourceId`, so we can't stop them even if we wanted to.

Until all these channels hit their Google-side expiration (7 days), they will keep pushing. That's background noise and slightly wasted server work, but not data corruption.

### Finding 5 (related) — Stored `accessToken` goes stale for idle subscriptions

The v3 design relies on "refresh on every action invocation" to keep the stored Google `accessToken` fresh. But if a subscription doesn't fire an action for > 1 hour, its stored token expires. When Google pushes again, the webhook's `events.list()` returns 401 Invalid Credentials → v2 fallback fires with only `channelId` → the action then restores the token from `credentialsValues`. Self-heals on the next action.

However, for channels that have been **abandoned** (superseded by a recipe edit → old channel never unsubscribed on our side, or unsubscribed but not stopped on Google's side), the token is never refreshed and they stay broken forever.

### Finding 6 (Phase 6 side-question — answered) — Items created before a recipe edit are NOT wiped

Invocation #7 shows "test event b" (created at 14:09:40 with old channel 152ce7ec under the old mapping) being updated at 14:11:06 through the new channel 9f367a82 under the new mapping. The item persisted on the board through the recipe edit cycle; the lookup by Link column URL works fine across channels because identity is on the board, not in storage.

## Raw payload samples

### `/auth/google-identifier` (excerpt)
Body structure (reconstructed from log context — sensitive parts redacted here for this doc):
```json
{
  "payload": {
    "credentialsValues": {
      "google_credentials": {
        "userCredentialsId": 221927,
        "accessToken": "ya29.a0Aa7MY..."
      }
    }
  }
}
```

### `/triggers/subscribe` (typical shape)
```json
{
  "payload": {
    "webhookUrl": "https://<monday-webhookurl>",
    "subscriptionId": 4961234,
    "recipeId": 2080451,
    "integrationId": 164534466,
    "credentialsValues": {
      "google_credentials": {
        "userCredentialsId": 221927,
        "accessToken": "ya29.a0...",
        "userCredentialsParams": {},
        "tokenRequestedParams": {}
      }
    },
    "inputFields": {},
    "inboundFieldValues": {}
  }
}
```
The JWT in `authorization` carries `accountId`, `userId`, `platformAppId`, `aud`, `exp`, `shortLivedToken`, `iat`.

### `/actions/sync-events` — happy path (invocation #1)
Key fields only:
```json
{
  "payload": {
    "blockKind": "action",
    "credentialsValues": { "google_credentials": { "accessToken": "ya29..." } },
    "inboundFieldValues": {
      "channelId": "152ce7ec-...",
      "boardId": 1953193772,
      "peopleColumnId": "multiple_person_mkqwq9gz",
      "linkColumnId": "link_mm2dfvy3",
      "itemName": "test event a",
      "item": { "text_mkqwc4p1":"", "date_mkqwkw4q":"2026-04-15T18:00:00+03:00", "numeric_mkqw4pgm":2 },
      "eventId": "24t88ldg9q1mtij8t9sgubdnit",
      "eventStatus": "confirmed"
    },
    "inputFields": "<mirror of inboundFieldValues>",
    "recipeId": 2080334,
    "integrationId": 164533531
  },
  "runtimeMetadata": {
    "actionUuid": "...",
    "triggerUuid": "...",
    "hostMetadata": { "hostInstanceId": "5094669045", "hostType": "app_feature_object" }
  }
}
```
**Note:** monday sends both `inboundFieldValues` AND `inputFields` — they are mirror copies. Our code reads `inboundFieldValues`.

### `/actions/sync-events` — missing mapping (invocation #8)
See Finding 2, Case A above. `eventStatus` key is **absent**.

### `/actions/sync-events` — fallback fire (invocation #3)
See Finding 2, Case B above. `eventId` and `eventStatus` are present as `""`.

### `/webhook/calendar` (Google push)
Body is always empty. Relevant headers:
```
x-goog-channel-id: <uuid>
x-goog-channel-token: <same uuid>
x-goog-resource-id: <google's calendar resource id>
x-goog-resource-state: exists | sync | not_exists
x-goog-message-number: <monotonic int>
x-goog-channel-expiration: <RFC date>
x-goog-resource-uri: https://www.googleapis.com/calendar/v3/calendars/primary/events?alt=json
```

## Open questions / recommended follow-ups

1. **Loud failure for misconfiguration.** Finding 3 confirms silent data loss when the user leaves `eventStatus` unmapped. Option: in the v2-fallback branch, detect "v3 was clearly intended but something key is missing" (e.g. `peopleColumnId` or `linkColumnId` present but `eventStatus` absent) and return an error status + visible message, instead of returning 200/ok.

2. **Orphaned Google channels.** Finding 4 shows 8+ channels still pushing after the test. We should:
   - Add an admin endpoint `/admin/stop-orphans` that iterates `all_active_channels`, attempts `channels.stop()` on each, and purges entries whose accessToken is dead.
   - On unsubscribe, if `channels.stop()` fails with 401/invalid-creds, attempt to refresh the token first (using monday's stored credentials via a fresh server-to-server call) or at minimum log the failure loudly for manual cleanup.

3. **Webhook `x-goog-channel-expiration` is authoritative** — we could use that header instead of the stored `expiration` field when deciding whether to renew, which would eliminate one dependency on SecureStorage for the renewal check.

4. **Subscription-level routing elimination** (from `09-routing-fields-ux-research.md`). Finding 2 confirms the assumption there: `channelId` / `eventId` are just mappings the user has to click through. The recommendation to derive `channelId` from `userId` server-side and drop both from the recipe UI is reinforced by this test.

5. **Mystery invocation #3 (empty-fields fire).** Confirms Case B happens when the webhook's v3 fetch fails (expired token etc.) and the v2 relay fires with only `{channelId}`. Monday fills the other input fields with empty-string/zero defaults. Worth documenting more clearly in `CLAUDE.md` under the v2-fallback path.
