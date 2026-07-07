---
name: mapps
description: "The framework backbone for monday.com app development — deploy (ship), tunnel, logs, versions, scheduler, storage, manifest, and direct API calls via mapps-api.sh. Use for /mapps <anything>, any deploy/ship/push request, tunnels, live logs, app versions/promote, registering a NEW app or feature from the CLI/API, manifest edits, scope changes, and whenever the user says: תפרוס, פריסה, לפרוס, טאנל, לוגים, גרסה, ship, deploy, אפליקציה חדשה מאפס, פיצר חדש, מניפסט, סקופים. Also invoked by change-tracker's close flow for monday apps. Carries the ship procedure (the ONLY sanctioned production-deploy path), the session preflight, the autonomy gate map, and the canonical mapps-api.sh helper."
argument-hint: "[command] [args...]"
allowed-tools: Bash, Read, Glob, Grep, Write, WebFetch
---

# mapps — monday.com framework backbone

You are the operator of the `mapps` CLI (`@mondaycom/apps-cli`) and the
canonical API helper. Everything deploy-, tunnel-, logs-, version-, storage-,
scheduler-, and manifest-shaped routes through this skill.

Files in this skill (all paths under `.claude/skills/mapps/`, relative to the
repo root of the current clone — `git rev-parse --show-toplevel`):

| File | Purpose |
|---|---|
| `scripts/ship.sh` | The ONLY sanctioned production-deploy path |
| `scripts/preflight.sh` | Session-start / pre-ship sanity checks (read-only) |
| `mapps-api.sh` | THE canonical GraphQL helper — documented below, never `find` for it |
| `references/cli.md` | Verified flag cheat sheet + full CLI reference |
| `references/app-lifecycle.md` | End-to-end NEW-app playbook — register app + features via CLI/API, build wiring, manifest anatomy/edit, scopes & the re-auth trap |
| `references/verify-live.md` | How "done" is actually verified on the live board |

## Preflight (session start + before every ship)

Run once at the start of any session inside an app directory, and again before
shipping:

```bash
<repo-root>/.claude/skills/mapps/scripts/preflight.sh
```

(`<repo-root>` is the repo root of the current clone — from inside the repo:
`git rev-parse --show-toplevel`.)

It is read-only and checks: git repo exists (if not — offer `git init` +
`.gitignore` NOW, not at session end), pwd is the worktree toplevel,
`node_modules` present in THIS worktree (worktrees do not share it),
`.change-tracker/project.json` path matches cwd, and an app id is resolvable
(`.env` APPID/APP_ID or `-a` in package.json scripts). Fix its findings using
the remediation commands it prints before doing anything else.

## GATE MAP (autonomy calibration — follow exactly)

**Always autonomous — NEVER ask:** `git commit`, changelog updates,
`close_change`, and all other bookkeeping (logging changes, updating
references pages, writing scratch files). Asking about these is a failure.

**Exactly-one-question gates — ask ONE question, then act:**

| Action | The one question | Then |
|---|---|---|
| Production deploy | `לפרוס לפרודקשן?` | run `scripts/ship.sh` (never raw code:push) |
| Board membership / permission grants (`add_users_to_board` etc.) | confirm the grant | execute |
| `mapps storage:remove-data` | confirm the wipe | execute (never `-f` unprompted) |
| `mapps scheduler:delete` | confirm the delete | execute |
| `git push` | confirm the push | push once, stop |

Never chain a gated action silently onto an ungated request (e.g. deploy after
"fix this") — that is what the gate question is for. Never ask twice.

## SHIP — the only sanctioned deploy path

When the user asks to deploy (תפרוס / פריסה / לפרוס / deploy / ship / push to
prod), do exactly this:

1. Run `scripts/preflight.sh`; resolve findings.
2. Ask the user **exactly one question**: `לפרוס לפרודקשן?` (AskUserQuestion).
   Skip the question only if the current user message itself is an explicit
   deploy order (e.g. "תפרוס" is the whole request) — that IS the authorization.
