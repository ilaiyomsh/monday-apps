# Column Value Formats — fetch live settings first, then write

**Gate: before ANY column write, fetch the live board's columns — never trust a saved
mapping or a memorized format:**

```graphql
query ($ids: [ID!]) {
  boards(ids: $ids) { columns { id title type settings } }   # settings, NOT settings_str
}
```

Write rules that apply to every column type:
1. `column_values` must be a **JSON-stringified** object: `JSON.stringify({ col_id: value })`.
2. Keys are **column IDs**, never titles. Match columns by id in app config too — titles get
   renamed/translated.
3. All GraphQL IDs (`ID!`) pass as **strings**; ids INSIDE column-value JSON (people ids,
   `item_ids`) are **integers**.
4. Clear a column: `{}` or `null` for JSON columns, `""` for text/number.
5. Unfamiliar type → grep the live schema (scripts/schema.sh) and
   `https://developer.monday.com/api-reference/reference/{type}` BEFORE guessing, then probe
   on a scratch item (scripts/probe.sh).

## Status columns — the deep rules (source of repeated production bugs)

- Read labels via **`settings`** (`settings_str` is deprecated since 2025-10):
  `settings.labels = [{ id, label, color, index, is_done, is_deactivated, hex }]`.
- **`labels[].id` is the only stable reference.** It is monday-assigned and NOT
  sequential/creation-order (real boards yielded ids like 1, 9, 108). Names/colors are
  user-editable; positions are cosmetic.
- **`labels[].id` ≠ `labels[].index`**: `index` is DISPLAY ORDER — a different number. Never
  derive label order from anything but `settings.labels[].index`.
- The column VALUE json `{"index": <n>}` confusingly carries the label **id**, not the
  display index. **id `0` is valid** — use `!= null`, never truthy checks.
- `cv.text` is display-only — never compare/filter against it.
- Write by id: `{"index": <labelId>}` (or `{"label_id": "<id>"}`). Write by text
  `{"label": "..."}` needs the label to exist or `create_labels_if_missing: true`.
- **Creating a status column:** `create_column(..., column_type: status,
  defaults: {"labels":[{"index":N,"label":"...","color":"<name>"}]})` — `defaults` is the
  settings object directly. monday REASSIGNS the real stable ids — read `settings` back
  before building any id-keyed map.
- **Editing labels in place:** `update_status_column(board_id, id, revision, settings:{labels:[...]})`
  — needs the column's current `revision` (optimistic concurrency). Re-send the FULL labels
  array (including deactivated) — a partial send DROPS labels. New label omits `id`. You
  cannot delete a label that is an item's current value or the column default.
- **`index` must be unique across the WHOLE array — deactivated rows included.**
  Incident-verified 2026-07-29 (twyst-your-status 3.9.0, production): `INVALID_INPUT` /
  `errors: ["Indexes should be unique"]`. `color` carries the same rule
  (`"Colors should be unique"`) — **docs-confirmed 2026-07-29**, and the docs give the
  reason: see the colour↔id coupling below. **Neither uniqueness rule is in the SDL** —
  `UpdateStatusLabelInput` only says `index: Int!` is REQUIRED on every row, deactivated
  ones included, which is precisely why an invisible row can collide. They are server-side
  validations you meet as runtime errors. This is the trap that follows from the
  deactivated rows are invisible in any settings UI, so a collision with one is unreachable
  from what the screen shows. Two shapes, each needing only a label removed at some point
  in the past:
  - a new label given `max(active index) + 1` collides with a deactivated row above every
    active one — i.e. the label removed last was the last in the list (observed payload:
    `[0, 1, 2, 2, 3]`);
  - renumbering the actives to `0..n-1` on a reorder collides with a deactivated row inside
    that range — a removed MIDDLE label (`[0, 1, 2, 1]`).
  **Fix pattern:** treat the payload as ONE index space — actives `0..n-1` in display
  order, deactivated packed above them. Rewriting a deactivated row's `index` is safe:
  `index` is display order, and a status CELL references its label by **id** (see the
  `{"index": <labelId>}` quirk below). Same class of bug as the managed-column
  `labels_positions_v2` note at the end of this section. The packing also stays in range
  by construction: `index` is bounded **0–39** and a column holds at most **40** labels
  (`get_column_type_schema(type: status)` → `maxItems: 40`, `index` min 0 / max 39), so
  `0..(total-1)` always fits — and it is strictly tighter than the sparse indexes a
  long-lived column accumulates.
