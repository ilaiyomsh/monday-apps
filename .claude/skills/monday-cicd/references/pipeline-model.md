# CI/CD Pipeline Model — monday.com client-side apps

Condensed operating model for agents. Source of truth: `monday-cicd-spec-en.md` at the project root (the root of the project the session runs in; dated 2026-07-07). Load this file when SKILL.md's summary is not enough depth.

## Differences from the written spec
None. This file mirrors the spec exactly.

## 1. Decision Table

| Topic | Decision |
|---|---|
| Repo | Single monorepo, all apps (`ilaiyomsh/monday-apps`; the local working copy is the repo root of the current clone — `git rev-parse --show-toplevel`) |
| monday env | One app per application, draft/live only — no separate dev app |
| Version isolation | Two standing versions (live, draft); deploys always target **latest** of each — no version-ID bookkeeping |
| Branching | `feature/*` → `develop` → `main` (Git Flow) |
| Deployment | Automated from GitHub Actions runner via CLI (not local `mapps`) |
| Release to live | Force deploy — merge to `main` rebuilds and pushes directly to live with `--force` |
| Non-tech person | Merges to `develop` freely; **never** to `main` |
| Quality gates | Gate 1 = CI (automated), Gate 2 = human approval (main only) |

## 2. Branch Model

```
feature/* --(PR, Gate1)--> develop --(PR, Gate1+Gate2)--> main
   ^ branched from develop           |                        |
   |                                 v                        v
   |                          auto-deploy DRAFT         auto-deploy LIVE (--force)
   |                                                           |
   +------------------- main merged back into develop ---------+  (hotfix only)
```

Rules:
- `develop` is always ≥ `main`, never behind.
- No direct push to `main` ever, including admins.
- Both `develop` and `main` are permanent branches, never deleted.
- **Release freeze**: while a `develop`→`main` PR is open, nothing merges into `develop`. Guarantees `main` builds exactly what was tested on draft. Resume feature merges only after the release PR is merged or closed.
- **Hotfix exception** (only downward flow): `hotfix/*` branches from `main` → PR merges to `main` (approved) → **immediately** merge `main` back into `develop`, else the next release overwrites the fix.

## 3. Two Standing Versions Model

Each app has exactly two live-in-monday version slots: **latest draft** and **latest live**. There is no third env, no per-feature version, no dev app.

- `mapps code:push -c` (no `--force`) → overwrites/advances the **latest draft** version.
- `mapps code:push -c --force` → pushes directly to the **latest live** version.
- **Client vs server apps:** `-c/--client-side` is used for client-side (CDN) apps only. Server-side (monday-code) apps use the exact same pipeline and commands **without** `-c` — that flag is the ONLY difference. `onboard-app.sh` auto-detects the type (deploy-script `--client-side` → client; `@mondaycom/apps-sdk` dep → server; default client), overridable with `--type`.
- Consequence: **no version IDs are ever stored** anywhere (not in secrets, not in workflow YAML, not in code) — only the App ID. The CLI resolves "latest draft" / "latest live" itself from the App ID.
- `--force` does **not** rebuild — the workflow must build first, then push the already-built dist dir.
- **Standing-draft precondition (incident-verified + live-docs-confirmed):** a push without `--force` FAILS when the app's latest version is live ("The latest app version is live... use --force"). The pipeline therefore requires a draft version to exist on top of live BEFORE the first deploy-draft run. No `app-version:create` CLI exists; create the draft with a manifest round-trip: `mapps manifest:export -a <APP_ID> -p ./mdir` (creates a **directory** containing `manifest.json`) then `mapps manifest:import -a <APP_ID> --manifestPath ./mdir/manifest.json` (import with `-a` explicitly creates a new draft version; run from a user-writable dir — sandboxed /tmp gives EPERM), or Developer Center → App versions → New version. `onboard-app.sh` checks this and warns.

## 4. Exact Deploy Commands

**Draft** (triggered on push to `develop`, per-app path filter):
```
npm install -g @mondaycom/apps-cli
mapps init -t "$MONDAY_TOKEN"          # non-interactive CI auth; no env-var auth exists
mapps code:push -c -d apps/<app>/<dist> -a "$APP_ID"
```
env: `MONDAY_TOKEN: ${{ secrets.MONDAY_TOKEN }}`, `APP_ID: ${{ secrets.APP_<NAME>_ID }}`

**Live / release** (triggered on push to `main`, same per-app path filter): identical, plus `--force` on the push.