3. On yes, from the app's worktree root:

```bash
<repo-root>/.claude/skills/mapps/scripts/ship.sh
```

ship.sh handles the entire pipeline — do not replicate any step manually:

- resolves APP_ID / BUILD_DIR / CLIENT_SIDE from package.json deploy scripts,
  falling back to `.env` (warns loudly on conflicts between the two);
- asserts pwd == the CURRENT worktree's `git rev-parse --show-toplevel` and
  never cds (prevents wrong-worktree deploys);
- refuses an uncommitted tree unless `--allow-dirty` (lists the changes —
  never claim "done" over uncommitted work);
- ALWAYS rebuilds first (`--force` push does NOT rebuild);
- pushes with `--force` by default (single-live-version apps always need it —
  a plain push is a guaranteed failure, never attempt one);
- retries exactly once on the transient "Unexpected error occurred while
  communicating with the remote server";
- verifies: fetches live CDN index.html, diffs the asset hash against the
  local build, greps a git-sha build marker in the live bundle when present;
- prints the mobile-cache caveat and the verify-live reminder.

Useful flags: `--dry-run` (print the plan, execute nothing), `--allow-dirty`,
`--app-id <id>`, `--live-url <url>` (CDN base for verification; also read from
`LIVE_URL`/`CDN_URL` in `.env`).

**After ship.sh exits 0 you are still NOT done.** The hash-diff is necessary
but not sufficient. Drive the exact changed flow on the live board per
`references/verify-live.md` (fresh tab per check, screenshot +
read_console_messages; API-equivalence fallback when the browser is
unavailable). Only then report done.

A PreToolUse hook blocks raw `mapps code:push` / `npm run deploy` /
`pnpm run deploy` commands that bypass ship.sh — this is intentional; do not
work around it.

## mapps-api.sh — THE canonical API helper (stop `find`-ing for it)

Canonical path, relative to the repo root of the current clone (memorize it,
it never moves within the repo):

```
<repo-root>/.claude/skills/mapps/mapps-api.sh
```

It executes raw GraphQL against `https://api.monday.com/v2`, reading the token
from `~/.config/mapps/.mappsrc` internally so the token never enters
conversation context. **Never read `.mappsrc` directly and never OAuth the
claude.ai monday connector for API calls — this script is THE path.**

```bash
mapps-api.sh '<graphql-query>' ['<variables-json>'] [api-version]
# api-version defaults to 2026-04
```

Raw query:

```bash
.claude/skills/mapps/mapps-api.sh \
  'query { app(id: 10787117) { name status features { name type } } }'
```

With variables:

```bash
.claude/skills/mapps/mapps-api.sh \
  'query ($appId: ID!) { app(id: $appId) { name } }' '{"appId": 10787117}'
```

Mutations work the same way (probes/tests ONLY in TEST_WORKSPACE_ID=16291824,
scratch objects prefixed `WZ-`, deleted after).

### ask_developer_docs — the docs oracle (use it FIRST)

The monday developer docs are queryable through the same script:

```bash
.claude/skills/mapps/mapps-api.sh \
  '{ ask_developer_docs(query: "How do I create a board view?") { answer } }' ''
```

The `answer` field is markdown with links to official docs. Escape double
quotes in the question with backslashes; the second argument is an empty
string (no variables).

**Hard rule:** for any unfamiliar CLI flag, GraphQL field, or framework
question — `ask_developer_docs` FIRST, then `mapps <cmd> --help`. NEVER invent
flags, subcommands, or field names from memory; guessing has burned hours
(see `references/cli.md` section 1 for the accumulated traps).

Best practice for querying it well — response anatomy (answer + citation links
+ conversation_id), 14–21s latency, phrasing patterns, Hebrew support, the
docs-vs-skill-reference-vs-live-probe trust protocol, and when to stop and ask
the user for a docs-page pointer: **`references/docs-lookup.md`** (verified
live 2026-07-02).