- **`label` is capped at 30 characters** (docs + `get_column_type_schema`). Guard it in the
  UI; there is no truncation on the way in.
- **monday DOCUMENTS that a label's `id` comes from its colour's numeric id at creation** —
  verbatim: "The numeric ID for a color also serves as the label ID when creating labels…
  This means each color can only be used once per status column." Note this is a THIRD
  relation, orthogonal to the `id` vs `index` distinction below: `index` is display
  position, `id` is the stable key, and the claim here is `id` ↔ the **colour enum's own
  number** (0–19, 101–110, 151–160).
  Corroborated: monday's own `update_status_column` example sends `{id: 7, color:
  bright_blue}` and `bright_blue` is 7 — a sequential counter would have produced 3 or 4;
  their `id`-vs-`index` example lists Done/Working/Stuck as ids 1/0/2 at positions 0/1/2,
  exactly the permutation the coupling predicts; and there are exactly 40 colours against a
  40-label cap.
  **PROBE-VERIFIED on the UPDATE path — 2026-07-29** (live board, five discriminating
  probes; the earlier "strong lead, not a contract" hedge was too weak). Adding a label to
  an EXISTING column via `update_status_column` assigns `id` = the numeric id of the colour
  sent, and **rejects the whole mutation when that id is already taken**:
  `INVALID_ARGUMENT_EXCEPTION` / `"request to change default status label color"` — a
  message that names neither the colour nor the id, so it reads as unrelated to the real
  cause. The open question above is answered: monday **errors**, it does not silently reuse.
  The probe series, each run identical but for the new label's colour:

  | new label colour | enum id | label ids already on the column | result |
  |---|---|---|---|
  | `purple` | 4 | 0,1,2,3,7 | accepted → **id 4** |
  | `purple` | 4 | 0,1,2,3,**4**(deactivated),7 | **rejected** |
  | `explosive` | 5 | 0,1,2,3,4,7 | accepted → **id 5** |
  | `blackish` | 10 | 0,1,2,3,4,5,7 | accepted → **id 10** (not the next free id, 6) |
  | `grass_green` | 6 | 0,1,2,3,4,5,7,10 | accepted → **id 6** |

  `blackish` is the decisive one: a next-free-id scheme would have produced 6, so the id
  really does come from the colour. Consequences, now load-bearing rather than conditional:
  - a colour dedupe pass is not cosmetic — it decides the new label's **identity**;
  - pick a new label's colour from the ones whose numeric id is not an existing label `id`,
    **deactivated rows included** — NOT merely "a colour no active label uses". These are
    different questions, and picking on the wrong one is a guaranteed rejection: removing a
    label frees its COLOUR while its ID stays taken, so the freed colour is exactly the one
    a lowest-free-colour picker reaches for next. On a default column (ids 0,1,2 with
    colours 0,1,2) removing any label makes the next add fail every time.
  - the coupling is creation-only: an existing label's colour can be changed afterwards
    (probe-verified — id 4 was moved to `dark_purple`(14) and accepted), so on a long-lived
    column `id` and colour need not agree, and "colour free" ≠ "id free".
  - **id 5 is reserved for the default empty label** and behaves specially: a label created
    there cannot be deleted (`"Unable to delete a label already in use"`, even with no item
    referencing it), and monday overrides its colour to grey `#c4c4c4` regardless of the
    enum sent. It shows up in `labels_positions_v2` without a `labels` entry on a column
    that has never had a label removed — do not read that as evidence of a deletion.
