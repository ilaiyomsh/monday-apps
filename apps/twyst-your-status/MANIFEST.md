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
- Unconfigured column (no storage value) ⇒ empty rules: **all active statuses are allowed**.
- Settings can also edit the board status labels themselves (rename / recolor / add /
  deactivate) via `update_status_column`, in addition to per-label permissions.

## Required scopes

Configure on the **draft** app version (Developer Center → Version → Permissions),
then reinstall / reauthorize existing installs:

- `boards:read`
- `boards:write`
- `users:read`
- `teams:read` — required for team allowlists and actor team membership

Without `teams:read`, settings still loads (users-only) and shows a warning; team
pickers stay disabled until the scope is granted.

## Limits

Protection applies only inside this app's picker. Direct board edits, API writes,
and automations are not blocked (no server webhook/rollback).
