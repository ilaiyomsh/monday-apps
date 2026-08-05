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
- `mapps init -t <TOKEN> [-l/--local]`
- `mapps help <topic> [-n/--nested-commands]`
- `mapps autocomplete zsh|bash|powershell [-r]`

| `code:push` (server) SWALLOWS the real failure reason — the command's catch logs it at DEBUG only and exits 1 with nothing printed. Always pass `--verbose` in CI push steps; it enables the CLI debug logger (incl. the archive's "paths to ignore" list). | incident-verified 2026-07-15, deadline-confirm runs 29369678605 (silent) vs 29386525549 (verbose) |
| The monday-code buildpack runs `npm install` + `npm run build` INSIDE /workspace: a vite-built admin SPA is REBUILT remotely, so `public/admin/` (or any build output) need not ship in the tarball — but the CLIENT SOURCES MUST (excluding `src/client/` fails the remote build with a rollup entry error). This is why sync-calender's gitignored `public/admin/` still serves in production. | incident-verified 2026-07-15 |
| `code:push` archive excludes honor `.mappsignore` first, else the app dir's `.gitignore` (recursive glob, first match), plus built-in `node_modules/**`; patterns are validated against existing paths only. Verified via `--verbose` debug lines (`ignore_files_for_archive`). | source-read + log-verified 2026-07-15 |

| monday code exposes TWO urls: the per-deploy **Version URL** (`e47e2-service-…`) and the static **Live URL** (`live1-service-…`). `code:status -i <VERSION_ID>` always shows the Version URL and grows a SECOND url column with the Live URL once it exists. The Live URL is minted by the FIRST promotion to live (docs-consistent; on deadline-confirm it appeared right after v1 was promoted in the dev center) and serves the LIVE version's deployment. AUTH CONFIG RULE: production OAuth redirect + BASE_URL + feature URLs point at `live1-…` (never changes); draft-phase testing against a not-yet-live app must use the Version URL + the `app_version_id` authorize param (OAuth config is PER VERSION — editing redirect/scopes on a draft does not affect what live validates). | live-verified 2026-07-15, app 11704868 |

| **apps-sdk SecureStorage wraps PRIMITIVES** (production monday-code only, sdk 0.1.4 source-verified): `set(key, "str")` stores `{value:"str"}` and `get` returns the WRAPPER verbatim — stored strings (oauth tokens, link secrets) come back as objects, Authorization headers become `[object Object]`, and everything downstream 401s while looking "stored correctly". The local secure-storage shim does NOT wrap, so tunnel/local testing masks it completely. Fix pattern: unwrap `{value:X}` (single-key objects only) in the app's storage adapter. Objects/arrays round-trip untouched. | incident-verified 2026-07-15, deadline-confirm draft |

| **SecureStorage scoping ≠ Storage scoping**: `Storage` is segregated per accountId+app automatically; `SecureStorage` is segregated PER APP ONLY — all accounts of one deployment share its namespace. Multi-tenant on SecureStorage therefore requires manual key namespacing by account id (`${accountId}:key`) — monday's own multitenancy best-practice (account/user ids are the only platform-unique keys). Limits (docs, secure storage section): 7 req/s concurrency across the deployment, 1 write/s per key; no documented key-length/value-size cap (regular Storage: 256-char key, 6MB value). The shared 7 req/s pool — not key layout — is the real multi-tenant scaling ceiling. | docs-verified 2026-07-15 (ask_developer_docs), deadline-confirm design review |
