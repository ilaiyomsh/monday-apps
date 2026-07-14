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
