---
name: monday-api
description: "The canonical monday.com API-correctness skill. Use whenever writing or debugging ANY code that touches the monday platform API — GraphQL queries/mutations, column_values writes, item/board CRUD, pagination, typed GraphQL operations and TypeScript codegen (absorbs the retired genapi skill), webhooks, complexity/rate-limit issues, or auth errors. Trigger on: monday.api(), mondayApi, monday-sdk-js, items_page, board_relation, linked_item_ids, mirror, status/people/date/dropdown columns, settings_str, complexity budget, UNAUTHORIZED_FIELD_OR_TYPE, ColumnValueException; and on the user's phrases: קריאת API, קריאות API, עמודת סטטוס, עמודות מקושרות, מירור, חיבור בורדים, סכמה של מאנדיי, טייפים, /genapi. Also invoked as `/monday-api check [path]` to audit a project's API calls (deprecated fields, version pins, guessed formats)."
argument-hint: "[check [path]]"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task, WebFetch
---

# monday.com API — Correctness Workflow

One source of API truth. The old failure mode this skill exists to end: guessing GraphQL
shapes and column formats, then debugging in production for hours. **Nothing lands in source
until it passed the live schema and a live probe.**

## THE MANDATORY WORKFLOW — WRITE → VALIDATE → TEST → LAND → RECORD

Run these five steps IN ORDER for every new/changed query, mutation, or column write.

### 1. WRITE — minimal fields only

Draft the operation with the fewest fields that serve the use case (mutations usually return
just `id`). Read the project's existing operations first (`src/queries.graphql.ts`, api/
service layers) — extend, don't duplicate. Fewer fields = cheaper complexity too.

### 2. VALIDATE — every field/argument/enum against the LIVE schema, BEFORE it appears in code

- Preferred: monday MCP tools — `get_graphql_schema` / `get_type_details` for shape, and
  `get_column_type_info` before ANY column-value write. (Tool names per the local monday MCP
  server; if `.claude/scripts/mcp-tools.md` exists, verify exact names there.)
- Fallback (always works): `scripts/schema.sh` prints the path of a fresh SDL cache — grep it
  for your types/fields/enums.
  **HARD GATE: schema.sh refuses a cache >30 days old and auto-refetches. Never validate
  against a stale schema file, including the legacy `apps/genAPI/src/schema.graphql`.**
- Grep the schema for `@deprecated` on every field you selected — surface hits and migrate.
- For column WRITES additionally fetch the live board's `boards { columns { id type settings } }`
  — never trust a saved column mapping. Formats: `references/column-formats.md`.
- Docs beyond the schema: `mapps-api.sh '{ ask_developer_docs(query: "...") { answer } }'` —
  the docs are LIVE and change often; phrasing, citation-harvesting, latency, and the
  docs-vs-reference-vs-live-probe trust protocol are in `mapps/references/docs-lookup.md`.
  If 2 docs calls + 1 WebFetch of the cited pages don't resolve it, ask the user for a
  pointer to the relevant docs page instead of another blind round.

### 3. TEST — execute the EXACT payload once against scratch data

```bash
export TEST_WORKSPACE_ID=16291824   # AGENT-TEST — Claude sandbox (see .claude/CLAUDE.md at the project root)
.claude/skills/monday-api/scripts/probe.sh '<query>' '<variables-json>'
```

- probe.sh **hard-fails without TEST_WORKSPACE_ID** and never falls back to a real board.
  Scratch boards: `WZ-` prefix, created with explicit `workspace_id`, deleted after.
- Keep probes minimal (single item, `limit: 1`) — they share the production complexity budget.
- For any nested query, include `complexity { query before after }` and compare the measured
  cost against `references/complexity.md` lean-shape rules BEFORE shipping.
- MCP alternative for probes: `all_monday_api` (verify name; scope writes to the sandbox).

### 4. LAND — transcribe the proven payload into source

- Copy the exact probed operation into the project (typed codegen: `references/typegen.md`).
- **Test mocks MUST be generated from the captured real probe response — never hand-built.**
  Hand-built mocks encode your guesses and mask real API bugs.
- Pin the API version per `references/versioning.md` (no hardcoded "current" anywhere else).
- Run `/monday-api check` on the touched path before committing.

### 5. RECORD — same-session knowledge capture

Any newly discovered platform quirk (format surprise, error meaning, complexity number,
version behavior) is appended to the matching `references/*.md` page **in the same session**.
This ends the per-project memory siloing — the references are the living knowledge base.

## GUARDRAILS (non-negotiable)