Both workflows share: `checkout@v4` → `pnpm/action-setup@v4` (pnpm 10, must match the major that wrote the lockfile) → `setup-node@v4` (node 20, pnpm cache) → `pnpm install --frozen-lockfile` → `pnpm --filter ./apps/<app> build` (path-based filter — immune to package-name/dir-name mismatches) → deploy step above.

Build-dir flag (`-d`) must match the app's actual build output dir (e.g. Vite's `build.outDir`) — do not assume `dist`; check per app.

Manual/emergency fallback only, **not** part of the pipeline: `mapps app:promote -a <APP_ID> -i <VERSION_ID>` (used e.g. when GitHub is down).

**Red deploy run ≠ failed deploy (server-side apps, incident-verified 2026-07-12):** on monday-code pushes the CLI's wait-loop can exit 1 with "Deployment in progress: building-app [FAILED: Unexpected error occurred while communicating with the remote server]" while the remote build keeps running and SUCCEEDS (~10 min end-to-end). Before rerunning the workflow or fixing forward, check the truth: `mapps app-version:list -i <APP_ID>` → `mapps code:status -i <VERSION_ID>` (`building-app` → `deploying-app` → `successful`). A rerun while the build is in flight fails fast with the same generic error. (Seen on axis-sync-calender draft after the gateway-PR merge.)

## 5. Gate Definitions

**Gate 1 — CI** (`ci.yml`, `pull_request: branches: [develop, main]`, blocks merge on failure):
- `pnpm -r type-check` (`tsc --noEmit`, only where the app has TypeScript)
- `pnpm -r lint` (eslint)
- `pnpm -r build`
- Steps: checkout → `pnpm/action-setup@v4` (pnpm 10, matching §4) → `setup-node@v4` (node 20, pnpm cache) → `pnpm install --frozen-lockfile` → the three checks above.
- A second, NON-BLOCKING `tests` job runs `pnpm -r --if-present run test` for visibility only (owner decision 2026-07-12); it never fails the check while the tracker known-red baseline (FOLLOW-UPS F1) stands.

**Gate 2 — branch protection on `main`** (5 rules, GitHub → Settings → Branches):
1. Require a pull request before merging (no direct push, incl. admins)
2. Require approvals: **1**
3. Require status checks to pass (CI: type-check + lint + build)
4. Require branches to be up to date before merging
5. Do not allow bypassing the above settings (applies to admins)

**Soft rule on `develop`**: require status checks to pass (CI) only — no approval requirement, so the non-technical person merges independently.

Policy note: keep the approval gate on `main` for ~2 months until trust is established with the non-technical contributor; revisit after.

**Enforcement status (decided 2026-07-07):** the repo is private on a free GitHub plan, so branch protection is NOT technically enforced — the user chose **discipline for now** over making the repo public or upgrading. Consequence: Gate 2 exists as process only; agents must treat the `main`-only-via-approved-PR rule as absolute even though GitHub won't block a violation. Revisit when the second developer or the non-technical person joins (that was the user's own criterion).

## 6. Secrets Table

| Secret | Purpose |
|---|---|
| `MONDAY_TOKEN` | Deploy-permission token; security-critical; never exposed to fork PRs |
| `APP_<NAME>_ID` (one per app) | App ID; CLI resolves latest draft/live itself; no version IDs ever stored |

All secrets live in GitHub Secrets (Settings → Secrets and variables → Actions) only, never in code. App IDs are discoverable via `mapps app:list` or the Developer Center. The non-technical person never holds `MONDAY_TOKEN` locally — the runner executes deploys after their PR is approved.

## 7. Version Mechanisms (three, do not conflate)

1. **Promote (draft→live)** — global, affects all customers. Has CLI/API/action but is **not used by the pipeline**; manual/emergency path only.
2. **Active Version ("Set as active for me")** — per-developer personal setting, no customer/collaborator impact. Manual click only (Manage → App versions → Actions "⋮" → "Set as active for me"). **Cannot be automated** — no CLI/API exists, tied to browser session/specific user; an agent cannot do this on the user's behalf.
3. **Gradual Release** — exposes a version to a defined account group before full release; short preview cycles, not permanent; requires ≥1 existing live version.

Mitigation for active-version friction (reduction of need, not automation): fix a single draft version and set it active once — the switch is needed only when comparing live vs draft. Prefer Gradual Release over manual active-version switching when the real goal is exposing to a beta/test account.