Schema introspection also goes through the script:

```bash
.claude/skills/mapps/mapps-api.sh \
  'query { __type(name: "Board") { fields { name type { name } } } }'
```

## MCP note

Where the monday-platform MCP server is registered, prefer its structured
tools for platform-data READS (boards, items, users, workspaces). Deploy,
tunnel, and live logs have NO MCP equivalent — they are CLI-only, through this
skill. For writes and anything app-lifecycle, mapps-api.sh + the CLI remain
the path.

## Project detection (for routed commands below)

1. Parse `package.json` scripts (`deploy`, `deploy:force`, `tunnel`, ...) for
   `-a/--appId` → **APP_ID**, `-d` → **BUILD_DIR**, `--client-side` →
   **CLIENT_SIDE**, `-p/--port` → **PORT**.
2. Fall back to `.env`: `APPID=` / `APP_ID=` → **APP_ID**.
3. If both exist and disagree, the package.json deploy-script value wins (it
   is what has actually been deploying); surface the conflict to the user.
4. If no APP_ID anywhere, ask the user.

Note the CLI's `-i` flag is inconsistent — it means app id for some
subcommands and version id for others. Check the table in
`references/cli.md` before constructing a command.

## Sub-command routing (`/mapps <arg>`)

### No argument → quick help

| Command | What it does |
|---------|-------------|
| `ship` / `deploy` | The ship procedure above (one gate question → ship.sh) |
| `preflight` | Run scripts/preflight.sh |
| `tunnel` | `mapps tunnel:create -p <PORT> -a <APP_ID>` |
| `logs` | `mapps code:logs -i <APP_VERSION_ID> -s live -t console` |
| `logs:http` | same with `-t http` |
| `status` | `mapps code:status -i <APP_VERSION_ID>` |
| `env list/set/delete` | `mapps code:env -i <APP_ID> -m ...` |
| `secret list/set/delete` | `mapps code:secret -i <APP_ID> -m ...` |
| `apps` | `mapps app:list` |
| `version` | `mapps app-version:list -i <APP_ID>` |
| `features` | `mapps app-features:list -a <APP_ID> -i <APP_VERSION_ID>` |
| `storage` | search/export/remove (remove is gated) |
| `promote` | `mapps app:promote -a <APP_ID> -i <APP_VERSION_ID>` (gated — production) |
| `scaffold` | `mapps app:scaffold` |
| `new-app` | Register a brand-new app + features entirely from the CLI/API — full procedure in `references/app-lifecycle.md` |
| `feature` | Add an app feature (view/widget/object/integration) to an existing app — `references/app-lifecycle.md` §4–5 |
| `manifest edit` | Export → edit → import workflow, manifest anatomy, cloning via `-n` — `references/app-lifecycle.md` §6 |
| `manifest` | export/import |
| `scheduler` | list/create/run/update/delete (delete is gated) |
| `docs <question>` | ask_developer_docs via mapps-api.sh |
| `api <query>` | raw GraphQL via mapps-api.sh |

### Routing details

- **`ship` / `deploy` / `deploy force`** → the SHIP section above. There is no
  separate "force" path — ship.sh always uses `--force` and always rebuilds.
- **`tunnel`** → detect PORT + APP_ID, `mapps tunnel:create -p <PORT> -a <APP_ID>`.
  Restart: `lsof -ti:<PORT> | xargs kill -9 2>/dev/null` then create again.
- **`logs` / `logs:http` / `status`** → these take the app **version** id
  (`-i/--appVersionId`), not the app id. Get it from
  `mapps app-version:list -i <APP_ID>` or a package.json script. History mode:
  `-s History -f "MM/DD/YYYY HH:mm" -e "MM/DD/YYYY HH:mm"`.
- **`env` / `secret`** → `mapps code:env|code:secret -i <APP_ID> -m
  list-keys|set|delete [-k KEY] [-v VALUE]` (here `-i` IS the app id).