- **Omitting a label from the array DELETES it** (the array is a full replace), and the
  delete is refused with `"Unable to delete a label already in use"` when the label is in
  use. Probe-verified 2026-07-29: deactivated labels CAN be deleted this way, and "in use"
  is broader than "some item's current value" — id 5 (the reserved empty label) refused
  deletion with all four items either empty or pointing at other labels.
- **`is_done` and `description` are write-or-lose.** `UpdateStatusLabelInput` accepts both,
  and a payload that omits them **clears** them: the column's `done_colors` was reset from
  `[1]` to `[]` by a labels mutation that sent only `id/color/label/index/is_deactivated`
  (probe-verified 2026-07-29). Any read-modify-write of labels must carry `is_done` and
  `description` back, or saving an unrelated label edit silently drops the "Done"
  designation and every label description on the column.
- **Colors:** read-time `settings.labels[].color` is a NUMERIC index; write mutations want
  the enum NAME (`done_green`, `working_orange`, `stuck_red`, `dark_blue`, `purple`...). The
  index maps to `StatusColumnColors` introspection order — build the lookup by introspecting
  once, don't hardcode.
- **Account-level "managed" status columns:** board-level label mutations FAIL with
  `INVALID_ARGUMENT_EXCEPTION / notices.column.settings.update.error.structure` even when
  resending identical labels. Use `update_status_managed_column(id: <UUID>, revision: <Int>,
  settings: { labels: [...] })` — its `revision` is an integer from
  `managed_column(id:[uuid]){revision}`, distinct from the board column's revision. There is
  NO API link from a board column to its managed column — detect by matching the board
  column's active label set (sorted `id:label`) against `managed_column(state: active)
  {id settings_json}`; titles are unreliable. `create_labels_if_missing` does NOT work on
  managed columns. A new label's `index` must exceed the max of ALL existing
  `labels_positions_v2` positions (including orphaned ones).
  Verified 2026-07-12 for managed DROPDOWN columns (scratch `create_dropdown_managed_column`
  + `attach_dropdown_managed_column` repro): `create_item` with `create_labels_if_missing:
  true` and a label missing from the managed column fails with `ColumnValueException:
  "The dropdown label 'X' does not exist, possible labels are: {...}"` — the item is NOT
  created. The identical call on a regular dropdown column succeeds and creates the label.
  Through the seamless iframe SDK this surfaces as detail-stripped `"Graphql validation
  errors"` (errors-and-auth.md). The board-level column query shows NO managed indicator
  (`settings`/`settings_str` are byte-shape identical to a regular dropdown) — detection
  only via the account-level `managed_column` query, matching by exact label set.
  `update_dropdown_managed_column` semantics (verified 2026-07-12): `settings.labels` is a
  FULL-REPLACE set — an omitted existing label is a DELETE attempt (blocked with
  `INVALID_INPUT` / "can't delete labels from column model, labels are in use" when in use;
  otherwise it deletes silently) — ALWAYS resend every existing label `{id, label}` plus the
  new one WITHOUT an id (the server assigns max+1). `revision` (Int, starts at 0) must be
  read fresh from `managed_column(id:[uuid]){revision}`; a stale value fails with
  `REVISION_MISMATCH` (409, "Stale item, reload and try again") → re-read and retry.
  A successful update propagates to attached board columns IMMEDIATELY, after which
  `create_item` with the new label works without `create_labels_if_missing`. Only the
  managed column's owners/managers may update it (docs: "select users… that other members
  can't edit"); the required OAuth scope is NOT documented — an app on `boards:write` alone
  should treat a seamless `UNAUTHORIZED_FIELD_OR_TYPE` here as a possible scope gap.

## User photos — root `users(ids:)` photo_url quirk (verified live 2026-07-12)

