# Changelog

## 3.9.0

Three owner-reported items from the live 3.8.0 app.

- **A label created in settings can now be opened and configured in the same visit.**
  The permissions accordion was rendered only for labels that already had a monday id
  — `showPermissions={!label.isNew}` — because the settings are keyed BY that id and a
  new label has none until `update_status_column` has run. So restricting a new label
  took two visits (save, re-open, configure), and nothing on the card said why it had
  an identity row and nothing else. The accordion is now there from the moment the
  label is added: its rules are held under the draft's client key (`new:1`) and moved
  onto the id monday assigns, in the same save.
- The re-key never GUESSES. Candidates are what the post-mutation refresh has that the
  pre-mutation labels did not (a set difference, so a pre-existing label can never be
  claimed), matched on the two things we sent — the label text and the index. A draft
  that matches neither stays unresolved, because attaching one status's permissions to
  another is worse than losing them: the rules are then dropped by the prune and the
  screen says so (`הלייבל נוצר, אך ההרשאות של הלייבל החדש לא נשמרו`) instead of closing
  on configuration that went nowhere.
- **Fixed a duplicate-label hazard the new flow would have made easy to hit.** After the
  labels mutation, the label draft is re-seeded from the refresh. It was not, so any
  save that failed AFTER the mutation (a storage error, the unsupported-column check)
  left the new labels still marked `isNew` — and the retry created them a second time.
  Pre-existing, reachable in 3.8.0 by hitting a validation error, now pinned by a test.
- **The required-fields form is 25% wider (526 → 658px), and every added pixel went to
  the column names.** The control column keeps its 320px — the fields themselves must
  not change — so the label column went 150 → 282px, where a longer Hebrew column title
  used to be ellipsised after roughly a dozen characters. The row grid takes that width
  from the same constant the modal is sized with (passed down as a custom property)
  rather than the stylesheet holding a second copy of the number: with a hard-coded
  `150px` the modal would have opened wider with the labels still laid out narrow.
- **The modal's X could not be moved to the left, and that is a platform limit, not a
  decision.** monday draws the modal chrome itself; `openAppFeatureModal` takes only
  `url`/`urlPath`/`urlParams`/`width`/`height` (monday-sdk-js 0.5.9), and the X lives in
  monday's DOM outside our iframe. The only alternative — drawing our own X inside the
  form — leaves monday's in place too, so on the owner's call nothing was added.
  Recorded in the mapps skill's `references/known-issues.md`.
- **Neither surface closes until the status has actually changed.** Awaiting the write
  before closing has been the behaviour since 3.6.1; what is new is that "the request
  came back" is no longer accepted as "the status changed". Both mutations now echo the
  status column back (`StatusValue.index` carries the label id), and the echo is checked
  before the picker or the form closes: a different label, or `change_column_value: null`
  inside a 200 with no `errors`, keeps the surface open and shows the failure. The fill
  form's save button also carries a spinner now — it stays open for the whole round trip,
  and a disabled button with only its text changed reads as a click that did nothing.
- An unreadable echo is deliberately NOT a failure. If an API version stops returning the
  fragment, treating absence as a mismatch would put an error on every successful
  transition in the app; the mutation returning without errors is monday's own answer and
  it is kept (and logged).

## 3.8.0

- **A warm picker open now costs ONE monday round trip instead of two, and no longer
  flashes.** The second round trip was not a redundant fetch someone forgot to remove —
  it was `migrateSettings` building a fresh object on every storage read. The
  stale-while-revalidate read that confirmed *nothing had changed* still handed down a
  new object identity, `OnClickDialog` keys its board fetch on that object, so the whole
  `Promise.all` ran again. And because the boot overlay is released the moment the first
  result paints, the dialog went **blank for the length of the second round trip** before
  repainting the exact same pills. That flash was shipped behaviour, on the most common
  interaction in the app. The hook now compares content before publishing.
