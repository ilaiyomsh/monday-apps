# mapps CLI — verified cheat sheet + command reference

This file has TWO sections. The refresh procedure (see SKILL.md, "Docs freshness")
may rewrite ONLY section 2. Section 1 is curated from live `--help` output and
hard-won incident discoveries — never clobber it with a web fetch.

---

## 1. VERIFIED FACTS (curated — do not overwrite on refresh)

_Verified live against `@mondaycom/apps-cli 4.10.8` on 2026-07-02 via `mapps <cmd> --help` unless marked otherwise._

### Traps that keep being re-derived — read these before typing any mapps command

| Fact | Verified |
|---|---|
| There is **NO `app-version:promote`** subcommand. `app-version` has only `builds` and `list`. Promotion is `mapps app:promote -a <APP_ID> -i <APP_VERSION_ID>`. | live 4.10.8 |
| `code:status` takes **`-i/--appVersionId`** — it does NOT accept `-a`. | live 4.10.8 |
| `code:logs` takes **`-i/--appVersionId`** (not app id): `mapps code:logs -i <APP_VERSION_ID> -s live -t console`. | live 4.10.8 |
| **`code:logs` has NO working way to read the past — you must be tailing BEFORE the event.** All three filter flags are traps on 4.10.8: `-f/--logsStartDate`, `-e/--logsEndDate`, `-r/--logSearchFromText` each make the command **exit 1 printing absolutely nothing** (no error, no stderr) when combined with `-s live`, even though `--help` says they are "supported only if eventSource=live". With `-s History` the same flags are silently IGNORED (exit 0, empty). And `-s History` on its own returns only the `Fetching logs:` header and never any events. So the ONLY shape that yields output is the unfiltered live tail — `code:logs -i <VERSION_ID> -t console\|http -s live` — left running while the event happens. Every empty result here looks identical to "there were no logs", which is the easy way to conclude the opposite of the truth. Filter on the client side (`\| grep`) instead. | incident-verified 2026-08-05, deadline-confirm v5 16194490 + v6 16380275 |
| **A `code:logs -s live` stream self-closes after EXACTLY 10 minutes** ("Closed connection.", exit 0 — looks like a clean finish, not a timeout). Measured on four concurrent streams: 09:02:01→09:12:01, 09:02:19→09:12:19, 09:06:23→09:16:23, 09:06:45→09:16:45. Combined with the broken filters above, this is the real constraint on log capture: you cannot tail an hourly cron from an arbitrary start time. Start the tail **inside the 10 minutes before** the event, or wrap it in a re-spawning loop (`while true; do mapps code:logs …; done`) which reconnects but drops whatever occurred between connections. | incident-verified 2026-08-05, deadline-confirm |
| `code:logs` streams are **correctly isolated per app version** — a request served by one version appears ONLY in that version's stream. That is what makes "which version does the platform cron hit?" answerable: tail both versions, fire the tick, see which stream moves. Verified by curling each version URL and observing each probe land in its own stream only. | incident-verified 2026-08-05, deadline-confirm |
| **Concurrent `code:logs` streams on the SAME version+type PARTITION events between them — they do not each get a copy.** Opening N streams for redundancy is actively harmful: it *lowers* the odds any given stream sees a specific event. Measured on the 10:00 cron tick with four simultaneous live-http streams on version 16194490: exactly ONE received the `POST /mndy-cronjob/digest-send`; the other three missed it, including one that was receiving 616 lines of other traffic in the same window. The purpose-built stream timed to bracket the tick was among the ones that saw nothing — relying on it alone would have produced the exact opposite conclusion. **Run exactly ONE stream per (version, type)** and tee it if several consumers need the data. (Boot lines were seen by multiple streams, so partitioning is per-event, not a stable per-stream subscription — do not assume "my stream gets category X".) | incident-verified 2026-08-05, deadline-confirm live 16194490 |
| A `code:logs -t console` stream can **silently miss an application log line whose HTTP request it did receive.** Same tick: the http stream captured the cron POST (200, latency 14419ms) while `cron_tick` — logged by the handler that served that very request — appeared in NO console stream, across three that were open and a 5-minute wait afterwards. Console logging itself was working (the 0.14.0 boot lines were captured minutes earlier). Treat a missing console line as **unproven, not absent**, and prefer the http stream (it also carries `latency`, which for a cron POST is the whole handler's wall time) when the question can be answered from request-level data. | incident-verified 2026-08-05, deadline-confirm |
| **`code:logs` renders ONLY the `message` field of a JSON log line and silently drops every sibling key.** An app that logs `console.log(JSON.stringify({ts, level, tag, message, durationMs, recipients}))` shows up as just the message text — the numbers you added for observability are invisible. Fold values you need to read INTO the message string (`api_latency ms=463 ok=true op=GetBoardItems` renders in full; `tenant run finished` with `{accountId, durationMs, recipients}` renders bare). Verified on deadline-confirm 0.14.0, whose `logInfo(TAG,'cron_tick',{...})` proved unreadable while its own `track()`/`encodeDims` helper — which already documents this rule in a comment — renders correctly. | incident-verified 2026-08-05, deadline-confirm live |
| **`scheduler:run` does NOT return the target endpoint's response body** — it prints only `Successfully triggered job: <name>` and exits. The trigger is asynchronous, so anything the handler returns (durations, counts, per-tenant results) is unobtainable this way; read it from a live `code:logs` tail instead, subject to the message-only rendering above. | incident-verified 2026-08-05, deadline-confirm app 11704868 |
| The http log's **`latency` field is MILLISECONDS**, not seconds. A `/health` GET reads `latency: 3.02` (3ms); the deadline-confirm cron tick read `14419.32` = 14.4s. Reading it as seconds would turn a comfortable tick into an apparent 4-hour timeout violation. | incident-verified 2026-08-05, deadline-confirm |
| `app-features:build`: the short `-u <url>` form FAILS ("Unexpected argument") — use long form **`--customUrl=<url>`** (with `=`). Build types: `custom_url` \| `monday_code` \| `monday_code_cdn`. Running with `-t monday_code_cdn` and NO url drops into an interactive prompt ("Add your route to monday-code base url") and hangs agent sessions — always pass the full flag set. | incident-verified 2026-07-07 |
| A plain `mapps code:push` **ALWAYS fails on single-live-version apps** ("The latest app version is live... use --force"). Never attempt a plain push first — go straight through `scripts/ship.sh`, which applies `--force` behind the one deploy gate. | incident-verified, repeatedly |
| `code:push --force` (a.k.a. `deploy:force`) does **NOT rebuild** — it pushes whatever is in the build dir. Always build first (ship.sh does). | incident-verified |
| `--force` push reuses the **same version id and CDN URL** → monday **mobile webview may serve a stale cached bundle**; the CDN files DO update. Not a failed deploy. | incident-verified |
| Always `pnpm run deploy` / `pnpm run <script>` — **never bare `pnpm deploy`**, which collides with pnpm's builtin (`ERR_PNPM_CANNOT_DEPLOY`). | incident-verified, 3 projects |
| The GraphQL `create_app` mutation (via mapps-api.sh, not the CLI) requires slug format **`{account}_{slug}`**, e.g. `yomsheni-il_myapp`. | incident-verified (3 sequential failures before discovery) |
| `scheduler:create` targetUrl flag is **`-e/--targetUrl`** (older docs said `-u`), and the URL is relative to `/mndy-cronjob/<YOUR_ENDPOINT>`. | live 4.10.8 — doc correction |
| **`scheduler:create --help` beats the public docs — three drifts confirmed together (2026-08-05, CLI 4.10.8+):** (1) targetUrl is `-e`, while the published flag table still says `-u`; (2) `-z/--region` accepts **`us\|eu\|au\|il`** — **`il` exists but is absent from the public table**; (3) the CLI's own examples pass the endpoint with **NO leading slash** (`-e "my-endpoint"`), while the public table says it "must start with /". When in doubt run `--help` and then confirm what was actually stored with `scheduler:list -a <APP_ID>` — the stored target is the only ground truth for the resulting `/mndy-cronjob/<endpoint>` path. | `--help` verified 2026-08-05 |
| **`code:logs -i` is the app VERSION id, never the app id** (`--help`: "Please enter the app version id"). Passing the app id looks like a silent empty stream, not an error, so it reads as "the app logged nothing". Resolve the id first with `mapps app-version:list -i <APP_ID>` — which also tells you which version is draft and which is live, i.e. how to find out which version a scheduler tick actually hit. | `--help` verified 2026-08-05 |
| **`-e` means two different things:** `targetUrl` on `scheduler:create`, but `logsEndDate` on `code:logs`. Copying a flag between the two silently changes what it does. | `--help` verified 2026-08-05 |
| `code:logs` restricts `-r/--logSearchFromText`, `-f/--logsStartDate` and `-e/--logsEndDate` to **`-s live` only** — with `-s History` they are ignored, so a "no matches" result there says nothing about the logs. | `--help` verified 2026-08-05 |
| `scheduler:create -b/--minBackoffDuration` defaults to **10 minutes** and `-r/--maxRetries` has an undocumented default. For any cron whose handler is NOT idempotent this is a duplicate-execution window: a run killed by `-t/--timeout` is retried ~10 min later and repeats every side effect it already performed. Pass **`-r 0`** until the handler carries its own per-run guard. | doc-verified 2026-08-05 |
| There is **NO CLI/API to create a draft app version directly** (no `app-version:create`; no GraphQL mutation). The programmatic path: `mapps manifest:export -a <APP_ID> -p m.json` then `mapps manifest:import -a <APP_ID> --manifestPath m.json` — import with `-a` **creates a new draft version**. UI alternative: Developer Center → App versions → New version. Needed whenever the latest version is live and a non-force push must succeed (see monday-cicd skill). | live-docs-confirmed 2026-07-07 |
| `manifest:import -a <id>` fails with **"App slug is required"** when the app's `slug` is `null` (common on older apps; check via API `query { app(id:<id>) { slug } }`). Fix: inject `"slug": "<account>_<name>"` (this account's pattern: `yomsheni-il_planner`) into the exported manifest's `app` object, then import — the import sets the slug AND creates the draft. Verified on Planner 10787117 + Tracker 10684862. | incident-verified 2026-07-07 |
| `manifest:export -a <id> -p <path>` creates a **directory** at `<path>` containing `manifest.json` — it is NOT the file itself. `manifest:import --manifestPath` needs the inner `manifest.json` path, and must run from a user-writable dir (unlink EPERM when the manifest sits in sandbox-restricted `/tmp`). | incident-verified 2026-07-07 |
| `app-version:builds` can show a **stale, manifest-copied build URL** after a fresh `code:push -c` to that version. Authoritative verification: the push log line "Using version - <id>" + fetching the printed CDN URL and matching hashed asset filenames against the local build. | incident-verified 2026-07-07 |
| A `code:push` redeploy does **NOT rebind** an app feature whose build points at a `custom_url` — the external binding survives the push. To restore a client-side feature to the version's CDN deployment: `app-features:build --buildType monday_code_cdn --customUrl=/` (the CLI resolves "/" to the version's current CDN base). Used by monday-cicd's dev-live detach. | incident-verified 2026-07-07 |
| A server-side (`monday-code`) `code:push` can exit 1 with **"Deployment in progress: building-app [FAILED: Unexpected error occurred while communicating with the remote server]"** while the remote build CONTINUES and succeeds — the error is in the CLI's status-polling loop, not the deployment. A red exit is NOT proof of failure: check `mapps code:status -i <APP_VERSION_ID>` (walks `building-app` → `deploying-app` → `successful`, took ~10 min total). Re-pushing while the build is in flight fails fast with the SAME generic error — wait for a terminal status before any retry/fix-forward. Verified on sync-calender draft 15902356 (docs-only trigger, both GH-Actions run and rerun red, deploy succeeded). | incident-verified 2026-07-12 |
| The pre-first-deploy ordering trap covers **`code:env` too, with a WORSE error**: `code:secret` fails with the clear "No monday code release found", but `code:env -m set` on a never-deployed app fails with an opaque **HTTP 400 "malformed syntax or missing request header"** (and `-m list-keys` prints nothing, exit 0). Nothing is wrong with the command — deploy once, then set env. Verified on Telemetry Dashboard 11729905 (fresh app, no deploys). | incident-verified 2026-07-19 |
| `update_app_lifecycle_subscription` on a feature of a **live** app version fails 403 "Lifecycle subscriptions cannot be modified for live app versions" — register on the **draft** version's feature id instead; the subscriptions take effect when that draft is promoted. `get_app_lifecycle_subscriptions(app_id)` shows only the ACTIVE version's subscriptions — pass `version_id: <draft>` to see draft registrations. | incident-verified 2026-07-19 |
| The lifecycle `event_type` server enum DIFFERS from the docs: `AppFeatureObject` also has `hard_delete` and `multiple_duplicate` (11 values total). The full live list comes back in the "Invalid enum value. Expected …" error — probe with an invalid value to re-derive. | live-probed 2026-07-19 |
| `app-features:build -t monday_code` with NO url ALSO drops into the interactive "Add your route to monday-code base url" prompt (same trap as `monday_code_cdn`) — pass `--customUrl=/` to bind the feature to the service base URL. | incident-verified 2026-07-19 |
| **`app-version:list` silently returns only the 7 MOST RECENT versions** and has no `--limit`/pagination flag (its only flag is `-i`). Verified simultaneously on three apps that each have more than 7: Planner (v16→v10), Tracker (v25→v19), Meetings (v10→v4) — all exactly 7 rows; apps with fewer (Team People 4, Status Email 6, Sync Calendar 1) return their true count, so 7 is a cap, not a coincidence. There is no "no older versions exist" signal — a deprecated version you are looking for can simply be absent. Older versions are visible only in the Developer Center. | live-probed 2026-08-05 |
| **The GraphQL `app.versions` field is NOT a workaround for that cap — it returns ONLY the live version.** Probed on Planner 10787117 with `API-Version: 2026-10`: `app(id:) { versions { id status } }` returned a single `{13082844, LIVE}` while the CLI listed 7 versions including the draft. **`ask_developer_docs` explicitly claims this field "retrieve[s] all versions of an app" — that answer is WRONG**, a live reminder that the docs oracle is a starting point and the probe is the verdict (see `docs-lookup.md` trust protocol). To find a DRAFT version id the CLI remains the only programmatic path. | live-probed 2026-08-05 |
| **`mapps init -l/--local` writes `.mappsrc` — containing the raw access token — into the CURRENT working directory**, not `~/.config/mapps`. Run inside a repo it drops a plaintext token in the worktree; `.mappsrc` was NOT in this repo's `.gitignore` until 2026-08-05 (now added). Always use plain `mapps init -t` (user-scoped config) and never `-l` inside a repo. | `--help` verified 2026-08-05 |
| **`manifest:import` carries two flags the public docs omit:** `-m/--allowMissingVariables` ("Allow missing variables") and template-variable substitution in the manifest — the command's own summary is "Import manifest with **optional template variables**", while section 2 below documents only `-p`. Also confirmed: `-a/--appId` is annotated in `--help` as "(will create a new draft version)", which is the CLI itself stating the draft-creation behaviour recorded above. | `--help` verified 2026-08-05 |
| **`AppFeatureStatusColumn` and `AppFeatureDialog` are real feature types that the documented `app-features:create` type list below does NOT include** — both are live in TwystYourStatus's exported manifest (status column at `schemaVersion: "7"`, two dialogs at `schemaVersion: "1"`). Treat section 2's type list as incomplete, not exhaustive. A status column hosts its dialogs through a `relations` array (`type: "hosting"`, `target.slug`, `name`) rather than through its own `build` — the dialogs carry the `build.url`/`build.kind`, the column carries the wiring. | manifest-verified 2026-08-05 |
| `manifest:export -a <id> -p ./<name>` re-confirmed to create a DIRECTORY `./<name>/manifest.json`, and to run a server-side validation pass first ("Validate app before exporting manifest" → "The app is valid for export") — so a failed export can mean an INVALID app, not a bad command. | re-verified 2026-08-05 |
| **`mapps init -t ""` (empty/unset token) drops into an interactive "Please enter your monday.com api access token" prompt that reads stdin** — with no TTY (any hook, any CI, any headless script) it hangs until something kills it; reproduced with a 6s timeout that never returned control. It does NOT fail fast and does NOT clobber an existing `.mappsrc` while stuck (the file is untouched until the prompt resolves) — but a scripted/hook call that doesn't guard the token is a silent hang, not a clean no-op. Always gate any scripted `mapps init -t "$VAR"` on `[ -n "$VAR" ]` first. This is what the repo's `SessionStart` hook in `.claude/settings.json` does (auto-inits from `$MONDAY_TOKEN` where an environment provides it, no-ops otherwise). | incident-verified 2026-08-05 |
| **`mapps tunnel:create` CANNOT work from a cloud session — but a tunnel CAN.** Two separate obstacles: the sandbox egress gateway MITMs port 443 and the CLI's Rust `ngrok-rs` component pins its own CA and ignores `NODE_EXTRA_CA_CERTS` (`failed to connect session: tls handshake error`); trusting the gateway CA via `SessionBuilder.caCert()` then fails differently because the gateway is an L7 HTTP proxy and ngrok's session protocol is not HTTP (`failed to deserialize rpc response`). **Fixing only the first looks like progress and is still dead.** The working path routes ngrok through the EXPLICIT `$HTTPS_PROXY` CONNECT proxy (which does pass raw TCP) via a local forwarder + a `/etc/hosts` entry that keeps SNI on the real hostname — `scripts/cloud-tunnel.mjs`. Also note the sandbox moves under you: the agent proxy restarted on a new port AND `/etc/hosts` was regenerated mid-session, the latter making ngrok **hang forever with no error**. Full procedure, incl. the same-origin backend trap that silently invalidates testing: **`references/cloud-tunnel.md`**. | live-verified 2026-08-07, twyst-your-status 11775054 |
| CLI subcommands never invent themselves: for any unfamiliar flag, run `mapps <cmd> --help` or `ask_developer_docs` FIRST. Never guess flags. | rule |

