# Twyst Your Status — validation manifest

## Existing Status Column contract

- App ID: `11775054`
- Column feature type: `AppFeatureStatusColumn`
- Settings feature type: column settings placement
- Since round324 (same-origin unification) the SPA is served BY the app's
  monday-code server (`server/public`), so every feature URL is on `<BASE_URL>`
  (the monday-code URL from `mapps code:status`), not the CDN. One deploy, one
  origin — see `docs/GUARD-ACTIVATION.md` and `CHANGELOG.md`.
- Feature URLs (configure on the draft/live version):
  - On-click dialog: `<BASE_URL>/picker`
  - Column settings (tiny shell): `<BASE_URL>/settings`
  - Full settings overlay (opened from the shell via `openAppFeatureModal`):
    `<BASE_URL>/settings-full`
  - Required-fields fill form (opened from the picker via `openAppFeatureModal`):
    `<BASE_URL>/required-fields` — **no Developer Center entry**, opened at runtime

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

- **Width is constant** (`658px` since 3.9.0, was `526`) — it is the label+control
  layout, not the field count. The 3.9.0 widening (+25%, owner request) went ENTIRELY to
  the label column (`150 → 282`); `CONTROL_COLUMN_WIDTH_PX` stays 320 because the fields
  themselves must not change width. `RequiredFieldsForm` passes `LABEL_COLUMN_WIDTH_PX`
  to the row grid as the `--twyst-label-column-width` custom property, so the stylesheet
  holds no second copy of the number — a hard-coded `150px` there would open a wider
  modal with the labels still laid out narrow, which is the whole point of the change.
- **The modal's close X belongs to monday and cannot be moved or hidden.**
  `openAppFeatureModal` accepts only `url`/`urlPath`/`urlParams`/`width`/`height`
  (monday-sdk-js 0.5.9), and the X is in monday's DOM around the iframe. An app can only
  draw its OWN close control inside its iframe, which leaves monday's in place as well —
  asked for in 3.9.0 (move it to the left, for RTL) and declined on that basis by the
  owner. See `mapps/references/known-issues.md`.
- **Height follows the rows**: one row per field, at most **8 visible** (`FORM_MAX_ROWS`,
  raised from 4 in 3.6.0); past that the LIST scrolls and the modal keeps its opened
  height.
