# Twyst Your Status — validation manifest

## Existing Status Column contract

- App ID: `11775054`
- Column feature type: `AppFeatureStatusColumn`
- Settings feature type: column settings placement
- Client-only CDN app (no monday-code server)
- Feature URLs (configure on the draft/live version):
  - On-click dialog: `<CDN_ORIGIN>/picker`
  - Column settings (tiny shell): `<CDN_ORIGIN>/settings`
  - Full settings overlay (opened from the shell via `openAppFeatureModal`):
    `<CDN_ORIGIN>/settings-full`

Do **not** bind an On-Hover Dialog to `/picker` — hover dialogs close when the
pointer leaves the cell, which feels like the picker vanishing while choosing.

## Dialog Design size (On-Click → `/picker`)

Configure in Developer Center → feature → Dialog Design → Custom size:

| | |
|---|---|
| Width | `200` |
| Height | `250` |

`250` fits **exactly 6** status pills with no scrollbar
(`8+8` padding + `6×34` pills + `5×6` gaps). More than 6 labels scroll inside
the menu. See `src/utils/pickerDialogSize.js`.

## Product rules

- Configuration is stored in global `monday.storage` under
  `twystStatus:<boardId>:<columnId>`.
- Per **target label id**: optional `allowedUserIds` / `allowedTeamIds` and
  `requiredColumnIds`. Missing rule or empty allowlists ⇒ everyone may pick.
- Actor is allowed when their user id matches **or** they belong to an allowed team.
- Optional per-label **people-column gate** (`requiredPeopleColumnIds`): the actor must
  appear on that people column of the same item as a person, **or** belong to a team
  listed on that column. Empty ⇒ no extra gate. Combines with allowlists as AND.
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