### App id vs version id per subcommand (verified live 4.10.8)

| Subcommand | Takes APP id | Takes VERSION id |
|---|---|---|
| `app:promote` | `-a/--appId` | `-i/--appVersionId` |
| `app-version:list` | `-i/--appId` (yes, `-i` means APP id here) | — |
| `app-version:builds` | — | `-i/--appVersionId` |
| `app-features:list` / `create` / `build` | `-a/--appId` | `-i/--appVersionId` (+ `-d/--appFeatureId` for build) |
| `code:push` | `-a/--appId` | or `-i/--appVersionId` (either) |
| `code:status` | — | `-i/--appVersionId` only |
| `code:logs` | — | `-i/--appVersionId` only |
| `code:report` | — | `-i/--appVersionId` |
| `code:env` / `code:secret` | `-i/--appId` (yes, `-i` means APP id here) | — |
| `scheduler:*` | `-a/--appId` | — |
| `storage:*` | `-a/--appId` (+ `-c/--clientAccountId`) | — |
| `manifest:export` | `-a/--appId` (exports live version) | `-a/--appId -i/--appVersionId` (specific version; current CLI still requires app id) |
| `tunnel:create` | `-a/--appId` (+ `-p/--port`, default 8080) | — |
| `database:connection-string` | `-a/--appId` | — |

