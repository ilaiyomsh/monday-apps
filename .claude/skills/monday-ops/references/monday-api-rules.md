# DEPRECATED — GraphQL correctness rules moved to the `monday-api` skill

**Do not read this file for API guidance and do not extend it.** The GraphQL
correctness content below (status labels, board_relation/mirror, column CRUD, batching)
is being absorbed into the canonical references of the **`monday-api`** skill:

> `.claude/skills/monday-api/references/` (sibling `monday-api` skill, same skills root)

For anything API-shaped — column value JSON formats, status/label rules, pagination,
complexity, error codes — invoke `/monday-api` and use its references. Provisioning-
specific semantics (people/permission preflights, settings-import rules, app wiring
contracts) live in the monday-ops `SKILL.md` procedures.

This file is kept temporarily so nothing breaks while the migration completes.

---

## LEGACY CONTENT BELOW — do not extend

# monday.com provisioning rules (learned the hard way)

The non-obvious rules `provision.py` encodes. Read before changing the engine or doing
manual API surgery. API version pinned to **2026-04** (the bundled `mapps-api.sh` default).

## API access

```bash
./mapps-api.sh '<graphql>' ['<variables-json>'] [api-version]
```
Reads the token from `~/.config/mapps/.mappsrc` internally — **never** read that file or
paste a token into the conversation. Scope every call to the authorized workspace only.

## Status columns — the core rule

- **Read labels via `settings`, NOT `settings_str`** (`settings_str` deprecated since 2025-10):
  `columns { id title type settings revision }` → `settings.labels = [{id,label,color,index,...}]`.
- **Reference labels by their `id`, never by positional `index`.** monday assigns its own stable
  ids — asking to create index 0,1 commonly yields ids 1,2. Every app config map (Tracker
  `eventTypeMapping`, `projectActiveStatusValues`, Planner `absenceTypeAbsentValues`, …) keys by
  **label id**. So: create labels → **read back `settings`** → build mappings from the real ids.
- Create a status column: `create_column(... column_type: status, defaults: <JSON>)` where defaults
  is the settings object **directly, no `settings` wrapper**:
  `{"labels":[{"index":0,"label":"פרויקט","color":"done_green"},...]}`.
- Edit labels in place: `update_status_column(board_id, id, revision, settings:{labels:[...]})`
  (settings input type `UpdateStatusColumnSettingsInput`). You **cannot delete** a label that is
  an item value or the column default.
- Writing a value: by id → `{"index": <labelId>}`; by text → needs `create_labels_if_missing: true`.

## board_relation & mirror

- `board_relation` defaults:
  `{"boardIds":[<int>],"allowMultipleItems":false,"allowCreateReflectionColumn":true}`.
  Set `allowCreateReflectionColumn:true` when a **mirror on the OTHER board** must aggregate
  across the link (e.g. Allocations.reportedHours summing Time Logs.duration).
- A **mirror** can only aggregate a column reachable through a board_relation **on the same board**.
  Build the relation (with reflection) BEFORE the mirror that depends on it.
- Set a relation value: `{"linkedPulseIds":[{"linkedPulseId": <int itemId>}]}` (writing) or read
  `... on BoardRelationValue { linked_item_ids }`.

## Boards & columns

- Create board: `create_board(board_name, board_kind: public, workspace_id, empty: true)`.
- Rename board: `update_board(board_id, board_attribute: name, new_value)`.
- Rename a column (keeps id): `change_column_title(board_id, column_id, title)`.
- **Apps match columns by id, never by title** → renaming/Hebraizing never breaks an app.
- Non-deletable system columns exist (subitems link, parent link) — rename, don't delete.

## App wiring contracts

- **Allocations is the hinge** in assignments mode: the SAME columns serve Planner (write) and
  Tracker (read). people col = Planner `employeeColumnId` + Tracker `assignmentPersonColumnId`;
  project relation = Planner `projectColumnId` + Tracker `assignmentProjectLinkColumnId`.
- **Tracker validation gotcha:** `settingsValidator` blocks ("נדרש עדכון הגדרות") if ANY configured
  column id no longer exists on the reporting board. Null out unused/stale keys (e.g.
  `nonBillableStatusColumnId: null` when there's no routine column).
- **JSON import MERGES** into existing settings — include every key that must change explicitly.
- Planner matches allocation person ↔ employee by **linked monday user**: allocation people,
  employee linked-users, and report reporters must all be the same real users, or availability=0.
- `roleColumnId` (Planner) must be a **text** column — Planner writes a raw string.
- Absence values are **label ids** (`absenceTypeAbsentValues` = the Time Logs "daily" label id).

## People & permissions

- Verify a user's exact id before assigning: `users(kind: all){ id name email }`.
- A person can only be assigned to a board they're a member of — grant board ownership/membership
  first, or people-column writes fail with `invalidPersonAssignment`.

## Batching

- Batch create/update with aliased mutations, ~10–15 per request, to stay under complexity limits:
  `mutation($b:ID!,$n0:String!,$cv0:JSON!,...){ r0:create_item(...){id} r1:create_item(...){id} }`.

## Quirk (2026-07-19, scale-seed run #3): `users(kind: all)` returns unassignable users
`enabled: true, is_guest: false` users can STILL fail people-column writes with
`invalidPersonAssignment` — pending invitees (`is_pending: true`) and view-only
users (`is_view_only: true`) pass the naive filter, and board subscription (P3)
does not make them assignable. Rules: (1) filter `is_pending`/`is_view_only`
when building an assignee pool; (2) for bulk seeding, PROBE-validate each
candidate with one real assignment on a scratch item before writing thousands
of rows (see seed-scale.py `probe_assignable`).
