---
name: monday-ops
description: General monday.com platform-ops — build, inspect, seed, and validate any workspace's board system, with the Axis Planner/Tracker blueprints as a labeled preset. Use for provisioning/demo setup ("הקמה", "דמו", "להקים דמו"), data seeding ("לזרוע נתונים"), board/workspace building, app-settings generation or import, schema-drift checks on saved settings files, and end-to-end app test setup. Also answers the legacy /monday-provision command (this skill replaced monday-provision).
argument-hint: [demo-or-system-name]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, Glob, Grep
---

# monday-ops — Platform Operations (build / inspect / seed / validate)

You run **structured operations against a monday.com workspace**: build a board system
from a blueprint, inspect what already exists, generate and validate app settings, seed
demo data, and script-verify the result. The flow is always:

> **guided interview → live discovery → dry-run plan → gated apply → scripted post-apply validation**

The bundled blueprints are the **"Axis Planner/Tracker" preset** (Portfolio + Time Logs +
Allocations + Employees). The blueprint format is generic — new products get new
blueprint files, not new code.

## Toolbox

| File | Role |
|---|---|
| `.claude/skills/mapps/mapps-api.sh` (under the project root — sibling `mapps` skill) | the **only** sanctioned API path (canonical, owned by the `mapps` skill — this skill bundles **no** copy; token stays out of context) |
| `blueprints/boards.json` | declarative model of every board + column (Axis preset) |
| `blueprints/structures.json` | system-structure presets + options (Axis preset) |
| `scripts/provision.py` | build engine: create/map boards, read back label ids, render settings, write `state.json` **incrementally** |
| `scripts/guard.py` | **schema-drift guard** — diff any saved settings/mapping file against the live schema; hard-fails on drift |
| `scripts/validate.py` | post-apply validation — re-query and ASSERT columns/labels/relations/items match the blueprint |
| `scripts/seed.py` | demo-data seeder (project, employees, allocations, time reports) |
| `scripts/build-wbs.py` | optional WBS board from Excel (**destructive** — see gate below) |
| `templates/*.template.json` | Planner/Tracker settings + CLAUDE.md snapshot templates |
| `references/monday-api-rules.md` | DEPRECATED — GraphQL correctness now lives in the `monday-api` skill |

## Hard rules (always)

- **Default write target is the agent sandbox:** `TEST_WORKSPACE_ID=16291824` (scratch
  boards prefixed `WZ-`). Write anywhere else **only** when the user explicitly names a
  demo/production workspace — confirm the workspace name against a live query first.
- **Token hygiene:** never read `~/.config/mapps/.mappsrc` or paste a token. Every API
  call goes through the canonical `mapps-api.sh` (path above).
- **Never trust a saved settings/mapping file** — run `scripts/guard.py` on it BEFORE
  reasoning over it or importing it (see the Schema-Drift Guard procedure).
- **Status labels by label id, never positional index.** Create labels → read back via
  `settings` → map by id. The engine does this; honor it in any manual step.
- **Apps match columns by id, never title** → Hebraizing titles/labels is always safe.
- **Docs in English:** agent-facing `.md` files (the snapshot) are written in English.
  User-facing chat is Hebrew unless the user writes English.
- **Keep the snapshot true:** after any mutation, update the setup's `CLAUDE.md`.
- **MCP vs scripts:** ad-hoc single-item inspection/probes may use the monday MCP tools;
  bulk building/seeding always goes through the deterministic Python scripts (auditable,
  token-hygienic, complexity-friendly).

---

## Core procedures (apply to EVERY operation)

### P1 — Schema-drift guard (mandatory before using any saved file)

Saved settings/mapping JSON files go stale: columns get deleted or retyped, and a stale
copy (classically from `~/Downloads`) gets re-imported over a repo fix. Before reasoning
over ANY settings/mapping file or importing it into an app:

```bash
python3 scripts/guard.py <settings-or-state.json> [--board <BOARD_ID>]... \
        [--required fieldA,fieldB] [--allow-dup fieldA=fieldB]
```

It fetches live `boards{columns{id type settings}}` and **hard-fails** on:
- **dead column ids** (mapped column no longer exists),
- **type mismatches** (e.g. `roleColumnId` must be a text column),
- **duplicate column ids across mapping fields** (the `workdaysColumnId == endDateColumnId`
  ColumnValueException incident),