The `-i` flag is NOT consistent across subcommands — it means app id in
`app-version:list` and `code:env`/`code:secret`, but version id in
`code:status`/`code:logs`/`code:push`. Check the table; do not pattern-match.

### Version lifecycle reality

- There is no CLI command to create a new app version. `code:push` to a live-only
  app creates/updates the draft implicitly; otherwise versions are managed in the
  Developer Center.
- Single-live-version apps: build → `code:push --force` (via ship.sh) is the whole
  cycle. `app:promote` is only relevant for apps with a separate draft version.

---

## 2. FETCHED REFERENCE (refresh target — may be rewritten by the 30-day refresh)

_Source: https://developer.monday.com/apps/docs/command-line-interface-cli — reconciled with live `--help` of 4.10.8 on 2026-07-02._

### Installation & setup

```bash
npm install -g @mondaycom/apps-cli
mapps init -t <SECRET_TOKEN>      # writes ~/.config/mapps/.mappsrc (never cat it)
```

Global flags (any command): `--print-command`, `--verbose`.
Region flag where supported: `-z/--region` `us|eu|au|il`.

### api

- `mapps api:generate` — prepares environment for custom query development. Run from project root.

### app

- `mapps app:create -n <NAME> [-d <TARGET_DIR>]`
- `mapps app:deploy` — deploy using manifest file: `-a`, `-d/--directoryPath`, `-v/--appVersionId`, `-f/--force`, `-z`
- `mapps app:list` — list all apps (find app ids)
- `mapps app:promote -a <APP_ID> -i <APP_VERSION_ID>`
- `mapps app:scaffold [DEST] [TEMPLATE] [-c <npm-script>] [-s <signingSecret>]`

