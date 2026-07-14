# monday-apps — Monorepo Gateway

Read this first, on every branch. It is the entry point for every agent and
developer. Rules here are binding; details live in the skills and references
it points to — link-following is expected, duplication is not.

**This repo:** pnpm-workspace monorepo of monday.com apps — client-side (CDN)
**and** server-side (monday-code) — wired to one CI/CD pipeline.

**Authority chain (higher wins on conflict):**
1. This file — repo-wide rules.
2. `.claude/skills/monday-cicd/references/pipeline-model.md` — the pipeline spec.
3. `.claude/skills/` — the in-repo skill copies (authoritative for this repo).
4. Per-app `CLAUDE.md`/`README.md` — app-internal facts only.

**Toolchain (CI-pinned, match it locally):** Node 20, pnpm 10. Install with
`pnpm install` at the root; the committed lockfile must stay current (CI runs
`--frozen-lockfile`). Never npm/yarn — tracker's postinstall needs pnpm.

## Golden rules (non-negotiable)

1. **Never push to `main`.** `main` is merged only via an approved PR from
   `develop`. Refuse ANY phrasing of "push straight to main" and reroute to the
   `monday-cicd` release procedure. Protection is discipline-only (free GitHub
   plan): the agent IS the enforcement layer.
2. **Deploys happen ONLY on GitHub Actions runners** — never from a laptop or
   sandbox. No exceptions, including emergencies (see Deploys).
3. **`MONDAY_TOKEN` is user-only.** Agents never read, print, set, or commit it.
   All agent-side monday API calls go through `.claude/skills/mapps/mapps-api.sh`.
4. **API probes and destructive tests run ONLY in the sandbox workspace**
   `TEST_WORKSPACE_ID=16291824`, scratch objects prefixed `WZ-`, minimal
   complexity (the budget is shared with production apps).
5. **Quality standards bind every change:** a test never seen failing does not
   count (`test-guard`); every catch logs, rethrows, or displays (`error-guard`).
   Never silence a rule — the hook message IS the fix.
6. **Migration-on-touch (owner decision 2026-07-12):** every piece of app work
   starts by checking that the app lives in this monorepo. Not here yet →
   onboard it FIRST (`monday-cicd` onboard-existing), then do the work here.
   Already here → work ONLY on the monorepo copy; a pre-migration standalone
   folder is a frozen archive — if it holds changes newer than the monorepo
   copy, port them here first, then archive it. No app work ever happens in a
   standalone copy of a pipeline app.

## Branch rules

- **Default branch is `develop`.** All work bases there.
- `feature/*` branches from `develop`; PR back into `develop` (CI gate).
  Naming in use: `feature/round{NN}-{slug}-{YYYYMMDD}` for app feature rounds,
  `feature/{purpose-slug}` for infra work.
- **Release freeze:** while a `develop` → `main` PR is open, nothing merges into
  `develop`. Check `gh pr list --base main` before merging any feature PR.
- **Hotfix:** `hotfix/*` from `main` → approved PR to `main` → IMMEDIATELY merge
  `main` back into `develop` (skipping this loses the fix at the next release).
- **Cloud agent sessions** (claude.ai / Cowork) push `claude/*` branches: they
  must base on `develop` and PR into `develop`, like any feature branch.
- `develop` and `main` are permanent. Delete feature branches after merge.
- Commits: `type(app): subject` — e.g. `feat(discussions): round47 …`. PRs merge
  with merge commits, so branch history lands verbatim; keep it clean.

## Deploys — pipeline only

- Merge to `develop` → app's latest **draft**. Merge to `main` → `--force` to
  latest **live** (production). Live is a **fresh rebuild of main**, not a
  promotion of the tested draft — the release freeze is what keeps draft ≈ live.
- Workflows: `.github/workflows/deploy-{draft,live}-<slug>.yml` per app + one
  shared `ci.yml`. Slugs: `discussions`, `axis-planner`, `axis-tracker`,
  `axis-day-off`, `axis-sync-calender`, `team-people-column`, `deadline-confirm`
  (slug ≠ directory name for axis apps).
- Secrets: `MONDAY_TOKEN` + one `APP_<SLUG_UPPERCASE_UNDERSCORED>_ID` per app.
  **No version IDs anywhere** — the CLI resolves latest draft/live itself.