- **The ancestors decide whether ANY of this works.** The route must render the
  `is-modal` shell modifier (`App.shellModifier`), because `index.css` hangs the whole
  constraint off it: no `.app-shell` padding, and `height: 100%` + `overflow: hidden` on
  `html`, `body`, `#root` and the shell. Without it the modal was `100dvh` inside a shell
  adding `padding: 20px`, so the DOCUMENT scrolled 40px and carried the title and the
  submit button with it — while the field list, the only box meant to scroll, did not.
  `overflow: hidden` on the modal is powerless against a scroll happening above it, which
  is why 3.6.0 and 3.6.1 both "fixed" this and did not. **The diagnostic that identifies
  it:** the overflow is a CONSTANT 40px at 1, 3, 8 and 14 fields — two 20px paddings, not
  content. Anything content-driven grows with the row count. Measure in a real browser at
  `requiredFormModalSize`'s own pixel size and read `documentElement.scrollHeight -
  clientHeight`; it must be 0, and `.twyst-form-rows` must be the box that scrolls.
- **Sized `block-size: 100%`, never a viewport unit.** `100dvh` measures the iframe and
  ignores every ancestor in between, which is exactly how the shell's padding got added on
  top of a box already as tall as the window. `requiredFormModalSize` budgets ONE padding
  box (`FORM_PADDING_PX`) and this element owns it — no ancestor may add another.
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

### What the picker waits for (3.8.0)

The picker's boot is three pieces of work, and only the first is sequential: App
resolves the monday context, then `OnClickDialog` reads its column settings from
storage **while** it fetches the board's labels and the item's values. The two run
in **parallel**.

- **Why that is safe:** the request's column set is `[columnId, …people columns
  named by a gate]`, and settings can only ever **widen** it. `useColumnSettings`
  seeds from `swrCache` synchronously during the first render, so on a warm open —
  the common one, since the iframe is destroyed on every close — the gate columns
  are already known before the first `await`. It was **not** safe to simply not
  wait: the fix is that the fetch is keyed on `columnIdsKey`, so widening the set
  re-issues the request rather than silently asking for too little.
- **Settings still gate the PAINT, only not the fetch.** `buildAvailableLabels`
  filters by `hiddenLabelIds` and the allowlists, and the people gate **fails
  closed** — so painting on board data alone would show labels the user may not
  pick and then take them away. Board data arriving first is now the normal case,
  and it must paint nothing.
- **Cost:** one round trip on a warm open (it was two — see 3.8.0 in CHANGELOG.md).
  The one regression is the first open of a **gated** column on a cold cache: two
  requests instead of one, same wall clock, because the gate columns are only known
  once storage answers.
- **A superseded run must write nothing** (`runIdRef` in `OnClickDialog`). The
  narrow first run landing after the wider second one would overwrite the gate data
  with a map missing that column — labels vanish, fail-closed — and pin the loaded
  key to a stale value with no effect left to fire: a permanently blank dialog with
  the overlay already down. Pinned by `pickerRequestPhases.test.jsx`.

## Who may configure — the column's OWNERS (round322; board-owner gate is the fallback)

Owner decision (round322): each column carries its OWN owner list. The settings shell
(`/settings`) offers its button only to a listed **column owner**; everyone else sees
`רק בעלי העמודה יכולים לנהל את ההגדרות` and is not exposed to the settings at all.

- **The gate is `services/settingsAccess.loadSettingsAccess`.** It reads the column's
  stored `owners` (`domain/columnOwners`): an ADOPTED column (owners present) admits only
  its listed owners; an UNADOPTED column (legacy blob / never configured) falls back to
  the legacy **board-owner** gate below, so the board's owners can do — and, by saving,
  CLAIM — the first setup. The first configurer becomes owner #1 and the PRIMARY owner
  (`bootstrapOwners`), seeded into the draft the moment the screen opens.
- **The PRIMARY owner is the guard's revert identity.** `owners.primaryOwnerId` is the
  user a guard revert is written AS (see Limits / docs/GUARD-ACTIVATION.md). Owner-list
  edits go through the pure mutations `addOwner`/`removeOwner`/`setPrimaryOwner`, which hold
  the invariants: always exactly one primary, never left owner-less, crown moves only by an
  explicit act. `migrateSettings` carries `owners` only when present, so every pre-round322
  blob keeps its exact 3-key shape (18 suites toEqual it).

### Legacy board-owner gate (fallback for unadopted columns)

The decision is one pure function, `src/domain/boardOwnerAccess.js`, fed by
`src/services/boardOwnerGate.js`.

- **An owner is a user owner OR a member of an owning TEAM.** `boards { owners { id } }`
  answers the first; monday also lets a board be owned by teams (`team_owners`), and a
  board whose ownership is held by a team has no user owners at all — checking only
  `owners`, as axis-tracker's `useBoardOwner` does, locks those owners out entirely.
- **A direct user owner costs ONE request.** `team_owners` + the actor's own teams are
  fetched only when the actor is not already a user owner, so the common case (an owner
  opening their own board's settings) does not pay for the team path. Pinned by a test.
- **`owners` is asked ALONE, without `team_owners`.** monday rejects a whole query when one
  field is out of scope, so folding the teams:read field into that query would mean a
  missing scope locks out EVERY owner rather than only the team-owned ones. `owner`
  (singular) is deprecated and returned the creator — never use it here.
- **No new scopes**: `boards:read`, `users:read` and `teams:read` were already required.
  Without `teams:read` the gate degrades to user owners only (logged), exactly as the
  team allowlists do.
- **Fails closed, but a broken check is NOT a denial.** No owners at all ⇒ nobody gets the
  button (deliberately the inverse of the per-label rules below, where an empty allowlist
  means "everyone"). A failed request or a missing `boardId`/`userId` shows a Hebrew error
  instead of the English owners-only line — a network fault reported as a permission
  verdict tells a real owner they have no rights and hides the fault.
- While the check runs the shell renders the SAME `LoadingState` its Suspense fallback
  shows, so the two are one continuous wait. Do not let a button render before the answer
  arrives: a button that appears and then vanishes is worse than a slightly longer wait.
- The gate is on the LAUNCHER, so `/settings-full` has no path a non-owner can reach. It
  is not a server-side guard — see Limits.

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
- **Neither surface closes until the status write is CONFIRMED** (3.9.0). The write is
  awaited, not fired and forgotten — `closeDialog` tears the iframe down and cancels a
  request still in flight, which would close the dialog on a status that was never
  written — and the response is then checked: both mutations select the status column
  back (`... on StatusValue { index label }`, where `index` is the label **id**), and
  `domain/statusWriteResult.js` throws when the echo names a different label or when no
  item came back at all. `change_column_value: null` inside a 200 with no `errors` is a
  real shape that a bare `await` reads as success. The picker keeps its pill spinner and
  the fill form keeps a spinner on its save button for the whole round trip.
  **An UNREADABLE echo is deliberately accepted** (logged, not thrown): if an API version
  stops returning the fragment, failing closed would put an error on every successful
  transition in the app. Pinned by `OnClickDialog/statusWriteClose.test.jsx`.
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
- **`update_status_column` indexes are ONE unique space across the whole payload** (3.9.1).
  The mutation replaces the full labels array, deactivated rows included, and monday
  rejects it with `INVALID_INPUT` / "Indexes should be unique" on any duplicate. Actives
  take 0..n-1 in display order; deactivated rows are packed above them. Two collisions were
  live before this, both needing only a previously removed label — invisible in the settings
  UI, so neither is reachable from what the screen shows: a new label took
  `max(active index) + 1` (collides with a removed LAST label), and a reorder renumbered
  actives to 0..n-1 (collides with a removed MIDDLE label). Rewriting a deactivated row's
  index is safe — `index` is display order, while a cell references its label by **id**.
- **A new label's `id` IS its colour's numeric id, and a taken id rejects the mutation**
  (3.10.0, probe-verified live). `update_status_column` derives a created label's id from
  the `StatusColumnColors` value sent — `purple`(4) becomes id 4 — and refuses the whole
  payload with `INVALID_ARGUMENT_EXCEPTION` / "request to change default status label
  color" when that id already exists, deactivated rows included. So choosing a colour for
  a new label is an identity decision, and two questions must both come out clean: is the
  colour free, and is the colour's own id free as a label id. They differ, because
  removing a label frees its COLOUR and keeps its ID — which is why a lowest-free-colour
  picker reached for precisely the colliding colour and made "add label" fail on any
  column that had ever had one removed. `pickColorForNewLabel` answers both.
  - **`id 5` is monday's reserved slot for the default empty label.** A label created
    there is forced grey `#c4c4c4` and can never be deleted ("Unable to delete a label
    already in use", with no item referencing it). It is excluded from the picker.
  - The coupling is creation-only: recolouring an EXISTING label away from its id is
    accepted, so on a long-lived column `id` and colour need not agree.