- **The board request no longer waits for the storage read.** It was gated on
  `if (settingsLoading) return`, so every open paid storage-then-network in series. It
  never had to: the request asks for `[the status column, ...people columns named by a
  gate]`, settings can only ever *widen* that set, and the settings hook seeds from its
  local cache synchronously during the first render — so on a warm open the gate columns
  are already known before the first `await`. The fetch is now keyed on the column set, so
  widening it re-issues the request instead of silently asking for too little.
- **An unconfigured column stopped sleeping for a second.** `monday.storage` transiently
  answers `success:true` + `value:null` for a key that *is* populated, so a single null
  read cannot be trusted — and both `mondayService` and `useColumnSettings` were retrying
  it. Stacked, that cost **4 storage reads and 1050 ms** to conclude "nobody configured
  this column", on every open, since an unconfigured column is never cached. The retry now
  has one owner: **2 reads, 350 ms**. `apps/team-people-column`, which this app was copied
  from, has always done it that way; twyst grew the second retry and kept the copied one.
- **`@vibe/core` left the picker's critical chunk: 114.06 kB → 66.16 kB gzip (−42%)**
  (raw 377.23 → 203.06 kB), re-parsed on every iframe boot. Three imports held the whole
  `Button → Tooltip → Dialog → popper` and `Icon → react-inlinesvg` chain, for components
  a successful open never renders — and one of them, an `AttentionBox` in `OnClickDialog`,
  sat after an early `return` on the same condition and could never render at all. Vibe is
  now its own chunk (47.66 kB gzip) fetched only by the lazy settings and required-fields
  routes. Measured by sourcemap attribution on a real `vite build`, not estimated: zero
  `@vibe/core` sources in the eager chunk.
- Measured request counts on a real picker open, not reasoned about: **4 GraphQL calls → 1**
  on a warm open, and **4 `storage.getItem` → 2** on an unconfigured column. The one
  regression is the first open of a *gated* column on a cold cache — two requests instead
  of one, same wall clock, because the gate columns are only known once storage answers.
- Wrong theory this replaces: the latency was read as "too many separate requests, fix it
  by prefetching on the board page and batching every item". There is nowhere to hang that
  — this is a client-only `AppFeatureStatusColumn`, **no app code runs on the board page**,
  and the `/picker` iframe is created on the cell click and destroyed on close. And one
  round trip is the floor, not zero: the picker removes the item's *current* status from the
  options, and the current value is not in the monday context, so painting from cache would
  reorder the pill list under the cursor in a 200×250 dialog.
- A theme fix that came along: `ErrorState`'s Tailwind `text-red-500` / `text-gray-700`
  were fixed light-mode greys, so that screen was unreadable in monday's dark themes. Now
  `--negative-color` / `--secondary-text-color`.
- CI gained an **eager-import guard** (`scripts/lib/eager-graph.mjs`), deliberately an
  invariant rather than a size budget — a byte threshold measures a symptom, needs the
  build to evaluate, and only ever ratchets upward. It walks the static import graph from
  the entry, stops at `import()` (that is how a heavy dependency is *supposed* to be
  reached), and fails if a forbidden package is reachable eagerly.

## 3.7.1

- **The required-fields form's title and submit button are now actually fixed, at any
  number of required columns.** 3.6.0 claimed this and 3.6.1 claimed to have fixed the
  claim; both were looking in the wrong place. Everything inside
  `.twyst-required-fields-modal` was already correct — the `minmax(0, 1fr)` row, the
  `overflow: hidden`, the field list as the only scrolling box. The box that was
  scrolling sat two levels ABOVE it: `.app-shell` adds `padding: 20px` and, on this
  route, nothing in the chain (`html`, `body`, `#root`, the shell) had a height or
  `overflow: hidden`. So the modal filled the viewport with `100dvh`, the shell's
  padding pushed 40px past it, and `body` — which carries only `min-height` — grew
  rather than clipping. The DOCUMENT scrolled, taking the header and the button along,
  and `overflow: hidden` on the modal could do nothing about a scroll happening
  outside it.
