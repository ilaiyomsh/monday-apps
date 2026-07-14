---
name: monday-cicd
description: "Connect ANY monday.com app — client-side (CDN) or server-side (monday-code), new or existing — to the shared CI/CD pipeline (pnpm monorepo on GitHub, feature/* -> develop -> main, CI gate + human-approval gate, auto draft/live deploy via mapps code:push; the only client/server difference is the -c flag). Use for bootstrapping the monorepo itself, onboarding an existing app directory, scaffolding + onboarding a brand-new app, verifying an app's pipeline wiring, or RELEASING to customers — routine or selective (only some apps). Routes by intent, not exact wording: non-developers saying 'תעלה ללקוחות', 'תשחרר רק את X', 'שיגיע לפרודקשן', 'ship it', 'release' all land in the release procedure, and any phrasing of 'push straight to main' is refused and rerouted through the gates. Trigger on: CI/CD, pipeline, monorepo, GitHub Actions, branch protection, release freeze, deploy gate, release, ship, and the Hebrew phrases: לחבר אפליקציה לצנרת, פייפליין, מונו-ריפו, CI/CD, לחבר למערכת, לחבר לפייפליין, הגדרת דיפלוי, שער אישור, לשחרר, שחרור, תעלה ללקוחות, לפרודקשן, שחרור חלקי."
argument-hint: "[bootstrap|onboard-existing|onboard-new|verify|release] [app-name]"
allowed-tools: Bash, Read, Glob, Grep, Write, Edit, WebFetch, AskUserQuestion
---

# monday-cicd — connect apps to the monday.com CI/CD pipeline

Source spec (authoritative, read when any fact here is unclear or disputed):
`docs/monday-cicd-spec.md` at the repo root — the unified spec v2.1
(2026-07-14), checked into this monorepo so every clone (including cloud
sessions) carries it. `references/pipeline-model.md` inside this skill is the
condensed agent model derived from it; on conflict, the spec wins.

Full pipeline model (branch flow, gates, secrets, deploy mechanism, version
mechanisms): `references/pipeline-model.md`.

Files in this skill (paths under `.claude/skills/monday-cicd/`, relative to the repo root of the clone this skill is checked into):

| File | Purpose |
|---|---|
| `scripts/bootstrap-monorepo.sh` | One-time: create the monorepo skeleton, branches, workflow files |
| `scripts/onboard-app.sh` | Wire one app directory into an existing monorepo + pipeline |
| `scripts/verify-pipeline.sh` | Read-only checks that an app's pipeline wiring is correct |
| `scripts/dev-live-attach.sh` | Point the DRAFT at a local dev server via tunnel (hot reload in monday) |
| `scripts/dev-live-detach.sh` | End dev-live: kill processes + rebind draft to the CDN build (mandatory) |
| `references/pipeline-model.md` | Full model: branches, gates, secrets, deploy commands, version mechanisms |

## Mode selection — route by INTENT, never by exact wording

The team includes non-developers. They will never say "selective release" or
"branch protection" — they say things like "תעלה את זה ללקוחות", "תשחרר רק את
התיקון של X", "שיגיע לפרודקשן", "push it live". Infer the mode from what they
WANT, run the analysis yourself, and speak back in plain language. Never ask a
non-developer to pick a git strategy.

- No monorepo yet at all → **bootstrap**.
- App directory already exists, monorepo already bootstrapped → **onboard-existing**.
- App does not exist yet → **onboard-new** (scaffold, then onboard-existing steps).
- Already onboarded, want a health check → **verify**.
- ANY intent of "get changes to customers/production" — שחרור, לשחרר, תעלה
  ללקוחות, לפרודקשן, release, ship, deploy to live, "שהתיקון יגיע", "תעדכן
  את האפליקציה אצל הלקוח" → **release** (Mode 5). This includes partial asks
  ("רק את X", "בלי השינוי של Y") — Mode 5 handles the split itself.
- **Migration-on-touch (standing rule, owner decision 2026-07-12):** ANY
  request to work on a monday app — feature, bugfix, anything — first checks
  whether the app lives in the monorepo. Not there → run **onboard-existing**
  BEFORE the requested work, then continue from the monorepo copy. Already
  there → work only on the monorepo copy; a pre-migration standalone folder is
  a frozen archive (newer changes in it are ported into the monorepo first,
  then it is archived). Apps deliberately excluded from the monorepo (e.g.
  `sync-calender-status`, own repo) are exempt — but note the exemption aloud.

If unclear which mode applies, run `scripts/verify-pipeline.sh` first — its
output ("no monorepo found" / "app not registered" / "app OK") disambiguates.