On the ROOT `users(ids:[...])` query, `photo_url { thumb }` resolves **null** for every
user other than the caller (`me { photo_url }` returns a real URL) — while a NESTED
selection like `teams { users { photo_url { thumb } } }` returns real URLs for the same
users in the same request (verified on 2026-07 and 2026-10). The deprecated flat
`photo_thumb` DOES return URLs on root users through 2026-07 but is **removed from the
schema in 2026-10** — selecting it hard-errors there. Practical rule: when user details
can come from both a team nesting and a root users lookup, prefer the team-resolved
photo; treat root-users `photo_url` as name-only for non-self users.

Also verified 2026-07-12: `@include(if:$b)` on root fields (`teams`, `users`) works —
a gated-off field is entirely absent from `data`; bogus ids in `users(ids:)` are silently
omitted (same as `teams(ids:)`).

## Option-type columns — id, not text (dropdown / people / relation)

Match and filter by the id field, never `text`: dropdown → `ids`; people →
`persons_and_teams[].id`; board_relation → `linked_item_ids`. Real incident: comparing
`.text` to a saved id-string made 3,350 fetched rows match 0 filters, silently.

## Format table (write payloads inside `column_values` JSON)

| Type (`type` value) | Write format | Notes |
|---|---|---|
| status | `{ "index": <labelId> }` / `{ "label": "Done" }` | prefer id; see deep rules above |
| text | `"plain string"` | |
| long_text | `{ "text": "..." }` | |
| numbers | `"42"` | string form is safest |
| date | `{ "date": "YYYY-MM-DD" }` (+ `"time": "HH:MM:SS"`) | |
| timeline | `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` | |
| week | `{ "startDate": "...", "endDate": "..." }` | |
| hour | `{ "hour": N, "minute": N }` | |
| world_clock | `{ "timezone": "Area/City" }` | |
| people | `{ "personsAndTeams": [{ "id": 12345, "kind": "person" }] }` | `kind: "team"` for teams; assignee must be a board member (errors-and-auth.md). **Team assignment needs the TEAM itself subscribed to the board** — `kind:"team"` fails with `ColumnValueException`/`invalidPersonAssignment` ("unable to assign team with id: N") until `add_teams_to_board(board_id, team_ids:[N], kind: subscriber)` is run first (verified live 2026-07-12, sandbox workspace) |
| dropdown | `{ "labels": [".."] }` OR `{ "ids": [".."] }` | never mix labels and ids |
| email | `{ "email": "...", "text": "..." }` | |
| phone | `{ "phone": "+972...", "countryShortName": "IL" }` | |
| link | `{ "url": "...", "text": "..." }` | |
| location | `{ "lat": N, "lng": N, "address": "..." }` | |
| country | `{ "countryCode": "IL", "countryName": "Israel" }` | |
| rating | `{ "rating": 4 }` | |
| checkbox | check: `{ "checked": "true" }` — uncheck: `null` | `{"checked":"false"}` does NOT uncheck (re-verified vs docs 2026-07-02: docs only document null/{} clearing) |
| tags | `{ "tag_ids": [123, 456] }` | |
| board_relation | `{ "item_ids": [123] }` / `{ "linkedPulseIds": [{ "linkedPulseId": 123 }] }` | ints; ignored in create_item; REPLACES the set — see board-relation.md |
| dependency | same as board_relation | |
| color_picker | `{ "color": "#FF5733" }` | |
| file | not settable via column_values — `add_file_to_column` mutation; clear with `{ "clear_all": true }` | verify current shape via schema before use |
| name | via `item_name` argument, not column_values | |

Read-only (never write): auto_number, formula, mirror, creation_log, last_updated, item_id,
vote, button, progress. time_tracking is read-only in most contexts.

## Reading typed values (API 2025-04+)

