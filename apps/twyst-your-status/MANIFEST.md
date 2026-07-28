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

The form follows monday's own item form: a LIST of rows, one field per row, each row
the column's coloured icon and title in a fixed label column beside a wide control
column. Not a grid.

Size is computed by `src/utils/requiredFormModalSize.js` and passed to
`openAppFeatureModal` as pixel strings:

- **Width is constant** (`520px`) — it is the label+control layout, not the field
  count.
- **Height follows the rows**: one row per field, at most **8 visible** (`FORM_MAX_ROWS`,
  raised from 4 in 3.6.0); past that the LIST scrolls and the modal keeps its opened
  height.
- **What actually pins the title and the actions is `grid-template-rows: minmax(0, 1fr)`
  on `.twyst-required-fields-modal`** — do not let that become an implicit `auto` row.
  An `auto` row is sized by its CONTENT, and `align-content: stretch` only distributes
  space that is LEFT OVER; it never takes space away. So a form taller than the iframe
  grew past the box and the whole thing scrolled, header and footer included, and the
  `overflow: hidden` beside it clipped the submit button out of reach instead. A zero
  minimum lets the row shrink to the window it was actually given, which hands the
  overflow down to `.twyst-form`'s `1fr` middle row and `.twyst-form-rows` — the only box
  in this modal permitted to scroll (fixed in 3.6.1; 3.6.0 claimed this and did not do it).
- **Never sized below `FORM_MIN_ROWS` (2).** One required column sized to one row opened a
  sliver barely taller than the picker that launched it. The floor is applied in
  `requiredFormModalSize` only — `requiredFormLayout` keeps reporting the real row count,
  so the list renders one row and the spare height falls below it. Do not move the floor
  into the layout function: the form would render a phantom row.
- **The height we ASK for is not the height we GET.** monday draws its own modal chrome
  inside the box, and rows can render a pixel over budget, so `MODAL_CHROME_PX` (24) is
  flat headroom on the request. The CSS above is the guarantee; this constant only keeps
  a form that fits from scrolling at all.
- The row height, gaps, paddings and the two column widths in that module MUST match
  `OnClickDialog.css`. Drift shows up as a clipped form or dead space. `FIELD_ROW_HEIGHT_PX`
  is 40 against a real 36px row (4px of tolerance); it was 48, and those 12 spare pixels
  per row were the visible dead space above the footer.
- Label icons come from the registry (`icon` + `iconTone` per type) and are resolved
  to `@vibe/icons` components in `OnClickDialog/FieldIcon.jsx`. **monday exposes
  neither its column icons nor their colours through the API** — the palette is our
  approximation of its look.
- The icon and the field name sit on ONE line. Do not add a bare `.twyst-form label`
  rule: one existed with `display: grid` and outranked `.twyst-field-title`, stacking the
  contents vertically, tripling row heights and clipping the footer out of a
  correctly-sized modal (fixed in 3.5.1). There is no required asterisk any more (3.6.0) —
  every field in this form is required by definition.
- **An option popover must fit the iframe it opens in.** The modal is sized to the form to
  the pixel, so a menu taller than that window gets clamped to `viewport - 16`, flipped and
  pinned 8px from the top — it covers the trigger and every row, which reads as "the list
  opened somewhere else". `OPTION_POPOVER_HEIGHT_PX` (220) is what keeps status/dropdown
  menus beside their field; `Popover` now also caps its RENDERED height to the `height` it
  was placed for, instead of letting the stylesheet's 430px overflow the placement math.
- **Every option-based control is a single field-height bar** that opens a popover —
  date, status and dropdown all share `.twyst-field-trigger`. Options are never
  rendered inline: a row of chips spills across the row and stops the field reading
  like the fields around it, and a column with many labels would blow the row height.
  A chosen status paints its bar the label's colour, like a monday cell.
- The picker itself only measures: it reads the required columns' types (a light
  `GET_STATUS_COLUMN_SETTINGS` call), sizes the modal, and hands over
  `boardId`/`columnId`/`itemId`/`labelId` through the SDK's `urlParams`. The modal is
  a separate iframe and shares no memory with it — see `src/utils/modalHandoffParams.js`.

### The date field