- **required-but-empty mappings** — pass `--required` with the fields a currently-enabled
  feature depends on (e.g. approval enabled → `approvalStatusColumnId`).

If guard fails: do NOT proceed. Fix the mapping or rebuild via `provision.py`, re-run
guard until it passes.

### P2 — One canonical settings JSON per app

Each app (Planner, Tracker) has **exactly one** canonical settings JSON in the setup's
repo folder (`<outDir>/planner-settings.json`, `<outDir>/tracker-settings.json`). If the
user points at a settings file **outside the repo** (e.g. `~/Downloads/...`), warn
explicitly that out-of-repo copies are the classic stale-import trap, diff it against the
canonical file, and get confirmation before using it. Never create a second variant of a
settings file — edit the canonical one.

### P3 — Membership preflight (before ANY people-column write)

A person can only be assigned on a board they are subscribed to; otherwise every write
fails with `invalidPersonAssignment`. Before seeding or writing any people column:

1. Query current subscribers: `boards(ids:[...]){ subscribers { id name } }`.
2. Compare against every user id the operation will assign.
3. If users are missing, ask **one** AskUserQuestion gate listing exactly which users
   will be added to which boards, then run
   `add_users_to_board(board_id, user_ids, kind: subscriber)` for all of them.
   Never add members silently, and never ask more than once per operation.

### P4 — board_kind check (before member add/remove features)

Query `boards(ids:[...]){ board_kind }` before offering or implementing member
add/remove. On a **public** board every account member is an implicit subscriber —
removing subscribers is futile and "restricting access by removing members" is not
possible. Only `private`/`shareable` boards actually restrict. Tell the user this
instead of running pointless mutations.

### P5 — Destructive operations are gated

`scripts/build-wbs.py --apply` **deletes every existing item** on the projectStructure
board before rebuilding. It refuses to run without `--confirm-wipe` (non-interactive) or
a typed `WIPE` confirmation. Ask the user before passing `--confirm-wipe` — one explicit
question naming the board and item count.

---

## The flow

### Step 1 — Guided interview

Read `blueprints/structures.json` first so you can explain options accurately, then use
AskUserQuestion to collect, in order:

1. **Target workspace** — default is the sandbox (`TEST_WORKSPACE_ID=16291824`) unless
   the user names a demo/production workspace. Verify:
   `mapps-api.sh 'query { me { name account { id name } } workspaces(ids:[<WS>]){ id name kind } }'`
   and confirm the name matches what the user expects before any mutation.
2. **System structure** (one preset from the Axis blueprint set, or a custom build):
   `portfolio_full` · `tracker_only_assignments` · `tracker_only_tasks` · `planner_only`.
3. **Options** (multi-select): Customers board · WBS project-structure board (needs an
   Excel) · routine-work classification.
4. **Existing vs new boards** — for each board the structure needs: reuse or create?
   (Run Step 2 discovery first so you offer real candidates.)
5. **Project stages** — the ordered list for the Time Logs stage classification and WBS.
6. **People** — which real monday users participate. Verify each exact id via
   `users(kind: all){ id name email }`; never guess an id. (Membership preflight P3
   applies before any assignment.)
7. **Seed data** — volumes, date ranges, hours/day — or skip for a production setup.

Answers map into `config.json` (see the docstring in `scripts/provision.py` for the full
shape): structure → `structure`; options → `options.*`; stages → `stages`; per-board
create/reuse → `boards.<key>`; people + volumes → the `seed` block.

### Step 2 — Live discovery

Never build from assumptions — list what actually exists:

```bash
mapps-api.sh 'query { boards(workspace_ids:[<WS>], state:active){ id name board_kind items_count groups{id title} columns{ id title type } } }'
```

For any board the user wants to **reuse**, build its `columnMap` (logical key → existing
column id) by matching blueprint titles/types to live columns; pull `settings` for status
columns to seed `labelMap`. For an inspect-only request, this step plus a summary IS the
operation.

### Step 3 — Dry-run plan