- The tell was that the overflow measured a **constant 40px at every field count** —
  1, 3, 8 and 14 required columns all overflowed by exactly the shell's two 20px
  paddings. A content-driven overflow would have grown with the rows. Measured in a
  real browser at the exact pixel size the app asks monday for, not reasoned about:
  with 8 fields the document scrolled 40px while the field list did not scroll at all,
  and the submit button sat flush on the viewport's bottom edge with its own padding
  below the fold.
- The required-fields route now carries an `is-modal` shell modifier, and that class
  gets the same treatment the picker has always had: no shell padding, and
  `height: 100%` + `overflow: hidden` on `html`, `body`, `#root` and the shell.
  `requiredFormModalSize` budgets exactly ONE padding box (`FORM_PADDING_PX`) and the
  modal is the element that owns it, so the shell must contribute none.
- `.twyst-required-fields-modal` is sized `block-size: 100%` instead of `100dvh`.
  A viewport unit measures the iframe and silently ignores every ancestor between,
  which is what let the shell's padding be added on top of a box already as tall as
  the window. It also degrades better: with no definite parent height a percentage
  falls back to content height, where a viewport unit overflows.
- After the fix the document scrolls **0px** at 1, 3, 8 and 14 fields; the button
  keeps its 20px of padding, the header sits at one padding box rather than two, and
  past the 8-row cap the field LIST scrolls while the document still does not.

## 3.7.0

- **The settings button is now for board owners only.** The slim shell behind the column's
  settings placement asks who the actor is before it offers to configure anything; a
  non-owner gets a one-line statement, `Only board owners can configure`, where the button
  used to be. Same gate as axis-tracker's (`useBoardOwner`), applied to this app's settings
  shell.
- **Ownership includes the board's OWNING TEAMS, not just its user owners.** tracker
  compares the actor against `boards { owners { id } }` alone; on a shared board the
  ownership is often held by a team instead, and that check locks a genuine owner out. So
  `team_owners` is resolved against the actor's own team membership too. It costs nothing in
  the common case: a direct user owner is answered in ONE request, and the two team lookups
  are only sent for an actor who is not already a user owner. No new scope — `boards:read`,
  `users:read` and `teams:read` were all declared already.
- **A check that could not run is not a denial.** Where tracker quietly resolves a failed
  ownership query to "not an owner", a failure here says so in Hebrew and withholds the
  button: reporting a network error as a permission verdict tells a real owner they have no
  rights, and buries the actual fault while doing it. The one sanctioned narrowing is a
  missing `teams:read`, which degrades to user owners only rather than failing — it is
  already how this app treats that scope everywhere else.
- The gate fails CLOSED in every other direction, which is deliberately the inverse of the
  per-label rules next door: an empty `allowedUserIds` means "everyone may pick that
  status", but a board with no owners at all hands the settings button to nobody.
- While the check is in flight the shell keeps showing the SAME loading state its Suspense
  fallback was already showing, so the wait is continuous instead of one spinner replaced
  by another — and no button appears and then vanishes.

## 3.6.1

- **The title and the save button no longer scroll with the fields.** 3.6.0 claimed to
  pin them and did not: the form sat in the modal's single implicit grid row, which is
  sized by its CONTENT, and `align-content: stretch` only hands out space that is left
  over — never takes it away. So the moment the form wanted more height than the iframe
  had, the row grew past the box and the whole form scrolled as one piece. Worse, the
  `overflow: hidden` added in 3.6.0 then clipped the submit button instead, meaning it
  could not be reached at all. The row is now `minmax(0, 1fr)`, so it shrinks to the
  window it actually got and the field list is the only thing that scrolls.
- The requested modal height carries a flat 24px of headroom. monday draws its own modal
  chrome inside the box it hands us and a row can render a pixel over budget, so sizing
  the form to fit exactly was a few pixels short in practice — and those few pixels were
  what put the header and footer into the scroll in the first place. One flat allowance,
  not per row, so it costs no visible dead space.
- **Choosing a status with no required fields closes the picker as soon as the write
  lands, with no toast.** The write is still awaited rather than fired and forgotten:
  `closeDialog` tears the iframe down, and a request still in flight when that happens
  is cancelled by the browser — the dialog would close on a status that was never
  written, with nothing to say so. The spinner on the clicked pill covers the round trip.
