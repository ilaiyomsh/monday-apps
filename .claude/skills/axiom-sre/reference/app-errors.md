# Investigating `app-errors` — agent playbook

The one shared Axiom dataset for **every** app in this monorepo (client + server),
discriminated in-band. This is the fast path for "send an agent to check errors."
The envelope/shipping side is `docs/ERROR-AXIOM-STANDARD.md` + `docs/LOGGING-ARCHITECTURE.md` §5;
this file is the **read/query** side.

> **Golden Rule still applies:** discover → `getschema` → query. The schema below is a
> point-in-time capture (verified live 2026-07-26) to orient you — confirm with
> `getschema` before relying on a field, and never invent field names.

## 0. Access (do this first)

Queries run through the **`axiom-sre` skill**, env alias **`prod`**:

```bash
cd .claude/skills/axiom-sre
./scripts/init                    # loads config + memory (no network)
./scripts/discover-axiom prod     # confirms the dataset: app-errors
./scripts/axiom-query prod --since 7d <<< "['app-errors'] | where kind=='error' | take 1"
```

- Auth lives in `~/.config/axiom-sre/config.toml` (a **read** token + org, per-user,
  machine-local — NOT in the repo). A local dev machine that has run the skill before
  already has it.
- **A fresh clone / cloud VM (claude.ai, Cowork, CI) has no config** — just like
  `MONDAY_TOKEN`, the Axiom read token is not available there. If `discover-axiom`
  errors with auth/404, the config is missing: **ask the user to set it up** (SKILL §1),
  do not guess or fabricate results.
- Every `axiom-query` call **must** carry a window (`--since 7d` or `--from/--to`).

## 1. The dataset

- **One dataset `app-errors`** for all apps. Discriminators: `app` (which app) and
  `kind` (`error` | `usage` | `health`). Errors → `kind=='error'`.
- Verified fields on `kind=='error'` records (besides Axiom's internal `_sysTime`):

  `_time, acc, app, board, corr, env, err_msg, err_name, kind, level, message, ms, obj, path, sess, stack1, step, tag, total_ms, usr, ver`

  | field | meaning |
  |---|---|
  | `app` | app slug (`discussions`, `tracker`, `telemetry-dashboard`, …) |
  | `level` | `error` \| `warn` (both ship under `kind=='error'`) |
  | `err_name` / `err_msg` | error class + scrubbed message — **often empty** (see gotchas) |
  | `message` | stable English event id (the human-facing text for warn/log records) |
  | `stack1` | first stack frame, **minified** — symbolicate to read it |
  | `usr` / `obj` / `board` | monday identity (sparse — ~20% of error rows) |
  | `corr` / `sess` | correlation id / session — join related records |
  | `ver` / `env` | app version (`2.3.1+<sha>`) / environment |
  | `ms` / `total_ms` / `step` | timings |

## 2. Conventions & gotchas — READ before concluding

1. **`err_name` is frequently EMPTY.** ~2/3 of error rows (esp. `level=warn` retry
   logs, and some global-handler `"Uncaught error"`) carry **no** `err_name`; the text
   is in `message`. Identify/group by the fallback **`err_name → err_msg → message`**,
   never `err_name` alone. (discussions now fills `err_name` at the sink — Change #149 —
   but historical rows and other apps still won't.)
2. **There is NO `err_code` column.** Referencing it fails the whole query with
   `invalid field: "err_code"`. (This was the bug that left the dashboard's Top errors
   empty — Change #148.)
3. **`kind=='error'` includes `level=='warn'`.** For genuine errors only, add
   `| where level=='error'`.
4. **`stack1` is a single minified frame.** Read it as `File.jsx:line` via:
   `./scripts/symbolicate '<stack1>' --app <app> --ver <ver>`.
5. **Source of truth for the name derivation** is `ERR_NAME_EXPR` in
   `apps/telemetry-dashboard/src/server/queries.js` — mirror it so your grouping matches
   the dashboard.

## 3. Canonical queries

The reusable name-derivation (paste into the queries that need it):

```
extend name=case(isnotempty(err_name),err_name, isnotempty(err_msg),err_msg, isnotempty(message),message, '(unnamed)')
```

```bash
cd .claude/skills/axiom-sre

# a) error volume per app (where is it hurting?)
./scripts/axiom-query prod --since 7d <<< \
"['app-errors'] | where kind=='error' | summarize count() by app | sort by count_ desc"

# b) top error types (name-fallback so un-named rows aren't lost)
./scripts/axiom-query prod --since 7d <<< \
"['app-errors'] | where kind=='error' | extend name=case(isnotempty(err_name),err_name, isnotempty(err_msg),err_msg, isnotempty(message),message, '(unnamed)') | summarize count(), apps=dcount(app) by name | sort by count_ desc | take 25"

# c) drill into ONE error's raw occurrences (full per-event context)
./scripts/axiom-query prod --since 7d <<< \
"['app-errors'] | where kind=='error' | extend name=case(isnotempty(err_name),err_name, isnotempty(err_msg),err_msg, isnotempty(message),message, '(unnamed)') | where name=='TimeoutError' | project _time, app, acc, usr, obj, level, err_msg, message, stack1, corr, ver | sort by _time desc | take 100"

# d) genuine errors only (drop warn-level noise)
./scripts/axiom-query prod --since 7d <<< \
"['app-errors'] | where kind=='error' and level=='error' | summarize count() by app | sort by count_ desc"

# e) errors over time (spike detection), stacked by app
./scripts/axiom-query prod --since 7d <<< \
"['app-errors'] | where kind=='error' | summarize count() by bin_auto(_time), app | sort by _time asc"

# f) triage one app: most recent errors with context
./scripts/axiom-query prod --since 24h <<< \
"['app-errors'] | where app=='discussions' and kind=='error' | project _time, level, err_name, err_msg, message, stack1, ver | sort by _time desc | take 50"

# g) which accounts are affected
./scripts/axiom-query prod --since 7d <<< \
"['app-errors'] | where kind=='error' and isnotempty(acc) | summarize count() by acc, app | sort by count_ desc"
```

For methodology (golden signals, differential/spotlight, cost discipline) see
`reference/query-patterns.md` and `reference/apl.md`. `usage` (`kind=='usage'`) and
`health` (`kind=='health'`) records live in the same dataset if you need adoption or
boot/latency signals.
