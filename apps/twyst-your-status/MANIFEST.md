# Twyst Your Status — validation manifest

## Existing Status Column contract

- App ID: `11775054`
- Column feature type: `AppFeatureStatusColumn`
- Settings feature type: column settings placement
- Client-only CDN app (no monday-code server)
- Feature URLs (configure on the draft/live version):
  - On-click dialog: `<CDN_ORIGIN>/picker`
  - Column settings: `<CDN_ORIGIN>/settings`

## Product rules

- Configuration is stored in global `monday.storage` under
  `twystStatus:<boardId>:<columnId>`.
- Per **target label id**: optional `allowedUserIds` / `allowedTeamIds` and
  `requiredColumnIds`. Missing rule or empty allowlists ⇒ everyone may pick.
- Actor is allowed when their user id matches **or** they belong to an allowed team.
- `hiddenLabelIds` are omitted from the picker only; automation/API may still set them.
  A hidden current value remains visible as read-only.
- Selecting a label with required fields always opens a fill form (even when filled);
  submit writes the form columns and the status together via
  `change_multiple_column_values`.
- Unconfigured column (no storage value) shows **"העמודה לא הוגדרה"** in the picker.

## Required scopes

- `boards:read`
- `boards:write`
- `users:read`
- `teams:read`

## Limits

Protection applies only inside this app's picker. Direct board edits, API writes,
and automations are not blocked (no server webhook/rollback).