### app-features

- `mapps app-features:list -a <APP_ID> -i <APP_VERSION_ID>`
- `mapps app-features:create -a <APP_ID> -i <APP_VERSION_ID> -n <NAME> -t <TYPE>`
  - Types include: AppFeatureBoardView, AppFeatureItemView, AppFeatureDashboardWidget,
    AppFeatureWorkspaceView, AppFeatureItemMenuAction, AppFeatureItemBatchAction,
    AppFeatureGroupMenuAction, AppFeatureObject, AppFeatureIntegration,
    AppFeatureAiBoardMainMenuHeader, AppFeatureAiDocQuickStart, AppFeatureAiDocTopBar,
    AppFeatureAiDocSlashCommand, AppFeatureDocActions, AppFeatureProductView
- `mapps app-features:build -a <APP_ID> -i <APP_VERSION_ID> -d <APP_FEATURE_ID> -t custom_url|monday_code|monday_code_cdn -u <CUSTOM_URL>`

### app-version

- `mapps app-version:list -i <APP_ID>`
- `mapps app-version:builds -i <APP_VERSION_ID>`

### code

- `mapps code:push [-a <APP_ID> | -i <APP_VERSION_ID>] [-d <BUILD_DIR>] [-c/--client-side] [-f/--force] [-s/--security-scan] [-z]`
  — `--client-side` uploads to CDN (requires index.html at the pushed directory root).
  **Use `scripts/ship.sh`, not this directly** (a PreToolUse hook blocks raw pushes).