- **Labels are created on the "add label" CLICK, not on save** (3.10.0). Because monday
  decides both the id and — sometimes — the colour, an optimistically rendered row showed
  something the board disagreed with: purple in settings, grey on the board, orange on the
  next visit (grey is the id-5 override; orange is the enum re-derived from the stored
  colour index). The click now does the round trip behind a busy button and renders the
  card from the response, and the swatch shows the hex monday STORED rather than one
  re-derived from the enum. Consequence: the label exists from that moment, so Cancel no
  longer un-creates it.
  - This retired 3.9.0's client-key remap (`resolveNewLabelIds` / `remapDraftLabelKeys`)
    entirely: a card carries a real monday id before its permissions accordion is ever
    opened, so rules are keyed correctly from the first keystroke and there is no remap
    left to fail. The requirement it protected — configure a new label without leaving the
    screen — is still pinned by `ColumnSettings/newLabelPermissions.test.jsx`.
- **`is_done` and `description` must be RESENT or they are cleared** (3.10.0). The labels
  array is a full replace, so a payload omitting them wiped the column's `done_colors`
  (observed going from `[1]` to `[]` on a live board) and every label description —
  meaning renaming one label silently dropped the "Done" designation. Both now round trip
  read → draft → payload → mutation.
- **Omitting a label from the array DELETES it**, refused with "Unable to delete a label
  already in use". Deactivated rows can be deleted this way; the reserved id 5 cannot.