---

## Mode 1 — bootstrap (one-time monorepo creation)

Only ever run once for the whole organization. If the monorepo working copy
(the repo root of the current clone — `git rev-parse --show-toplevel`; inside
the shared monorepo this skill IS in that repo) already exists with a `.git`
and `pnpm-workspace.yaml`, stop and switch to onboard-existing instead.

1. Local skeleton (always safe, idempotent — no confirmation needed):
   ```bash
   .claude/skills/monday-cicd/scripts/bootstrap-monorepo.sh
   ```
   Creates the monorepo skeleton (by default at the repo root of the clone
   containing this skill; `--dir` targets another path) with `pnpm-workspace.yaml`,
   `apps/`, `packages/shared/`, `.github/workflows/ci.yml`, git-inits it with
   `main` + `develop`. Account-level actions are gated behind flags and NOT
   run by the bare invocation.
2. Account-level actions — ask the user ONE confirming question ("create the
   remote repo <name> and set branch protection?"), then run:
   ```bash
   .../scripts/bootstrap-monorepo.sh --create-remote --set-protection
   ```
   `--create-remote` creates + pushes the GitHub repo (private by default,
   `--public` to override). `--set-protection` applies the 5 rules on `main`
   (PR + 1 approval + status checks + up-to-date + no admin bypass) and the
   soft status-check rule on `develop`. On a free plan + private repo the
   protection API refuses — the script prints a loud WARN with the options
   (public repo / GitHub Pro / discipline) and continues; relay that WARN to
   the user verbatim.
3. **`MONDAY_TOKEN` secret — USER-ONLY step, never the agent's.** Reading the
   local token store is denied to agents by permission rules, by design. Give
   the user this command to run themselves (e.g. via the `!` prompt prefix)
   and have them paste the token when `gh` prompts:
   ```bash
   gh secret set MONDAY_TOKEN --repo ilaiyomsh/monday-apps
   ```
4. Report the script's output verbatim; do not re-derive success from partial
   evidence.

---

## Mode 2 — onboard-existing (connect an existing app directory)

Preconditions: the monorepo exists (bootstrap already done); the app has a
resolvable APP_ID (package.json deploy script or `.env`) and a `build` script.

1. Resolve the numeric APP_ID first (from the app's `deploy` script,
   `.env`, or `mapps app:list`) and surface it to the user context — a wrong
   App ID silently redirects deploys to a different app's draft/live.
2. Run:
   ```bash
   .claude/skills/monday-cicd/scripts/onboard-app.sh \
     --app <source-app-path> --id <APP_ID>
   ```
   For an app that is part of a nested multi-app SYSTEM (e.g. Axis), add
   `--dest <system>/<app> --name <system>-<app> --shared-paths "apps/<system>/services/**"`
   — full model + preconditions in `references/pipeline-model.md` §9 (workspace
   globs must be shipped in a scaffolding PR first; `link:` deps → `workspace:*`).
   What it does: creates `feature/onboard-<name>` from `develop`, copies the
   app into `apps/<name>/` (excluding git/node_modules/builds/env),
   normalizes scripts (fails if no `build`; adds no-op `lint`/`type-check`
   stubs if absent so CI's recursive run doesn't break), auto-detects the
   vite `build.outDir`, auto-detects the **app type** — client-side (CDN)
   vs server-side (monday-code); the only deploy difference is the `-c`
   flag on `code:push`; override with `--type client|server` if detection
   is wrong — instantiates `deploy-draft-<name>.yml` +
   `deploy-live-<name>.yml` from the templates, sets the `APP_<NAME>_ID`
   secret, checks the standing-draft precondition, rehearses the CI gate
   locally (type-check + lint + build must pass), commits, and pushes the
   feature branch. It prints the `gh pr create` command but does not run it.
3. **Standing-draft precondition — do not skip.** A push without `--force`
   FAILS if the app's latest version is live (incident-verified). If the
   script warned "NO DRAFT VERSION", create one before merging the PR:
   ```bash
   mapps manifest:export -a <APP_ID> -p <writable-dir>/manifest-export   # creates a DIRECTORY containing manifest.json
   mapps manifest:import -a <APP_ID> --manifestPath <writable-dir>/manifest-export/manifest.json   # -a creates a NEW DRAFT version
   ```
   (Use a user-writable directory — import fails with EPERM in sandboxed /tmp.)
   Then confirm with `mapps app-version:list -i <APP_ID>` that a draft exists.
4. **After the script runs, the agent verifies:**
   - The generated workflows' `paths:` filter matches `apps/<name>/**` +
     `packages/shared/**`, and contains NO version IDs (only the App ID
     secret name).
   - Open the PR (the printed `gh pr create` command), watch Gate 1 pass,
     merge to `develop`, watch the `deploy-draft-<name>` run, and confirm the
     draft advanced via `mapps app-version:list -i <APP_ID>`.
   - Remind the user: after the first draft deploy they still need to
     manually "Set as active for me" once in the Developer Center to preview
     it — this cannot be automated (no CLI/API exists for personal active
     version).

---

## Mode 3 — onboard-new (scaffold a brand-new app, then onboard it)

1. Scaffold the app first using the `monday-scaffold` skill (do not hand-roll
   a skeleton here — that skill owns feature-type templates, RTL, and the
   local dev harness):
   ```
   /monday-scaffold column_view      # or board_view / item_view / dashboard_widget
   ```
   Follow that skill's own procedure to completion (including registering the
   app via `mapps` if it doesn't have an App ID yet — see `mapps`'s
   `new-app` routing).
