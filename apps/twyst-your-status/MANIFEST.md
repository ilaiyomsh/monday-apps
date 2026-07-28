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
  - Required-fields fill form (opened from the picker via `openAppFeatureModal`):
    `<CDN_ORIGIN>/required-fields` — **no Developer Center entry**, opened at runtime

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

**This size is fixed and cannot be changed at runtime** — monday-sdk-js 0.5.9 has no
dialog-resize command (checked against its `execute` types). That is why the
required-fields form does not live in this iframe: a form wider than 200px opens as
its own modal, sized per transition — see below.

## Required-fields modal size (`/required-fields`)

Computed by `src/utils/requiredFormModalSize.js` from the fields the transition
demands, and passed to `openAppFeatureModal` as pixel strings:

- **2-column grid**, at most **4 rows** tall; past that the grid scrolls inside the
  modal rather than the modal growing off-screen.
- A single field gets a 1-column modal, so it is not half empty.
- `date` (day + hour) and `timeline` (from + to) render two inputs each, so they
  **span the whole row** and cost two grid cells. Row counting is per grid CELL, not
  per field.
- The grid's column count reaches the CSS through the `--twyst-form-cols` custom
  property, so layout and modal size come from one computation. **The pixel constants
  in that module and the row/gap/padding values in `OnClickDialog.css` must match** —
  drift shows up as a clipped form or dead space.
- The picker itself only measures: it reads the required columns' types (a light
  `GET_STATUS_COLUMN_SETTINGS` call), sizes the modal, and hands over
  `boardId`/`columnId`/`itemId`/`labelId` through the SDK's `urlParams`. The modal is
  a separate iframe and shares no memory with it — see `src/utils/modalHandoffParams.js`.

## Boot loading state — one spinner, monday's

monday paints its own spinner in the Dialog container while our iframe loads. The
app must **continue** that spinner, never answer it with a loader of its own: a
second loader starts its animation from 0 and reads as a jump.

- The spinner is static markup + inline CSS in `index.html`, a sibling of `#root`
  — so it paints on the first frame, before the bundle is fetched, and survives
  `createRoot()` (which wipes its container).
- It is a hand copy of `@vibe/core`'s `Loader`, `dark` variant, 40px. **Re-sync by
  hand if Vibe's Loader changes** — it is not imported.
- Removal is the only operation: `src/utils/bootLoader.js`. App releases it on any
  non-picker route or a context error; `OnClickDialog` releases it once settings
  AND board data have arrived; the error boundary and a 15s timer in `index.jsx`
  are backstops so a failure can never leave a dialog spinning forever.
- The picker therefore renders **nothing** while loading. Do not reintroduce a
  skeleton or a `<Loader>` there — that was the jump (removed in 3.3.0).

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
- Selecting a label with required fields always opens the fill form (even when
  filled) as a sized modal on `/required-fields`; submit writes the form columns and
  the status together via `change_multiple_column_values`, then closes the modal.
  The **hour part of a date field is optional** — only the day is required, so a
  user who skips the time never fails the transition.
- **Which column types may be a required field is decided in ONE place:**
  `src/domain/columnFields.js`. Each supported type has a record carrying its form
  control, its typed GraphQL read fragment, read/write conversion, and its own
  "still empty?" rule. Adding a type = adding a record (plus a control branch in
  `OnClickDialog/FieldControl.jsx` only if the control does not exist yet); nothing
  else in the app enumerates column types, and the settings checklist enables every
  registered type automatically.
  Supported: `text`, `long_text`, `numbers`, `date` (with optional time), `email`,
  `phone`, `link`, `dropdown`, `people`, `checkbox`, `timeline`, `rating`, `status`.
  Types monday cannot write through `column_values` (`formula`, `mirror`, `file`,
  `auto_number`, `creation_log`, `button`, `progress`, …) stay unselectable by design.
- Required-field enforcement is **ours, not the browser's** — the `required` attribute
  cannot express "this checkbox must be checked" or "this picker must hold an entry",
  so emptiness is judged per type by the registry and pinned by
  `OnClickDialog/requiredFieldsForm.test.jsx`. Rating 0 and a half-entered timeline
  count as empty; status label id **0** counts as filled.
- A required column that was deleted from the board (or whose type is unwritable)
  **fails closed**: the transition is blocked with a message pointing at the settings,
  rather than silently skipping a governed field.
- A single unusable field value never fails the whole transition: the payload passes
  through `sanitizeColumnValues`, which omits the junk column so the status still
  writes (monday rejects the entire mutation on one bad column).
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