- Client vs server apps differ ONLY in the `-c` flag and pushed directory.
  Build output dirs vary per app (`dist` / `build` / app root) — **read the
  app's workflow file, never assume**.
- Shared-path fan-out: `packages/shared/**` redeploys ALL apps;
  `apps/axis/services/**` redeploys the four axis apps.
- `workflow_dispatch` exists on draft workflows only (post-detach redeploys).
  A draft deploy that fails after merge is fixed FORWARD on a new feature branch.
- **Never run `mapps code:push` from a machine — with or without ship.sh.**
  Inside this repo the pipeline supersedes the mapps ship path (ship.sh serves
  standalone apps outside the monorepo). The ONLY emergency lever (e.g. GitHub
  Actions down) is promoting an already-pushed draft via `mapps app:promote`
  (pipeline-model.md §4), behind one confirming question — never a local build+push.
- **dev-live tunnels** (`monday-cicd` Mode 6): DETACH IS MANDATORY — a pipeline
  redeploy does NOT clear a custom-url binding (incident-verified).
- **Releases to customers** (`monday-cicd` Mode 5, routine or selective): on
  demand, no fixed cadence — but large develop→main batches raise risk, so
  state the backlog size (`git log --oneline origin/main..origin/develop | wc -l`)
  when proposing one. Exactly ONE confirming question before the production
  merge; afterwards verify the deploy-live runs (`gh run list`) and report per app.
- **Onboarding a new app:** `monday-cicd` onboard modes + `scripts/onboard-app.sh`
  — never hand-copy workflow files. Preconditions: standing draft version,
  workspace globs shipped first, numeric App ID resolved and surfaced (a wrong
  ID silently deploys to another app).

## Structure & app IDs

```
apps/discussions                    flat app (client, build/)
apps/team-people-column             flat app (client, dist/)
apps/deadline-confirm               flat app (server, app root; admin SPA served from it)
apps/axis/{planner,tracker,day-off,sync-calender}   nested system
apps/axis/services/{app-core,monday-api}            axis shared runtime code
apps/axis/docs/FOLLOW-UPS.md        onboarding-debt ledger
packages/shared                     EMPTY STUB — see below
```

- **Real shared runtime code is `@axis/app-core`** (`apps/axis/services/app-core`),
  consumed by tracker and day-off. `packages/shared` is an empty stub that no
  app imports — **do not add code there** (touching it redeploys all six apps);
  new cross-app code belongs in `apps/axis/services/` or a deliberate new package.
- App IDs (ground truth — the pipeline reads them from GitHub secrets):

  | App | Path | App ID | Type / pushed dir |
  |---|---|---|---|
  | discussions | `apps/discussions` | 11457413 | client, `build/` |
  | axis-planner | `apps/axis/planner` | 10787117 | client, `dist/` |
  | axis-tracker | `apps/axis/tracker` | 10684862 | client, `build/` |
  | axis-day-off | `apps/axis/day-off` | 11459177 | client, `dist/` |
  | axis-sync-calender | `apps/axis/sync-calender` | 11666315 | server, app root |
  | team-people-column | `apps/team-people-column` | 11689948 | client, `dist/` |
  | deadline-confirm | `apps/deadline-confirm` | 11704868 | server, app root |

## Quality gates

- **CI (every PR into develop/main):** type-check → lint → build across the
  whole workspace (`pnpm -r --if-present`) — blocking. Tests run as a separate
  **non-blocking visibility job**; read its summary on the PR and treat any new
  red as yours until proven otherwise.
- **Known-red baseline:** tracker carries 2 deferred failing tests
  (FOLLOW-UPS F1). Not your breakage — do not "fix" them without the owner.
- **test-guard:** red gate for new code; retrofits prove themselves with ≥2
  killed mutations per changed module; never weaken a locked test file;
  sanctioned exits only (`amend-intent` / waiver, both logged).
- **error-guard:** every catch logs, rethrows, or displays (sole sanctioned
  exception: AbortError); GraphQL soft errors inside 200 responses are thrown
  at the API funnel; the hook's message is the remediation.