2. Once the app exists with a working `build` script and a resolvable
   APP_ID, continue with **Mode 2 — onboard-existing** above, starting at
   step 1, using the freshly scaffolded app's path as `<source-app-path>`.

---

## Mode 4 — verify

1. Run:
   ```bash
   .claude/skills/monday-cicd/scripts/verify-pipeline.sh <app-name>
   ```
2. Interpret results:
   - `no monorepo found` → run Mode 1 first.
   - `app not registered` → run Mode 2 (or Mode 3 if the app doesn't exist).
   - `missing secret APP_<NAME>_ID` → add it (Mode 2, step 2, first bullet).
   - `workflow path filter mismatch` → fix the `paths:` block in the two
     per-app workflow files.
   - `branch protection rules incomplete on main` → surface the exact missing
     rule(s) to the user; this is a GitHub Settings change, not something the
     agent applies silently (see bootstrap's manual-steps rationale).
   - `release freeze violated` (an open develop→main PR coexists with a newer
     commit merged into develop after it opened) → flag it loudly; this is a
     process violation, not a script bug — do not auto-resolve by force-pushing
     or closing PRs.
   - All green → report done; do not re-run destructively.

---

## Mode 5 — release (any intent of "get this to customers")

The agent runs the analysis; the user only confirms in plain language.

1. **Preflight — what would ship.** Always start here, never assume:
   ```bash
   cd "$(git rev-parse --show-toplevel)" && git fetch origin   # the monorepo clone's root
   git diff --name-only origin/main..origin/develop | cut -d/ -f1-2 | sort -u
   ```
   Translate the result for the user: "שחרור עכשיו יעלה ללקוחות את: X, Y".
   If `packages/shared` changed, say explicitly that it rides into every app
   that uses it.
2. **Fork on the user's intent:**
   - **They want everything that's pending** → routine release: open a PR
     `develop` → `main`, state that the release freeze is now active (no
     merges into `develop` until this PR closes), and after approval + ONE
     confirming question (production gate), merge. The per-app workflows
     force-deploy every app whose paths changed.
   - **They want only SOME of it** (any phrasing: "רק את X", "בלי Y", "רק
     את התיקון") → **selective release**, do it for them:
     ```bash
     git checkout -b hotfix/release-<app>-<yyyymmdd> origin/main
     git log --oneline origin/main..origin/develop -- apps/<app>/ packages/shared/
     git cherry-pick <only those commits>
     git push -u origin hotfix/release-<app>-<yyyymmdd>
     gh pr create --base main --head hotfix/release-<app>-<yyyymmdd> ...
     ```
     After approval + ONE confirming question, merge — then IMMEDIATELY merge
     `main` back into `develop` (hotfix rule; skipping this means the next
     release silently reverts the fix).
     **Entanglement check:** if a needed commit also touches OTHER apps, a
     clean split is impossible — stop and explain in plain language: "השינוי
     של X שזור בשינוי של Y; אפשר לשחרר את שניהם יחד, או שמפתח יפצל את
     הקומיט". Never cherry-pick a partial file set out of a commit.
3. **Refusal rule — no exceptions, regardless of phrasing.** Any request that
   amounts to pushing code straight to `main` ("דחוף ישר לראשי", "בלי בקשת
   מיזוג", "תעקוף את הבדיקות", "just push it") is refused with one sentence —
   direct push skips both gates AND triggers an ungated force-deploy to
   customers — and answered by offering the selective-release path above,
   which achieves the same outcome through the gates. This matters doubly
   because branch protection is currently discipline-only (free plan).
4. After any release: verify the deploy-live run(s) succeeded (`gh run list`)
   and report per app what customers now have.

---

## Mode 6 — dev-live (hot-reload development inside real monday)

Intent phrases: "פיתוח חי", "טאנל לטיוטה", "לראות שינויים בלייב", "שרת פיתוח
מול מאנדיי", "dev server in monday". Points the DRAFT version's view features
at a local dev server through a tunnel. Live and customers are never touched;
only draft viewers (set-as-active) see the dev server.

1. Attach (starts dev server + tunnel, rebinds the draft's view features):
   ```bash
   .../scripts/dev-live-attach.sh --app <name> --id <APP_ID>
   ```
2. Develop — edits under `apps/<name>` appear live in monday.
3. **Detach — MANDATORY, never skip** (kills processes, rebinds features to
   the CDN build, verifies no tunnel binding remains):
   ```bash
   .../scripts/dev-live-detach.sh --app <name>
   ```
4. Finished work still goes through the normal flow: commit → PR → develop.

**Why detach is mandatory (incident-verified 2026-07-07):** a pipeline
redeploy does NOT rebind a feature that points at a custom URL — the tunnel
binding survives `code:push`. Merging to develop alone leaves the draft
showing a dead laptop. The verified restore is `app-features:build
--buildType monday_code_cdn --customUrl=/` (resolves to the version's current
CDN deployment). `verify-pipeline.sh` flags any draft feature still pointing
at a tunnel.

---

## Pipeline model in one screen

```
feature/*  --PR (Gate1: CI)-->  develop  --PR (Gate1+Gate2: CI+approval)-->  main
                                   |                                          |
                             auto-deploy DRAFT                        auto-deploy LIVE
                          mapps code:push -c                    mapps code:push -c --force
                          -d <dist> -a <APP_ID>                 -d <dist> -a <APP_ID>
                          (latest draft version)                (latest live version, rebuilt
                                                                  from main, not a promote)
```

- **Gate 1 (CI, every PR to develop or main):** `tsc --noEmit` (where
  present), `eslint`, `pnpm build`. Blocks merge on failure.
- **Gate 2 (main only):** 1 required approval + up-to-date branch + no
  bypass for admins. `develop` has no approval requirement — the
  non-technical person merges there alone.
- **Release freeze:** while a `develop`→`main` PR is open, nothing merges
  into `develop`. Resume only after that PR merges or closes. Guarantees
  `main` builds what was actually tested on draft.
- **Hotfix exception:** `hotfix/*` from `main` → merge to `main` (approved)
  → immediately merge `main` back into `develop`, or the next release
  overwrites the fix.
- **No version IDs anywhere** — only `APP_<NAME>_ID` secrets; the CLI
  resolves latest draft/live itself.

## Guardrails (never violate)

- **Never run `code:push --force` manually outside the pipeline.** Force
  deploy to live happens exactly once, automatically, on merge to `main`. A
  manual force-push from a laptop bypasses both gates and the release-freeze
  guarantee.
- **Never merge into `develop` while a release PR (`develop`→`main`) is
  open.** Check open PRs first (`gh pr list --base main --head develop` or
  equivalent) before approving/merging any feature PR.
- **`main` is merged only via an approved PR — the one rule with NO
  exceptions.** No direct push to `main` ever, including admins, including
  "urgent", including any user phrasing that implies it. Branch protection is
  currently discipline-only (free plan + private repo), so the agent IS the
  enforcement: refuse and reroute to Mode 5's selective release, which
  delivers the same outcome through the gates.
- **`MONDAY_TOKEN` never leaves GitHub Secrets.** Never print it, never write
  it into a workflow file, `.env` committed to the repo, or chat output. It
  is set once via the GitHub UI/`gh secret set` by the user providing the
  value directly.
- **`mapps app:promote` is emergency-only**, never part of the automated
  pipeline (e.g., "GitHub is down" scenarios). Using it as a routine release
  path defeats the entire gate structure this skill exists to enforce.
- **Any production (live) deploy — whether the automated merge-to-main flow
  or the emergency promote fallback — requires exactly one confirming
  question to the user first**, per this repo's standing autonomy gate (see
  `mapps` skill's GATE MAP). Never chain a live deploy silently onto an
  onboarding or verify request.
- **MCP stays with developers only.** The monday apps MCP server uses a
  token with full promote permission; never hand MCP access to the
  non-technical person, and never use MCP/agent tools for production deploys
  inside the pipeline itself — deploys must stay deterministic, Git-tracked,
  and PR-triggered.