Legacy `text`/`value` are null on relation-family columns. Read typed fragments:
`... on BoardRelationValue { linked_item_ids }`, `... on MirrorValue { display_value }`,
`... on FormulaValue { display_value }`, `... on PeopleValue { persons_and_teams { id } }`,
`... on CheckboxValue { checked }`, `... on StatusValue { index text }`.

## Mirror columns

- A `sum`-mirror's `display_value` returns the **full comma-separated list of every linked
  source value** (70 numbers for 70 linked logs), NOT a pre-summed number — sum client-side,
  and know the cost scales with linked-row count (scale bomb — see complexity.md for the
  `aggregate` replacement).
- A mirror can only aggregate through a `board_relation` **on the same board** — build the
  relation (with `allowCreateReflectionColumn: true`) before the mirror.

### Verified live 2026-07-29 (API 2026-04, re-checked at 2026-07 — identical)

- **Separator is comma + SPACE (`", "`)**, and it is AMBIGUOUS: a single mirrored value whose
  own text contains `", "` (e.g. `"Gamma, Delta"`) is byte-identical to two values
  `"Gamma"` + `"Delta"`. `display_value.split(', ')` is therefore not a safe parse.
- `display_value` is `String!` → an **empty mirror is `""`, never `null`**. `text` and `value`
  are `null` on `MirrorValue` at both 2026-04 and 2026-07.
- The structured escape hatch (use it whenever you split values or join back to the source):
  ```graphql
  ... on MirrorValue {
    display_value
    mirrored_items {                     # [] when the relation is empty
      linked_board_id
      linked_item { id name }
      mirrored_value { ... on TextValue { id text value } }   # union MirroredValue: one fragment per source column type
    }
  }
  ```
  Measured on a 4-row board: `display_value` alone = 104 complexity; adding
  `mirrored_items { linked_item { id } mirrored_value { text } }` = 112. Cost scales with the
  number of LINKS, not rows.
- **A mirror can NEVER be filtered server-side.** Any `items_page(query_params:)` rule on a
  mirror column — `any_of`, `contains_text`, even `is_empty`/`is_not_empty`, with or without
  `compare_attribute` — fails with HTTP **200** carrying
  `errors[].extensions.code = "InvalidColumnTypeException"`,
  `error_data.actual_type = "lookup"` (monday's internal name for mirror; auto-generated
  mirror column ids are `lookup_*`), `column_id: null`, message
  *"This column type is not supported yet in the API"* — and `data.boards` comes back
  `[null]`, so ONE mirror rule inside an otherwise-valid `and` group destroys the whole
  result set. Identical at 2025-04 / 2026-04 / 2026-07. **Filter mirrors client-side.**
- **Creating a mirror column: `get_column_type_schema(type: mirror)` advertises the WRONG
  shape.** It nests everything under a `settings` key; sending that is rejected with
  `INVALID_INPUT` / `"data/settings must NOT have additional properties"`. The working form
  puts the keys at the TOP level of `defaults`, with `displayed_linked_columns` as an ARRAY
  (the server stores it back as a map):
  ```json
  {"relation_column": {"<relation_col_id>": true},
   "displayed_linked_columns": [{"board_id": "<source_board_id>", "column_ids": ["<src_col_id>"]}]}
  ```
  Passing `defaults` as a JSON **string** (legacy `displayed_column` map form) is accepted with
  HTTP 200 but yields `settings_str: "{}"` — a silently blank, unconfigured mirror. Always read
  `settings_str` back and assert it is non-empty.

## Board / column identity operations

- Rename column keeping id: `change_column_title(board_id, column_id, title)`.
- Rename board: `update_board(board_id, board_attribute: name, new_value)`.
- Create board: `create_board(board_name, board_kind: public, workspace_id, empty: true)`.
- Some system columns (subitems link, parent link) are non-deletable — rename, don't delete.
- Verify a user id before assigning: `users(kind: all) { id name email }`.

## Updates (comments) — HTML that actually round-trips