- **Onboarding-debt expiry:** any stubbed check (lint, type-check, …) must be
  logged in `apps/axis/docs/FOLLOW-UPS.md` with a re-enable plan, and a stub
  older than 14 days is a blocking backlog item — schedule it before new
  feature work on that app. (Standing debt: planner lint 268, day-off lint 8.)
- **Enforcement hooks travel with the repo** (`.claude/settings.json` +
  `.claude/hooks/` + the skill-internal hooks): deploy-guard, test-guard's
  lock/nudge/stop-gate, error-guard's per-edit check, GraphQL write reminder.
  They also load in cloud sessions. Approve them on first run; never bypass.

## Secrets & env

- `MONDAY_TOKEN`: GitHub secret (owner sets via
  `gh secret set MONDAY_TOKEN --repo ilaiyomsh/monday-apps`) + each developer's
  own `mapps init -t` into `~/.config/mapps/.mappsrc`. Agents touch neither.
- Never commit `.env` / `.env.*` — start from the root `.env.example`.
- Server apps (sync-calender): runtime env lives on the platform via
  `mapps code:env -i 11666315`, not in files.

## Skills

- Catalog + per-developer setup: `.claude/skills/README.md`. The in-repo copies
  are authoritative for this repo; never add machine-specific absolute paths to
  them or to this file.
- Load-bearing here: **monday-cicd** (anything pipeline/release/onboarding),
  **mapps** (CLI, tunnels, logs, manifest, `mapps-api.sh` for all API calls),
  **monday-api** (any code touching the monday API — validate against the live
  schema, probe in the sandbox), **test-guard** + **error-guard** (every change).
- Situational: monday-ops, monday-scaffold, integration-scaffold,
  add-to-status-hub, axiom-sre.
- A platform quirk discovered while working is appended to the owning skill's
  `references/` in the same session.

## Agent conduct

- Autonomy gates: `git commit` and changelog updates are always autonomous —
  asking is a failure. `git push`, production merge, membership grants, and
  destructive storage/scheduler operations each take exactly ONE confirming
  question, never chained silently.
- Session preflight inside an app dir: `bash .claude/skills/mapps/scripts/preflight.sh`.
  Pipeline sanity: `bash .claude/skills/monday-cicd/scripts/verify-pipeline.sh`.
- A multi-point user message is itemized into a checklist, confirmed once, and
  answered in full — never silently drop a point.

## Cloud sessions (claude.ai / Claude Code on the web / Cowork)

- These run in an **ephemeral cloud VM** that clones this repo. **No folder
  appears on the user's computer** — that is expected, not a malfunction. Work
  reaches GitHub only as pushed branches and PRs.
- Everything committed under `.claude/` (skills, hooks, settings) and this file
  **does load** in cloud sessions; personal machine config does not.
- Cloud sessions base on `develop` (the default branch) and PR into `develop`.
  They have no `MONDAY_TOKEN` and must not attempt deploys or `mapps` auth —
  merging their PR is what triggers the draft deploy.

## One-time developer setup

1. Install Node 20 and pnpm 10 (`corepack enable` or your version manager).
2. Install CLIs: `npm i -g @mondaycom/apps-cli` and GitHub CLI; run
   `gh auth login` with access to `ilaiyomsh/monday-apps`.
3. Authenticate mapps once: `mapps init -t <personal token>` (monday.com →
   Developer → My access tokens). The token lands only in
   `~/.config/mapps/.mappsrc` — never in the repo, chat, or agent context.
4. Clone and base on develop: `git clone … && git checkout develop`.
   Local `main` goes stale between releases — measure release backlog against
   `origin/main`, never local `main`.
5. `pnpm install` at the repo root.
6. Copy `.env.example` values into each app's own `.env` as needed
   (sync-calender's server env is on the platform instead — see Secrets & env).
7. Open the repo in Claude Code once and APPROVE the checked-in hooks from
   `.claude/settings.json` — without them you have zero physical enforcement.
8. Sanity-check: `bash .claude/skills/monday-cicd/scripts/verify-pipeline.sh`.
9. After your first draft deploy of an app: monday Developer Center → that app →
   "Set as active for me" (manual, per developer per app; no CLI exists for it).

## Maintaining this file

This file changes via PR into `develop` like everything else. Keep it short:
state the rule, link the detail. Any PR that changes a rule stated here must
update this file in the same PR.