- **No success toast for a status change**, in the picker or after the required-fields
  form. The cell already shows the result and the dialog closing is the confirmation.
  Failures still speak.
- **A single required column no longer opens a sliver.** The modal is never sized below
  two rows (`FORM_MIN_ROWS`), so one field still opens as a form rather than as a title, a
  box and a button squeezed together. The floor is a sizing concern only —
  `requiredFormLayout` still reports the real row count, so the list renders one row and
  the spare height falls below it.
- The date picker's "היום" shortcut now closes the popover like a day click does — when
  the hour toggle is off. It used to set the date and leave the popover open, so the same
  action behaved two different ways. The typed date input deliberately still does not
  close: it fires on every keystroke.

## 3.6.0

- **Connected-board (`board_relation`) columns can now be required fields.** The control
  reads the linked board off the column's own `settings.boardIds` and offers its items in
  a searchable menu, single- or multi-select according to the column's
  `allowMultipleItems`. An absent setting means single, deliberately: writing two ids to a
  single-link column is a `ColumnValueException`, while offering one pick on a column that
  would have taken several is merely restrictive. Candidates are one page of 500 fetched on
  first open, not on form load — a relation field must not slow down the form that is
  blocking the user's transition — and when that page is full the menu says so rather than
  showing a silent prefix. The write format, the read fragment and the empty-clear path
  were all verified live against the sandbox, not copied on faith.
- The item **NAME** column is gone from the required-fields checklist in settings. It was
  listed but greyed out, which amounted to offering to make an item's own title a required
  field.
- **The modal now grows to fit up to 8 fields** instead of 4, and past that only the field
  LIST scrolls: the title stays at the top and the button stays at the bottom. Previously a
  form taller than the window scrolled the page and took the header and footer with it.
- Removed the dead space above the footer. The height budget reserved 48px for a row that
  actually renders at 36 — 12 wasted pixels per field, which at the new 8-row cap would
  have been a 96px hole.
- **Clicking a status label no longer replaces its text with "שומר…"** — the pill keeps its
  own label and shows a small spinner instead. The text swap hid the very thing the user
  had just clicked.
- The required-fields modal reuses the picker's loader: monday's black spinner, continued
  from `index.html`, with no text. Being its own iframe it was already painting that
  spinner and then throwing it away to draw a second, differently-styled loader with
  "טוען שדות חובה…" underneath.
- The submit button is a blue **"שמור"**. It was white because the only blue
  `.primary-action` rule was scoped to `.status-guard-dialog`, and the fill form renders
  under `.twyst-required-fields-modal` — so the rule never matched.
- The form header is one title, "עמודות חובה". The "מעבר סטטוס" eyebrow and the
  "השלמת פרטים לפני מעבר ל״X״" heading are gone, which also gave the row list 24px back.
- Removed the cancel button and the red asterisks. The modal's X is the way out, and an
  asterisk on every row of a form where every field is required carried no information.
- A status label with no text renders with no text, everywhere — the "ללא שם" stand-in is
  gone. The save notice is now just "הסטטוס עודכן בהצלחה"; it used to interpolate the label
  name, which read as `ל״״` for an unnamed label.
- **Fixed option menus opening detached from their field.** Three separate causes: the menu
  asked for 320px of height inside an iframe as short as 216px, so it was clamped, flipped
  and pinned to the top edge, covering the field it belonged to; the popover kept its last
  position on close and painted one frame at the old coordinates on reopen; and its
  rendered height came from the stylesheet (430px) rather than the height the placement
  math had reserved. Also made the whole bar one click target — a click that landed on the
  label text or the chevron was a click on a child of the button.

## 3.5.1

- Fixed the field label breaking onto three lines. A leftover
  `.twyst-form label { display: grid }` rule from the pre-3.4.0 form OUTRANKED
  `.twyst-field-title` (0,1,1 vs 0,1,0), so the icon, the name and the asterisk
  stacked vertically. That tripled every row's height, which in turn made the modal
  scroll and clipped the footer buttons — the computed height was right, the rendered
  rows were not. Icon, name and asterisk now sit on one line as intended.