Verified live (richer than the docs imply): `<h1>-<h3>`, `<p>`, `<strong>`, `<em>`, `<u>`,
`<s>`, color via `<span style="color:…">`, `text-align` on blocks, `<ul>/<ol>` with
`<li><p>…</p></li>` (nested ok), `<a href>`.

**Checklists do NOT round-trip through the API**: posting
`<ul class="checklist"><li class="checklist_task">` via `create_update`/`edit_update` is
silently dropped to an empty `data-checklist-holder` — that markup only works when built in
the in-app editor. API-authored workaround: plain `<ul><li><p>` with a ✔/☐ glyph. Treat
"renders in UI" and "API-writable" as different claims.

## Empty-value READ shapes (probe-verified 2026-07-14, API 2026-07)

An item with never-set columns returns per-type distinct "empty" markers — do not
assume `null` uniformly (probe: deadline-confirm fixtures, WZ- board):

- status (`StatusValue`): `text: null`, `index: null`
- people (`PeopleValue`): `text: ""` (empty STRING, not null)
- date (`DateValue`): `text: ""`, `date: ""` (empty STRING, not null)

So "no deadline" checks must treat `date === ""` as unset, and "no assignee" is
`text === ""`. Also re-verified: `StatusValue.index` carries the label **id**
(write `{"index": <labelId>}` round-trips to the same number).

## date/timeline READ is NOT symmetric with WRITE (probe-verified 2026-07-28, API 2026-04)

Round-tripped through a scratch sandbox board (`WZ-fieldtypes`, board 18424030023):

- **`DateValue.date`/`.time` come back in the ACCOUNT timezone, while the WRITE is
  interpreted as UTC.** Wrote `{"date":"2026-07-27","time":"21:30:00"}` → read back
  `date: "2026-07-28", time: "00:30"` (Asia/Jerusalem, +3). So a read→display path must
  NOT convert UTC→local again (that shifts the offset twice), while a write path MUST
  convert local→UTC, taking BOTH parts from one `toISOString()`. `time` also loses its
  seconds on read (`"00:30"`, not `"00:30:00"`).
- **`TimelineValue.from`/`.to` come back as full ISO timestamps with an offset**
  (`"2026-07-01T00:00:00+00:00"`), NOT `YYYY-MM-DD` — the write format. Slice to 10 chars
  before feeding an `<input type="date">`, which rejects the timestamp form outright.

Both bugs shipped past hand-built unit fixtures and were only caught by the live probe —
this is the concrete case for test-guard's "real fixtures for monday-facing code" rule.

## `items_page` `query_params` filtering — date + people semantics (probe-verified 2026-07-29, API 2026-04)

Probed on a scratch `WZ-report` board with rows at 2026-07-15, 2026-07-20 (×2), 2026-08-01.
**The dominant failure mode is a silent empty page: every malformed rule below returns
`items: []` with NO GraphQL error, so a filter bug is indistinguishable from "no data".**

- **`date` + `between` is INCLUSIVE of both endpoints.** One specific day is
  `compare_value: ["YYYY-MM-DD", "YYYY-MM-DD"]` (the same date twice) — that returns that
  day's items. A range is `[start, end]` and returns rows on `start` and on `end`.
- Silently-zero forms on a date column (all no-error): the one-element
  `compare_value: ["YYYY-MM-DD"]` with `between`; a bare scalar `compare_value: "YYYY-MM-DD"`;
  a reversed range `[end, start]`; a non-ISO format (`"20/07/2026"`); and `operator: any_of`
  with a bare date. A 3+-element `between` array silently ignores the extras.
- Alternative exact-day form that DOES work: `operator: any_of` with
  `compare_value: ["EXACT", "YYYY-MM-DD"]`. `greater_than_or_equals` / `lower_than_or_equal`
  are inclusive and take a one-element array.
- **`people` requires the prefixed string `"person-<userId>"`.** A bare id — as a string
  (`["48274917"]`) or as a JSON number (`[48274917]`) — matches nothing, silently. Teams
  follow `"team-<teamId>"` by the same convention. `is_empty` (with `compare_value: [""]`)
  correctly returns the unassigned rows.