MCP usage rule: monday apps MCP uses the existing API token; an agent can do only what the token permits.
- Inside the pipeline: never use agent/MCP for production deploys — must stay deterministic, Git-tracked, PR-triggered (Gate 2 stays rigid).
- Outside the pipeline: MCP is fine for ad-hoc queries / emergency promote ("which version is live", "promote app-c, GitHub is down").
- Security: MCP token carries full promote permission → MCP stays with developers only, never given to the non-technical person (would bypass all gates).

## 8a. Release Semantics in a Monorepo (routine vs selective)

The release unit is the BRANCH STATE, not an app: a `develop`→`main` PR merges everything develop accumulated, and every per-app deploy-live workflow whose paths changed fires. Git cannot merge a subdirectory.

- **Routine release** ships every app changed since the last release. Fine whenever develop is "always releasable" (the model's rule: features merge into develop only after draft testing).
- **Selective release** ("only app X, develop has other stuff too"): `hotfix/release-<app>-<date>` from `main` → cherry-pick ONLY the commits touching `apps/<app>/` (+ `packages/shared/` if needed) → PR to `main` → approve/merge → **immediately merge `main` back into `develop`**. Same outcome as a direct push, with both gates intact.
- **Entangled commits** (one commit touches several apps) cannot be split by cherry-pick — release together or have a developer split the commit. Never partial-file cherry-pick.
- **Direct push to `main` is never the answer** — it skips CI + approval AND fires an ungated force-deploy to customers. With protection currently discipline-only, the agent is the enforcement layer.
- Frequent need for selective releases is a smell: develop stopped being always-releasable. Fix the merge discipline, not the release mechanism.

## 8b. Dev-Live (tunnel to the draft) — verified behaviors

Inner dev loop: draft view features rebound to a local dev server through `mapps tunnel:create -p <port> -a <appId>` (stable per-app tunnel URL, long-running process). Scope of exposure: only draft viewers; live/customers untouched.

Verified facts (2026-07-07, probed on discussions draft v6):
- Rebind: `app-features:build --appId --appVersionId --appFeatureId --buildType custom_url --customUrl=<tunnel-url>` — long-form `--customUrl=` REQUIRED (short `-u <url>` errors).
- **A pipeline redeploy does NOT clear the custom-url binding** — merging to develop is not enough to restore the draft. Detach must rebind explicitly.
- Restore: `--buildType monday_code_cdn --customUrl=/` — the CLI resolves "/" to the version's current CDN deployment. (`monday_code_cdn` with NO url hangs on an interactive prompt — always pass the flag.)
- `verify-pipeline.sh` fails an app whose draft feature still points at `apps-tunnel` (forgotten detach).

## 8. End-to-End Flow

1. Open `feature/change-x` from `develop` (dev or Claude Code for non-tech person).
2. Code + commit + push to feature branch.
3. PR → `develop`: Gate 1 (CI) runs; pass → auto-deploy to draft.
4. Test draft (set as active version for tester); verify no regression.
5. Merge to `develop` — non-technical person can do this alone.
6. Accumulate more features, or proceed to release.
7. PR → `main`: Gate 2 (developer approval) required. **Release freeze begins** — no merges into `develop` until this PR is merged/closed.
8. Merge to `main` → auto build + **force deploy** to live.
9. Customers receive the new version.

## 9. Nested multi-app systems (added 2026-07-07, first consumer: Axis)

A "system" is a directory of several apps sharing internal service packages
(e.g. Axis: planner / tracker / day-off / sync-calender + Services/axis-app-core).
Layout in the monorepo: `apps/<system>/<app>` per app, shared code under
`apps/<system>/services/<pkg>`, system docs under `apps/<system>/docs`.

- `onboard-app.sh` flags: `--dest <system>/<app>` (target path),
  `--name <system>-<app>` (workflow filenames, job names, secret name),
  `--shared-paths "apps/<system>/services/**"` (appended to the default
  `packages/shared/**` trigger).
- **Together and separately:** each app's two workflows trigger on its own
  `apps/<system>/<app>/**` (separately) AND on the system's services globs
  (together — one core change deploys every app of the system).
- **Precondition (script enforces, fails loudly):** the monorepo's
  `pnpm-workspace.yaml` must already contain the nested globs
  (`apps/<system>/*`, `apps/<system>/services/*`) — ship them in a
  scaffolding PR before the first app onboarding. A missing glob means CI
  "passes" while never building the app.
- `link:` dependencies between a system's apps and its service packages must
  be converted to `workspace:*` during onboarding (rsync copies the
  package.json verbatim; the local `link:../Services/...` path no longer
  exists inside the monorepo).
- Secret naming stays flat: `APP_AXIS_PLANNER_ID` (from `--name axis-planner`).