- Status and dropdown fields are a single field-height bar that opens its options in
  a popover, instead of rendering every option as an inline chip. A row of chips
  spilled across the row and made a status field look nothing like the fields above
  it; a column with a dozen labels now costs the same one row as a text field. A
  chosen status paints the bar its own label colour, like a monday cell.
- Removed the dead chip CSS the inline options used.

## 3.5.0

- The required-fields form now follows monday's own item form: a LIST of rows, one
  field per row, with the column's coloured icon and title in a label column beside a
  wide control column. The 2-column grid from 3.4.0 is gone. Modal width is constant;
  only the height follows the rows, still capped at 4 visible with the list scrolling
  past that.
- The hour of a date field is set INSIDE the date picker — a popover with "היום", a
  clock toggle and a month grid — instead of a separate time input beside the day. It
  stays optional: a date with no hour is a complete answer, and switching the clock
  off CLEARS the hour rather than keeping a hidden value that would still be written.
- The picker no longer sits on "שומר…" while the form is open. `openAppFeatureModal`
  resolves only when the modal CLOSES, and awaiting it pinned the clicked pill for the
  whole time — that was the stuck dialog visible behind the modal.
- After a successful write the modal closes itself and asks monday to close the picker
  dialog behind it, so nothing is left over on screen.

## 3.4.0

- Required fields now support far more column types. `people`, `checkbox`,
  `timeline`, `rating`, another `status` column, and `date` with an optional hour
  can all be marked required, alongside the text/number/contact types that already
  worked. `dropdown` was fixed: it used to write from a free-text box (a typo
  failed the write or invented a label) and now offers the column's real labels.
- Which types are allowed is decided in ONE place — `src/domain/columnFields.js`.
  Each type carries its form control, typed GraphQL read fragment, read/write
  conversion, and its own "still empty?" rule, so adding a type is one record and
  the settings checklist picks it up automatically. Types monday cannot write
  through `column_values` (formula, mirror, file, …) stay unselectable by design.
- Required-field enforcement moved off the browser's `required` attribute, which
  cannot express "this checkbox must be checked" or "this picker must hold an
  entry". Emptiness is now judged per type: rating 0 and a half-entered timeline
  count as empty, status label id `0` counts as filled, and the hour part of a date
  is optional so skipping it never fails the transition.
- The fill form opens as its own modal on `/required-fields`, sized from the fields
  it shows: a 2-column grid, at most 4 rows, scrolling past that. `date` and
  `timeline` span the full row because each renders two inputs. The picker's own
  dialog is fixed at 200×250 by the Developer Center and the SDK has no runtime
  resize, so the form could not stay there.
- A single unusable value no longer fails the whole transition: the payload passes
  through a sanitizer that omits the junk column, since monday rejects the entire
  mutation on one bad column. A required column deleted from the board fails closed
  — the transition is blocked with a message pointing at the settings.
- Fixed two read bugs a live probe caught: monday returns `DateValue` in the
  ACCOUNT timezone while the write is UTC (the app was converting twice), and
  `TimelineValue` arrives as full ISO timestamps, not `YYYY-MM-DD`.

## 3.3.0

- Picker boot is now a single continuous spinner. monday shows a black spinner in
  the Dialog while the iframe loads; the app used to answer it with a shimmer
  skeleton, so the user saw monday's spinner, then a blank frame, then bars —
  a visible jump. The app now continues monday's spinner instead: a pixel copy of
  `@vibe/core`'s `Loader` (`dark`, 40px), inline in `index.html` so it paints on
  the first frame with no request of its own, and held as the SAME DOM node for
  the whole boot so its rotation never restarts.
- Held across every boot phase — monday context, column settings, board data —
  and released only when the picker has real content, or an error to show.
  Backstops: the error boundary and a 15s timer, so nothing can leave a dialog
  spinning forever.
- Removed the shimmer skeleton added in 3.2.9 (`StatusPickerSkeleton`) and its CSS.

## 3.2.9