- `mapps code:status -i <APP_VERSION_ID>`
- `mapps code:logs -i <APP_VERSION_ID> -t http|console -s live|History [-r <regex>] [-f "MM/DD/YYYY HH:mm"] [-e "MM/DD/YYYY HH:mm"]`
- `mapps code:env -i <APP_ID> -m list-keys|set|delete [-k <KEY>] [-v <VALUE>]`
- `mapps code:secret -i <APP_ID> -m list-keys|set|delete [-k <KEY>] [-v <VALUE>]`
- `mapps code:report -i <APP_VERSION_ID> [-o -d <OUTPUT_DIR>]`

### scheduler (monday-code apps only)

- `mapps scheduler:list -a <APP_ID>`
- `mapps scheduler:create -a <APP_ID> -n <NAME(no spaces)> -s "<cron UTC>" -e "<endpoint>" [-d <desc>] [-r <maxRetries>] [-b <minBackoffSec>] [-t <timeoutSec>]`
  — endpoint is relative to `/mndy-cronjob/<YOUR_ENDPOINT>`; targetUrl flag is `-e` (live-verified).
- `mapps scheduler:run -a <APP_ID> -n <NAME>`
- `mapps scheduler:update -a <APP_ID> -n <NAME> [same flags as create]`
- `mapps scheduler:delete -a <APP_ID> -n <NAME>` — GATED: ask the user once before deleting.

