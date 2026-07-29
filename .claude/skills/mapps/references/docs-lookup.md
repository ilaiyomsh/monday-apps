# Live documentation lookup — best practice for `ask_developer_docs`

The monday API and apps-framework docs change **frequently** (quarterly API versions plus
continuous doc fixes). Skill references in this workspace are snapshots with dated headers —
the live docs always win on disagreement. This page documents how to query them well.
Everything below was verified empirically on 2026-07-02 (live calls, timed, and one
docs-vs-reality conflict resolved by a sandbox probe).

## Cloud sessions cannot reach the docs at all (2026-07-29)

Both routes are closed in a Claude-Code-on-the-web session, so the "live docs win"
protocol below **cannot be exercised** there — say so instead of implying a check happened:

- `ask_developer_docs` needs `MONDAY_TOKEN` (no `.mappsrc` in the ephemeral VM, and agents
  must never use the token).
- `developer.monday.com` is **denied by the environment's network policy** at the proxy
  gateway — 403 to CONNECT, identically via `WebFetch` and via a real Chromium through the
  proxy (`curl -sS "$HTTPS_PROXY/__agentproxy/status"` lists the refusal under
  `recentRelayFailures`).

What to do instead: verify against the checked-in SDL
(`monday-api/schema-cache/schema-*.sdl`) for SHAPE, rely on recorded probes/incidents for
BEHAVIOUR, label each claim with its source, and ask the user to paste the page when a
docs-only fact is load-bearing. `https://developer.monday.com/api-reference/llms.txt` is the
documented index of every doc page — a useful thing to hand the user to fetch.

## The tool

```bash
.claude/skills/mapps/mapps-api.sh \
  '{ ask_developer_docs(query: "<your question>") { answer } }' ''
```

It is an AI agent over the official developer docs. Response type
(`AppDocumentationAiResponse`, introspected): `id`, `question`, `answer` (markdown),
`conversation_id`.

**Measured behavior:**

- **Latency: 14–21 seconds per call.** Not free — think before you call, and put ALL the
  context into one well-formed question instead of a chat of fragments.
- **Citations:** answers embed `[[Page Title](https://developer.monday.com/...#anchor)]`
  links to the exact doc pages/anchors. **Always harvest these URLs** — when the answer is
  incomplete or ambiguous, `WebFetch` the cited page; it is the authoritative source the
  answer was built from.
- **No real follow-up channel:** `conversation_id` is returned but the query field accepts
  no conversation argument (introspected — `query: String!` is the only arg). For a
  follow-up, restate the needed context inside a fresh question.
- **Hebrew works.** A Hebrew question gets a correct Hebrew answer with the same citation
  format. Ask in whichever language states the question most precisely.

## How to phrase queries (what measurably worked)

Ask a **specific, decision-shaped question with fallback built in**:

> "Can `items_page` `query_params` filter by a board_relation column by linked item id?
> **If not, what is the correct way** to find items linked to a specific item?"

That form produced a complete answer: a yes/no, a working snippet, the full operators
table, AND an unprompted adjacent warning (`items_page_by_column_values` does not support
board_relation columns). Vague questions ("how do connect boards work?") waste the call.

Include in the question: the exact query/mutation/CLI command name, the column/feature
type, and what you are trying to accomplish. One topic per call.

## Trust model — docs vs. skill references vs. live behavior

Three sources can disagree. Resolution protocol, in order:

1. **Skill reference pages** (this workspace) = verified-at-a-date snapshots. Fast, but
   can go stale — check the dated header.
2. **`ask_developer_docs` / WebFetch of docs** = what monday currently documents. Fresher,
   but describes intent — the platform occasionally differs (in both directions: stale
   docs on new behavior, and correct docs on behavior that used to be broken).
3. **A live probe in the sandbox** (`monday-api/scripts/probe.sh`, TEST_WORKSPACE_ID,
   `WZ-` scratch objects, deleted after) = ground truth. **When 1 and 2 disagree, 3
   decides.**

Case study (2026-07-02): session-verified knowledge said board_relation id-filtering
silently returns nothing; `ask_developer_docs` said it works. A 6-call sandbox probe
(two WZ- boards, relation column, link, filter by id and by name, delete) proved the
docs RIGHT — the platform had been fixed since June. The skill reference
(`monday-api/references/board-relation.md` Rule 5) was updated the same session with the
dated resolution. **That is the standing loop: conflict → probe → update the reference →
same session.**

## When to escalate to the user

If `ask_developer_docs` plus a WebFetch of its cited pages does not resolve the question
(the docs agent occasionally answers about the wrong feature, or the topic is too new),
**ask the user for a pointer to the relevant docs page** — one short question naming what
you searched and what came back empty. He can locate the page in the Developer Center
faster than another blind search round. Do NOT burn more than 2 docs calls + 1 WebFetch
round on the same question before asking.

## When NOT to call it

- The answer is in a skill reference with a fresh dated header → use it.
- Pure schema shape questions → `__type` introspection or `scripts/schema.sh` cache
  (instant, free) beat a 15-second docs call.
- You already know the command → `mapps <cmd> --help` is faster for flag syntax.

Call it FIRST (before guessing, before trial-and-error) for: unfamiliar mutations/fields,
column-value formats not in the references, framework/manifest/app-lifecycle behavior,
webhooks/automations semantics, anything where the references' dated header is >60 days
old, and any error message you do not recognize.