- Picker shows a monday-style shimmer skeleton (6 label-sized bars, no loading
  copy) from the first paint while context/labels load.
- Document Dialog Design size: width `200`, height `250` (fits 6 pills, no scroll).

## 3.2.8

- Settings: teams join the people picker (no separate checklist); each label
  accordion starts closed; required-columns list collapsed by default; people-
  column gate uses a custom dropdown matching the settings chrome.

## 3.2.7

- Settings UI redesign (Vercel-style clarity): soft canvas, compact label rows,
  capped field widths, checkbox lists instead of stretched multi-selects,
  collapsible permissions, and ↑/↓ reorder.

## 3.2.6

- Per-label people-column gate: pick a People column; only actors who appear on
  that column (as a person or via a team listed there) may select the label.
  Combines with user/team allowlists as AND.

## 3.2.5

- Settings overlay ignores the tiny column-settings iframe size (root cause of
  the postcard modal). Uses the physical screen at ≥80%, floored at the
  known-good `1100×820`.

## 3.2.4

- Settings overlay opens at ≥80% of the viewport (min 720×560, capped at 94%
  on tiny screens) — no more postcard-sized `744px` dialog.

## 3.2.3

- Revert status picker to the cell-attached Dialog Design (no centered
  `openAppFeatureModal`). The previous hand-off looked wrong next to the board.
  Bind only On-Click to `/picker` — not On-Hover — so the popover stays open
  while choosing.

## 3.2.2

- Fix settings load crash: User photos query uses `photo_thumb` (API 2026-04).
  `photo_url { thumb }` is only available from 2026-07 and was rejected by GraphQL.

## 3.2.1

- Status picker no longer closes when the mouse moves: the column Dialog Design
  shell immediately opens a stable `openAppFeatureModal` (`/picker-full`) so the
  label list stays open until a choice or an intentional dismiss.

## 3.2.0

- Settings UI cleaned up to match discussions: header + scroll body + footer,
  Vibe ColorPicker (circle) and PersonPicker, no subheadings or help prose.
- Full-settings overlay size is viewport-relative (`min(744px, 94vw/vh)`), not
  a fixed 1100×820.

## 3.1.5

- Picker no longer lists the currently selected status (or shows it as a header
  chip) — only other allowed labels appear for switching.

## 3.1.4

- Fix settings save failing with monday `Colors should be unique` on
  `update_status_column`: payloads now force unique StatusColumnColors across
  active + deactivated labels (active colors stay; collisions are remapped), and
  new labels pick the first unused color instead of always `done_green`.

## 3.1.3

- Picker labels stretch edge-to-edge inside the monday Dialog Design iframe
  (removed the 20px app-shell padding and width cap that left side gaps).

## 3.1.2

- Picker UI matches discussions' monday-native status label menu: full-width
  colored pills with white centered text (same look as TaskTableRow statusMenu).

## 3.1.1

- Column settings shell is now a single button that opens a full-size nested
  overlay (`openAppFeatureModal` → `/settings-full`) for label editing and
  permissions — the native settings iframe stays minimal.

## 3.1.0

- Default when no settings are saved: **all active statuses are allowed** (removed the
  "העמודה לא הוגדרה" picker gate).
- Settings now edit board status labels in place — rename, recolor, add, and deactivate —
  via `update_status_column` (same pattern as day-off), alongside per-label permissions.

## 3.0.0

- Rewrote the app as a **client-only** Status Column surface (CDN), matching the
  `team-people-column` architecture — no monday-code server, OAuth, or webhooks.
- Routing is pathname-based: `/picker` (on-click) and `/settings` (column settings).
- Settings persist in global monday storage (`twystStatus:boardId:columnId`) with
  per-target-label allowlists (users or teams) and required board columns.
- The picker hides unauthorized and hidden labels; missing storage means open allowlists.
  Selecting a label with required fields always opens a fill form before writing
  status + columns together.

## 2.1.0

- Added governed Status workflows with transition permissions, required fields,
  protected labels, rollback enforcement, notifications, and per-item audit history
  (server-side path; superseded by 3.0.0 client-only rewrite).