- **`operator: and` is a true conjunction and is the DEFAULT** when `query_params.operator`
  is omitted; `or` yields the union. Verified with `[date between, people any_of]`.
- Server-side filtering is supported on date / people / board_relation and **not at all on
  mirror** (see "Mirror columns" above — hard `InvalidColumnTypeException` inside a 200).

## Option-type `settings` shapes (probe-verified 2026-07-28, API 2026-04)

`Column.settings` is a JSON scalar (there is no `settings_str` on `Column` in 2026-04):

- **status**: `{ labels: [{ id, index, label, color, hex, is_done, is_deactivated }] }`
- **dropdown**: `{ labels: [{ id, label, is_deactivated }] }` — the key is `label`, NOT
  `name`; a `create_column` `defaults` payload written with `name` is normalized to `label`.
- **rating / timeline / people / checkbox / date**: `{}` — EMPTY. Notably a rating column
  exposes no scale, so a consumer must default to 5 stars rather than read a maximum.

## Folders (verified live 2026-08-04, sandbox 16291824)

Provisioning boards into a folder — all three shapes probed end-to-end:

```graphql
mutation ($name: String!, $ws: ID) { create_folder(name: $name, workspace_id: $ws) { id name } }
mutation ($name: String!, $ws: ID, $folder: ID) {
  create_board(board_name: $name, board_kind: public, workspace_id: $ws, folder_id: $folder, empty: true) { id }
}
query ($ws: [ID]) { folders(workspace_ids: $ws, limit: 100) { id name children { id name } } }
```

- `create_board`'s folder argument is **`folder_id`** (not `folder`), type `ID`. A board created
  with it really is returned as a `child` of that folder — confirmed by reading the folder back.
- **`Folder.children` is `[Board]!` and EXCLUDES sub-folders and dashboards** (per the schema
  description). Do not use it to enumerate a folder tree.
- `folders(workspace_ids:)` takes `[ID]` (nullable elements), and **`[null]` does NOT mean "the
  Main Workspace"** — an earlier note here said it did; a live read on 2026-08-04 disproved it.
  `folders(workspace_ids: [null], limit: 5)` came back with folders belonging to an unrelated
  named workspace, i.e. the filter is effectively ignored rather than scoped. Treat an unknown
  workspace as **unknown**: do not query or create a folder until you have a real workspace id
  (read it off a board — `boards(ids:){ workspace { id } }`), or `create_folder` with a null
  `workspace_id` drops the folder somewhere your own code will never find again. `limit` defaults
  to 25 — pass it explicitly when scanning for a folder by name, or an account with many folders
  silently misses the match.
- `boards(ids: [...])` answers a **deleted or inaccessible** board id with an **empty list, not an
  error** — so `data.boards[0]` being absent is a failure to handle, never "the board has no X".
- **`create_folder` needs the `workspaces:write` OAuth SCOPE — `boards:write` does not cover it**
  (monday docs, confirmed 2026-08-04). An app whose manifest lacks it gets an authorization
  error on every folder attempt while every board mutation keeps working, so a
  "create boards inside a folder" flow degrades to loose boards with nothing obviously broken.
  This cost three rounds of chasing app code that was already correct: if folders fail only in
  the app but work from a personal-token probe, suspect the scope FIRST — a probe script runs
  with a full-permission personal token and cannot reproduce it.