### storage

- `mapps storage:search -a <APP_ID> -c <CLIENT_ACCOUNT_ID> -t <TERM>`
- `mapps storage:export -a <APP_ID> -c <CLIENT_ACCOUNT_ID> [-d <FILE_DIR>] [-f CSV|JSON]`
- `mapps storage:remove-data -a <APP_ID> -c <CLIENT_ACCOUNT_ID> [-f]` — GATED: ask the user once; never pass `-f` unprompted.

### manifest

- `mapps manifest:export -a <APP_ID> [-i <APP_VERSION_ID>] [-p <PATH>]` — `-a` alone exports the live version.
- `mapps manifest:import -p <PATH> [-a <APP_ID>] [-i <APP_VERSION_ID>] [-n/--newApp] [-m/--allowMissingVariables]`

### database

- `mapps database:connection-string -a <APP_ID>`

### tunnel / utility

- `mapps tunnel:create -p <PORT> -a <APP_ID>` (port defaults to 8080)
  - **From a cloud session this command cannot connect** — use
    `node .claude/skills/mapps/scripts/cloud-tunnel.mjs` (env: `TUNNEL_APP_ID`,
    `TUNNEL_PORT`) and read `references/cloud-tunnel.md` first.
- `mapps init -t <TOKEN> [-l/--local]`
- `mapps help <topic> [-n/--nested-commands]`
- `mapps autocomplete zsh|bash|powershell [-r]`