- **`version`** → `mapps app-version:list -i <APP_ID>`. There is NO CLI
  command to create or promote a version from `app-version:` — promotion is
  `app:promote`, and single-live-version apps have nothing to promote.
- **`storage`** → `storage:search`/`storage:export` need `-a <APP_ID> -c
  <CLIENT_ACCOUNT_ID>`. `storage:remove-data` is gated: one question first.
- **`scheduler`** → per `references/cli.md`; note targetUrl is `-e` and
  relative to `/mndy-cronjob/`. `scheduler:delete` is gated: one question.
- **`manifest`** → `manifest:export -a <APP_ID> [-p <path>]` (live version) or
  `-i <APP_VERSION_ID>`; `manifest:import -p <path>`.
- **`new-app` / `feature` / `manifest edit`** → read
  `references/app-lifecycle.md` and follow its numbered procedure (it carries
  its own gates: announce before `app:create`/`create_app`/`manifest:import`,
  one question for imports over an existing live app, re-auth warning on any
  scope change).
- **`docs <question>`** → no project context needed; run the
  ask_developer_docs query shown above and present the `answer` markdown.
- **`api <query>`** → run mapps-api.sh directly with the given query.
- **Unrecognized** → read `references/cli.md`, find the closest command, run
  it with detected context; otherwise show the quick-help table.

### Debug recipe

"debug" / "show errors": stream console logs with `--verbose`, and check HTTP
logs (`-t http`) for 4xx/5xx in the same window.

## Docs freshness (30-day refresh of references/cli.md)

On invocation, check the reference age:

```bash
stat -f "%m" .claude/skills/mapps/references/cli.md
date -v-30d +%s
```

If the file is missing or older than 30 days:

1. **Backup first** (dated):
   `cp references/cli.md references/cli.md.bak-$(date +%Y-%m-%d)`
2. WebFetch `https://developer.monday.com/apps/docs/command-line-interface-cli`
   with the prompt: "Extract ALL CLI commands, their flags/options,
   descriptions, and usage examples. Organize by command group (tunnel, code,
   app, app-features, app-version, scheduler, storage, manifest, database,
   api). For each command list: full command syntax, all flags with
   descriptions and defaults, and any examples shown."
3. Rewrite **ONLY section 2** ("FETCHED REFERENCE") of `references/cli.md`.
   Section 1 ("VERIFIED FACTS") is curated and must never be clobbered by a
   fetch.
4. `diff` the new file against the dated backup and REVIEW the diff: if the
   fetch dropped commands or contradicts a live-verified fact in section 1,
   verify against `mapps <cmd> --help` before accepting, and keep the
   verified fact.
5. Tell the user: "Updated CLI reference (last refresh was X days ago)" and
   summarize what changed.
6. If the fetch fails (offline), keep the existing file and warn.

Any NEW platform quirk discovered in a session (wrong flag in docs, new trap)
gets appended to section 1 of `references/cli.md` in the same session.

## Self-improvement — when the skill itself fails you

When the CLI, `ship.sh`, `mapps-api.sh`, or a reference here misfires (wrong
flag, a gate blocking a genuinely safe action, a script throwing, or
`references/cli.md` contradicting `mapps <cmd> --help`):

1. Treat it as a bug in the skill, not just an obstacle — do not silently
   route around it.
2. Record same-session (standing rule): append the confirmed trap/fix to
   `references/cli.md` section 1 ("VERIFIED FACTS") — the same mechanism the
   Docs freshness routine above already uses for new CLI quirks.
3. If the fix is bigger than a reference-page note (e.g. a real bug in
   `ship.sh` or `preflight.sh`), leave a known-gap note there with repro +
   fix direction and tell the user — don't silently patch the scripts.
4. Never bypass the ship gate or the PreToolUse hook to get unblocked. If
   it's a false positive, prove the action is safe first (e.g. `--dry-run`
   output), then fix the gate's condition — don't just skip it.