- **No new GraphQL field, mutation shape, or column-value format enters code without a
  schema lookup or `ask_developer_docs` call FIRST.** Guessing is the failure mode, not a
  fallback ("תפסיק לנחש" is step 2, not a rescue).
- **Always fetch live column settings before writing column_values. Status label order comes
  from `settings.labels[].index` — NEVER from `settings_str`** (deprecated 2025-10; label
  ids are not positional).
- **Probe on a scratch item before touching real data** — writes only inside workspace
  16291824, `WZ-` boards, deleted after.
- **HTTP 200 is not success** — always inspect `errors[].extensions.code`
  (`references/errors-and-auth.md`).
- **Mocks come from captured real responses only.**
- **Every new quirk is RECORDed in references/ in the same session.**
- Never print or write the API token; all live calls go through the token-safe wrappers
  (`mapps/mapps-api.sh`, `scripts/schema.sh`, `scripts/probe.sh`).
- **Boundary with `error-guard`:** API error *shapes* and meanings stay here
  (errors-and-auth.md); the catch discipline around every call — try/catch placement, no
  silent catches, soft errors in 200 responses thrown at the API layer — lives in the
  **`error-guard`** skill.

## `/monday-api check [path]`

Audit API usage: `python3 .claude/skills/monday-api/scripts/check.py [path]`
(defaults to cwd; `--offline` skips the live versions fetch).

Flags: deprecated fields (`settings_str`, flat User photo fields, User boolean flags);
known-wrong column payloads (`{"checked":"false"}`, unstringified column_values, string
linkedPulseId); and the **version-pin rule** — files calling the API with no `API-Version`
pin, a pin absent from the live `{ versions { kind value } }` list, or a maintenance/RC pin.
Exit 1 on errors (usable as a pre-commit gate). Fix errors before shipping; treat warnings
as scheduled work.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/schema.sh [version]` | Fetch + cache live SDL (token-safe); refuses stale (>30d) caches |
| `scripts/probe.sh '<q>' ['vars'] [ver]` | Run exact payload live; prints JSON + complexity; sandbox-gated |
| `scripts/check.py [path]` | The `/monday-api check` audit |

## References (read the relevant page BEFORE coding)

| Page | When |
|---|---|
| `references/column-formats.md` | Any column read/write; status/managed columns; update HTML |
| `references/board-relation.md` | Connect-boards / linked items — the 7 verified rules |
| `references/complexity.md` | Nested queries, aggregates, batching, iframe round-trips |
| `references/errors-and-auth.md` | Any error; OAuth scopes; storage; subscribers |
| `references/versioning.md` | THE version declaration (RECOMMENDED_VERSION) + lifecycle |
| `references/typegen.md` | Optional TypeScript codegen after TEST passes (ex-genapi) |
| `references/webhooks.md` | create_webhook, challenge, JWT verification, retries |

## Quick recipes

- Get all items → `items_page(limit: 500)` + root `next_items_page(cursor)` loop; cursors
  expire after 60 minutes; `column_values(ids: [...])` to trim cost.
- Create item with values → validate formats (column-formats.md), remember board_relation is
  dropped by create_item (board-relation.md Rule 2).
- Filter items by column value → `items_page(query_params: ...)` — but NEVER on a
  board_relation column (Rule 5); status filters use label ids.
- Cross-board sums/reports → `aggregate()` cookbook in complexity.md, join by id.
- Batch mutations → aliased mutations, 10–15 per request, chunk id-reads at 100.
- Debugging an error → errors-and-auth.md table + playbooks (stale-token, fake-500).

Basics that never change: use GraphQL variables (never inline user values), `ID!` values are
strings, `column_values` is a JSON string, keys are column ids not titles.

## Self-improvement — when the skill itself fails you

When a `references/*.md` page, the schema cache, or a script here misleads you
(`schema.sh` serves a cache that turns out stale, `probe.sh` fails in a way
the runbook doesn't cover, or a reference contradicts what `ask_developer_docs`
or a live probe just showed):

1. Treat the mismatch as evidence the skill's knowledge drifted, not just a
   one-off error — the RECORD step (§5) exists for exactly this.
2. Resolve the disagreement via the docs-vs-reference-vs-live-probe trust
   protocol already defined in `mapps/references/docs-lookup.md` — don't
   re-derive it here.
3. Append the confirmed fact to the matching `references/*.md` page in the
   same session: what was wrong, what is now verified.
4. If `check.py` itself is wrong (false positive/negative), fix the script or
   note a known gap in the matching reference page — never silence a rule
   just to pass; narrow it only with a verified counter-example.