The hour is set **inside** the date popover (`OnClickDialog/DateFieldControl.jsx`),
never as a second input beside the day — and it stays **optional**, so a date with no
hour is a complete answer. The clock button reveals the hour row; switching it off
CLEARS the hour rather than hiding a value that would still be written. Calendar math
is pure and tested in `src/domain/monthGrid.js` (weeks run Sunday→Saturday, and local
getters are used throughout — `toISOString()` would return the UTC day and shift it).

### Closing

After a successful write the modal closes ITSELF, and first asks monday to close the
picker dialog behind it (best-effort: a no-op if monday does not let a child modal
close its parent). The picker deliberately does NOT await `openAppFeatureModal` — that
promise resolves only when the modal closes, and awaiting it pinned the clicked pill
on "שומר…" for the whole time the form was open.

## Boot loading state — one spinner, monday's

monday paints its own spinner in the Dialog container while our iframe loads. The
app must **continue** that spinner, never answer it with a loader of its own: a
second loader starts its animation from 0 and reads as a jump.

- The spinner is static markup + inline CSS in `index.html`, a sibling of `#root`
  — so it paints on the first frame, before the bundle is fetched, and survives
  `createRoot()` (which wipes its container).
- It is a hand copy of `@vibe/core`'s `Loader`, `dark` variant, 40px. **Re-sync by
  hand if Vibe's Loader changes** — it is not imported.
- Removal is the only operation: `src/utils/bootLoader.js`. App releases it on any route
  that does not own it, or on a context error; **`OnClickDialog` (the picker) and
  `RequiredFieldsModal` both own it** — each releases it once its own data has arrived.
  The required-fields modal is its own iframe, so it serves this same `index.html` and
  gets the same spinner for free (3.6.0); it used to drop the overlay immediately and
  draw a Vibe `Loader` with "טוען שדות חובה…" instead. The error boundary and a 15s timer
  in `index.jsx` are backstops so a failure can never leave a dialog spinning forever.
- Both surfaces therefore render **nothing** while loading. Do not reintroduce a
  skeleton or a `<Loader>` there — that was the jump (removed in 3.3.0), and
  `bootHandoff.test.jsx` fails on any `טוען`/`Loading` text reaching the picker.

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
- **Closing rules (owner decision, 3.6.1).** A menu closes when the choice is COMPLETE:
  single-select (status, a single-link `board_relation`) closes on the pick; the date
  picker closes on a day click when the hour toggle is off and stays open when it is on,
  because the time input is the rest of the answer; **multi-select (dropdown, people,
  multi-link `board_relation`) closes on click-outside only** — closing after each pick
  would make choosing two values two round trips. A surface with a save button closes
  itself on a SUCCESSFUL save (the fill form and the settings screen both do).
- **No success toast for a status change**, in the picker or after the fill form — the
  cell shows the result and the surface closing is the confirmation. Failures do notify.
- Selecting a label with NO required fields closes the picker as soon as the write lands.
  The write is awaited, not fired and forgotten: `closeDialog` tears the iframe down and
  cancels a request still in flight, which would close the dialog on a status that was
  never written. The pill's spinner covers the round trip.
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
  `phone`, `link`, `dropdown`, `people`, `checkbox`, `timeline`, `rating`, `status`,
  `board_relation`.
  Types monday cannot write through `column_values` (`formula`, `mirror`, `file`,
  `auto_number`, `creation_log`, `button`, `progress`, …) stay unselectable by design.
  monday's item **name** column is filtered out of the settings checklist entirely
  (`ColumnSettings.formColumns`, 3.6.0) — it used to sit there greyed out, offering to
  make the item's own title a required field.
- **`board_relation` (connected boards)** reads the board(s) the column points at from
  its own `settings.boardIds` and offers their items in a searchable menu. Single vs
  multi follows the column's `allowMultipleItems`, and an ABSENT setting means single:
  writing two ids to a single-link column is a `ColumnValueException`, while offering one
  pick on a multi-link column is merely restrictive. Candidates are one `items_page` page
  of 500, fetched lazily on FIRST OPEN (a relation field must not slow the form that is
  blocking the transition) and filtered client-side — monday cannot server-filter a
  relation's candidates by anything but item name. When the page is full the control says
  so instead of showing a silent prefix. Only the FORWARD side of a relation pair is
  writable and which side a column is on is not derivable from its settings, so a
  reflection column marked required fails at save time with monday's own message
  (`monday-api` references/board-relation.md Rule 4).
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