## Required scopes

Configure on the **draft** app version (Developer Center → Version → Permissions),
then reinstall / reauthorize existing installs:

- `boards:read`
- `boards:write`
- `users:read`
- `teams:read` — required for team allowlists, actor team membership, and the board's
  own TEAM owners (the settings gate above)

Without `teams:read`, settings still loads (users-only) and shows a warning; team
pickers stay disabled until the scope is granted, and the owner gate recognises user
owners only — an owner who holds the board through a team would not see the button.

## Limits

Client-side protection applies only inside this app's picker — but since round322
the app also carries a **guard server** (monday-code component of this same App ID,
`server/`): a `change_status_column_value` webhook per enrolled column re-validates
every change — whoever made it, from whatever surface, including the cold-load
window before the app feature binds — against the SAME rules (the bundle inlines
`src/domain/`), and REVERTS an illegal change to its previous value with a
notification to the acting user (owner copy, pinned in code:
"השינוי שבוצע בוטל - מכיוון שאינו עומד בהגדרות העמודה"). The revert is written AS the
column's PRIMARY OWNER (monday attributes a write to the token's user, so the revert
needs that owner's token — the primary owner authorizes once, no bot/service identity;
if they have not authorized, the guard logs and does NOT revert, fail-open and
loop-safe). **Auto-revert is OPT-IN (round323): `settings.autoRevert` gates it, default
off = MONITORING ONLY.** Every detected bypass is RECORDED to a per-column audit log
regardless; the revert only fires when the owner turned auto-revert on. The settings
screen carries an owners-only **bypass monitor** (count by week/month/year/custom, with
per-event drill-down: when, item, who, and the specific rule broken) so owners decide on
the number. Source labelling is honest — the webhook's `app` field splits API from a
native editor, and nothing finer (mobile vs the cold-load window are indistinguishable).
Endpoint `GET /api/guard/bypasses` (owner-auth) feeds it; `src/domain/reportingPeriod.js`
+ `bypassReason.js` + `services/bypassMonitor.js` are the tested pieces. Correction, not
prevention: the illegal value is visible until the revert lands, a guard outage
means no enforcement (fail-open), and creation-time values (forms/duplicate/
import) emit no change event — out of v1 scope by owner decision. Activation and
enrollment: docs/GUARD-ACTIVATION.md; architecture record:
docs/BYPASS-PROOF-DECISION.md. Note the guard ENFORCES hiddenLabelIds too —
supersedes the older "automation/API may still set them" contract for enrolled
columns.

The owner's authorization uses monday's **OAuth 2.1 (New OAuth Flow)** — PKCE S256,
expiring access tokens, single-use rotating refresh tokens with automatic single-flight
refresh; a dead grant flags `reauth_required` (server/src/services/monday-oauth-client.js
+ the refresh-aware token store in stores.js). The account reader (`:token:default`) is a
POINTER to an owner, not a token copy, so rotation is never burned by a stale duplicate.
The guard server also ships WARN/ERROR to Axiom via the vendored error-kit stack
(helpers/axiomServerSink.js + process-guards.js, drift-locked), gated on the `AXIOM_*`
secrets (fail-soft: no secrets → nothing ships, logs stay on `mapps code:logs`).

The owner gate is still a client-side gate: it withholds the UI, it does not defend
the storage key — anyone able to call monday's storage API with this app's context
could still write the configuration. The guard server narrows the blast radius (its
ENROLL endpoint verifies board ownership server-side), but rules storage itself is
still client-writable; moving rules to server-authoritative storage is the recorded
next hardening step in docs/BYPASS-PROOF-DECISION.md.
