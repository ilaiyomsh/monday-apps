# Webhooks

<!-- Verified via ask_developer_docs (live docs corpus) on 2026-07-02. -->

## create_webhook (scope: `webhooks:write`)

```graphql
mutation {
  create_webhook(
    board_id: 1234567890,
    url: "https://example.com/webhook",          # max 255 chars
    event: change_status_column_value,
    config: "{\"columnId\":\"status\", \"columnValue\":{\"$any$\":true}}"
  ) { id board_id }
}
```

For subitem events pass the PARENT board id. `config` is a JSON string (like column_values).

Main event types: `create_item`, `change_column_value`, `change_status_column_value`,
`change_specific_column_value`, `item_archived`, `item_deleted`, `item_restored`,
`item_moved_to_any_group`, `item_moved_to_specific_group`, `create_subitem`,
`change_subitem_column_value`, `subitem_archived`, `subitem_deleted`, `create_update`,
`edit_update`, `delete_update`, `create_column`. Verify the current enum in the live schema
(`scripts/schema.sh`, grep `WebhookEventType`) before using anything not listed here.

Config examples:

| Event | config |
|---|---|
| `change_specific_column_value` | `{"columnId": "column_id"}` |
| `change_status_column_value` | `{"columnId": "column_id", "columnValue": {"index": <labelId>}}` (or `{"columnId": "column_id", "columnValue": {"$any$": true}}` for any label) |
| `item_moved_to_specific_group` | `{"groupId": "group_id"}` |

**GOTCHA — `change_status_column_value` requires BOTH keys (verified live 2026-08-05, api 2026-04).**
A config of `{"columnId": "..."}` ALONE is rejected: `create_webhook` returns a soft error
`"This config for this event is invalid"` (`InvalidWebhookConfigException`, `status_code: 200`)
inside a 200 body — so an API funnel that throws on soft errors surfaces it as a 5xx, not a 4xx.
The `columnValue` key is mandatory; use `{"$any$": true}` to fire on every new label for the
column (what a per-column guard wants). `change_specific_column_value` is the one that takes
`{"columnId": "..."}` alone — do not swap their config shapes. `{"$any$": true}` bare (no
`columnId`) is NOT accepted for `change_status_column_value` in this API version.

## Challenge handshake — registration fails without it

On registration monday POSTs `{"challenge": "<random>"}` to the URL; the endpoint must echo
the identical JSON back:

```js
app.post('/webhook', (req, res) => {
  if (req.body.challenge) return res.json({ challenge: req.body.challenge });
  // ... handle the event, then res.sendStatus(200)
});
```

## Verifying authenticity (JWT)

Webhook requests created via an integration app's OAuth token carry a **JWT in the
`Authorization` header** — verify it against the app's **Signing Secret**
(`MONDAY_SIGNING_SECRET`). The JWT payload includes `accountId`, `userId`, `aud` (your
endpoint URL), `exp`, and a `shortLivedToken` usable for API calls. App *lifecycle* webhooks
are signed with the **Client Secret** instead — two different secrets, don't mix them up.
Webhooks created with a personal token have no app to sign for — treat the endpoint as
public and validate payloads defensively.

## delete / list

```graphql
mutation { delete_webhook(id: 12) { id board_id } }
query { webhooks(board_id: 1234567890) { id event config } }
```

## Retry policy

Board webhooks retry **once per minute for 30 minutes** when the endpoint fails/times out —
make handlers idempotent (dedupe by event id/timestamp) or a 30-minute outage becomes up to
30 duplicate deliveries. Integration-app custom action URLs also retry ~30 minutes unless
you return a `4xx` (or a severity code) — return 4xx for permanent failures to stop retries.

## Testing

Probe webhook flows only against WZ- scratch boards in the sandbox workspace
(TEST_WORKSPACE_ID — see SKILL.md TEST step), with a tunnel (`mapps tunnel:create`) for the
local endpoint. Delete the webhook AND the scratch board when done.