| `code:push` (server) SWALLOWS the real failure reason — the command's catch logs it at DEBUG only and exits 1 with nothing printed. Always pass `--verbose` in CI push steps; it enables the CLI debug logger (incl. the archive's "paths to ignore" list). | incident-verified 2026-07-15, deadline-confirm runs 29369678605 (silent) vs 29386525549 (verbose) |
| The monday-code buildpack runs `npm install` + `npm run build` INSIDE /workspace: a vite-built admin SPA is REBUILT remotely, so `public/admin/` (or any build output) need not ship in the tarball — but the CLIENT SOURCES MUST (excluding `src/client/` fails the remote build with a rollup entry error). This is why sync-calender's gitignored `public/admin/` still serves in production. | incident-verified 2026-07-15 |
| `code:push` archive excludes honor `.mappsignore` first, else the app dir's `.gitignore` (recursive glob, first match), plus built-in `node_modules/**`; patterns are validated against existing paths only. Verified via `--verbose` debug lines (`ignore_files_for_archive`). | source-read + log-verified 2026-07-15 |

| monday code exposes TWO urls: the per-deploy **Version URL** (`e47e2-service-…`) and the static **Live URL** (`live1-service-…`). `code:status -i <VERSION_ID>` always shows the Version URL and grows a SECOND url column with the Live URL once it exists. The Live URL is minted by the FIRST promotion to live (docs-consistent; on deadline-confirm it appeared right after v1 was promoted in the dev center) and serves the LIVE version's deployment. AUTH CONFIG RULE: production OAuth redirect + BASE_URL + feature URLs point at `live1-…` (never changes); draft-phase testing against a not-yet-live app must use the Version URL + the `app_version_id` authorize param (OAuth config is PER VERSION — editing redirect/scopes on a draft does not affect what live validates). | live-verified 2026-07-15, app 11704868 |

| **apps-sdk SecureStorage wraps PRIMITIVES** (production monday-code only, sdk 0.1.4 source-verified): `set(key, "str")` stores `{value:"str"}` and `get` returns the WRAPPER verbatim — stored strings (oauth tokens, link secrets) come back as objects, Authorization headers become `[object Object]`, and everything downstream 401s while looking "stored correctly". The local secure-storage shim does NOT wrap, so tunnel/local testing masks it completely. Fix pattern: unwrap `{value:X}` (single-key objects only) in the app's storage adapter. Objects/arrays round-trip untouched. | incident-verified 2026-07-15, deadline-confirm draft |

| **SecureStorage scoping ≠ Storage scoping**: `Storage` is segregated per accountId+app automatically; `SecureStorage` is segregated PER APP ONLY — all accounts of one deployment share its namespace. Multi-tenant on SecureStorage therefore requires manual key namespacing by account id (`${accountId}:key`) — monday's own multitenancy best-practice (account/user ids are the only platform-unique keys). Limits (docs, secure storage section): 7 req/s concurrency across the deployment, 1 write/s per key; no documented key-length/value-size cap (regular Storage: 256-char key, 6MB value). The shared 7 req/s pool — not key layout — is the real multi-tenant scaling ceiling. | docs-verified 2026-07-15 (ask_developer_docs), deadline-confirm design review |