- **Adding a scope in the Developer Center does NOT take effect by itself** (official app-versioning
  docs, confirmed 2026-08-05 — a FOURTH "folder still missing" report happened WITH the scope
  already added). Scope edits apply to the **draft version** only; they reach customers when that
  draft is **promoted to live**, and then every installed account must **re-approve** the
  permissions (in-app banner; a fresh install after the promote gets them at install). Until the
  promote, new installs keep getting the OLD live scopes. And a code deploy is NOT a promote:
  `mapps code:push` (this monorepo's whole pipeline) rebuilds the existing live version's bundle
  and never moves the manifest — scope changes ride ONLY on a version promotion. Promotion
  consumes the draft, so re-create one right after (manifest export→import) or the next draft
  deploy fails.
- There is no "create folder if absent" upsert: read `folders` and match by name yourself, or a
  re-run creates a duplicate folder with the same name (monday allows duplicates).
- `delete_folder(folder_id:)` exists and deleting the folder does NOT delete boards implicitly in
  the same call — delete boards first if that is the intent (the probe deleted both explicitly).

## `create_column` `defaults:` for a STATUS column — colours are NOT yours to set (verified live 2026-08-04, sandbox 16291824)

Probed by creating four status columns on a scratch board and reading `settings_str` back.
Two of the four keys you can pass in `defaults` are silently discarded:

| key in `defaults` | honoured? |
|---|---|
| `labels` (`{ "<id>": "<text>" }`) | **yes** |
| `labels_positions_v2` (`{ "<id>": <position> }`) | **yes** — this is the display order |
| `labels_colors` | **NO — silently ignored** |
| `done_colors` | **NO — always written back as `[1]`** |

**A status label's colour is fixed by its label ID**, from monday's own palette. Passing a
`labels_colors` block that disagrees changes nothing, and the response reports the palette
colour, not yours. The palette (ids 0–11, read back from a 12-label probe):

`0` orange `#fdab3d` · `1` green-shadow `#00c875` · `2` red-shadow `#df2f4a` ·
`3` blue-links `#007eb5` · `4` purple `#9d50dd` · `5` grey `#c4c4c4` ·
`6` grass-green `#037f4c` · `7` bright-blue `#579bfc` · `8` mustered `#cab641` ·
`9` yellow `#ffcb00` · `10` soft-black `#333333` · `11` dark-red `#bb3354` ·
`12` dark-pink `#ff007f` · `13` light-pink `#ff5ac4` · `14` dark-purple `#784bd1` ·
`15` lime-green `#9cd326` · `16` turquoise `#66ccff` · `17` trolley-grey `#757575` ·
`18` brown `#7f5347` · `19` dark-orange `#ff6d3b` (12–19 read back from a 16-label probe,
verified live 2026-08-05, sandbox 16291824)

- **Label id `5` is monday's default grey, and it CAN be given a text at creation**
  (`labels: {"5": "טרם החל"}` round-trips, keeps `grey #c4c4c4`, verified live 2026-08-05).
  An EMPTY cell is still *no value* — monday never auto-assigns id 5 — so an app that wants
  the grey label to read as the empty state must render id 5's text for empty values itself.

Consequences to design around:

- **To choose colours, choose label IDs.** Ids and positions are independent, so
  `labels: {2:'דחופה', 0:'גבוהה', 9:'בינונית', 5:'נמוכה'}` with
  `labels_positions_v2: {2:0, 0:1, 9:2, 5:3}` yields red/orange/yellow/grey in that display
  order. (Used by `PRIORITY_DEFAULTS` in `apps/discussions/.../provisionBoards.js`.)
- **A `labels_colors` block that happens to match the palette is a no-op that LOOKS like it
  works.** `STATUS_DEFAULTS` in the same file is exactly that — its ids already line up with
  the palette, so nobody noticed the key was inert. Don't cite it as proof the key works.
- **`done_colors` cannot be suppressed.** It always comes back `[1]`, marking label id 1 as
  the done label. If "done" is meaningless for the column (a priority, a category), SKIP id 1
  when numbering the labels: the done marker then points at a nonexistent label and is inert.
  Otherwise put the genuinely-done label on id 1 — which is green anyway.
- Label ids need not be contiguous and need not start at 0; non-contiguous sets round-trip
  fine (the response re-sorts the keys numerically, which is cosmetic).