1. Write `config.json` into the setup's output folder and set `outDir` to that path.
2. `python3 scripts/provision.py <outDir>/config.json` — prints the full plan (boards to
   create/reuse, columns, relations) and mutates **nothing**.
3. Show the user the plan. Adjust and re-run until they approve. **Approval of the plan
   is the gate for apply** — do not apply an unapproved plan.

### Step 4 — Gated apply

```bash
python3 scripts/provision.py <outDir>/config.json --apply
```

- Creates/maps boards + columns, reads back real status label ids, renders
  `planner-settings.json` / `tracker-settings.json` into `outDir`.
- `state.json` is written **incrementally** during apply — a mid-run crash leaves a
  reconciliation record; resume by re-running discovery against `state.json`.
- **Mirrors are best-effort:** the engine logs unbuildable mirrors as `MANUAL` steps.
  Create those in the UI and record them in the snapshot.

### Step 5 — Settings import (guarded)

Run **P1 (guard.py)** on the rendered settings first — even fresh renders, since the
apply may have partially failed. Then guide the user: each app's Settings → import the
canonical JSON from `outDir` (import **merges** — every key that must change is present
explicitly). If the Tracker shows "נדרש עדכון הגדרות", a configured column id points at a
missing column — guard.py against the reporting board will name the dead key; null it out.

### Step 6 — Optional builders

- **WBS board:** add a `wbs` block, dry-run then apply `scripts/build-wbs.py`
  (destructive gate P5 applies).
- **Seeding:** fill the `seed` block, dry-run `scripts/seed.py <config>` then `--apply`.
  Membership preflight (P3) runs BEFORE seeding anything with people columns. Seeding
  validates its own config up front (e.g. allocations without a project need an explicit
  date range) instead of failing mid-run.

### Step 7 — Scripted post-apply validation (replaces "eyeball it")

```bash
python3 scripts/validate.py <outDir>/config.json
```

Re-queries every board in `state.json` and ASSERTS: boards exist in the right workspace,
every mapped column exists with the blueprint's type, every recorded status label id
exists live, every relation points at its target board, and seeded boards are non-empty.
Exit 1 with a violation list = fix before handing over. Only after PASS:

1. Render `templates/CLAUDE.md.template` into `<outDir>/CLAUDE.md` from `state.json` —
   the agent-facing snapshot (boards, ids, column tables, apps, seed summary, manual
   steps). Keep it in sync after any later mutation.
2. Report to the user (in Hebrew) what was built, what is manual, and where the
   settings files are.

---

## Notes

- The Axis reference build is `דמו 8.6` (workspace `15873737`). Its hand-written scripts
  were the basis for this skill; new setups use the generic engine.
- Re-running `provision.py --apply` is safe for create-mode boards not yet built; for
  existing setups prefer targeted API edits + updating `state.json`, then `validate.py`.
- `seed.py` and `build-wbs.py` create fresh data each run (build-wbs wipes first — gated).
- For GraphQL correctness (column value JSON shapes, status rules, pagination,
  complexity), consult the **`monday-api` skill** — its `references/` are canonical.
  `references/monday-api-rules.md` here is deprecated and kept only as a legacy pointer.
- Probes/tests: only in `TEST_WORKSPACE_ID=16291824`, scratch boards prefixed `WZ-`,
  delete what you create.

## Self-improvement — when the skill itself fails you

When `guard.py`/`validate.py` flags something that's actually fine,
`provision.py`/`seed.py` errors out, or a blueprint (`blueprints/*.json`) no
longer matches what's live in a workspace:

1. Treat it as the blueprint or script being stale, not just a one-off
   annoyance — workspaces drift (columns retyped/deleted, labels reordered)
   and the blueprint has to catch up.
2. Record same-session (standing rule): append the drift/quirk to
   `references/monday-api-rules.md` — or, if it's really a GraphQL-shape
   issue, to the `monday-api` skill's references (this skill defers
   correctness questions there).
3. If the real fix is a blueprint/script change beyond this session's scope,
   leave a known-gap note in references/ with the observed drift and fix
   direction, and surface it to the user.
4. Never loosen `guard.py`'s hard-fail conditions or `validate.py`'s
   assertions to get unblocked — if a check seems wrong, verify against a
   live query first, then fix the check's logic with that proof.
