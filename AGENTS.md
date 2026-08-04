# monday-apps — agent entry point (Codex and other AGENTS.md agents)

Read this first, on every branch. **Then read [`CLAUDE.md`](./CLAUDE.md)** — it is
the full repo-wide rule set, and this file does not replace it. What lives here is
the Codex-facing entry point: the non-negotiables inline (so you cannot miss them),
plus the two things Codex handles differently from Claude Code — skill loading and
hook coverage.

**This repo:** pnpm-workspace monorepo of monday.com apps — client-side (CDN) and
server-side (monday-code) — wired to one CI/CD pipeline.

**Authority chain (higher wins on conflict):**
1. `CLAUDE.md` — repo-wide rules. This file mirrors its rules; on any drift,
   `CLAUDE.md` is right and this file is the bug.
2. `.claude/skills/monday-cicd/references/pipeline-model.md` — the pipeline spec.
3. `.claude/skills/` — the in-repo skill copies (authoritative for this repo).
4. Per-app `CLAUDE.md` / `README.md` — app-internal facts only.

**Toolchain (CI-pinned, match it locally):** Node 20, pnpm 10. Install with
`pnpm install` at the root; the committed lockfile must stay current (CI runs
`--frozen-lockfile`). Never npm/yarn — tracker's postinstall needs pnpm.

## Skills are not auto-loaded — open them yourself

Claude Code selects skills from their descriptions automatically. **Codex does
not.** The methodology this repo runs on lives in `.claude/skills/<name>/SKILL.md`
(reachable as `.codex/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md`
— the same directory, symlinked to Codex's project skill paths).

Before acting on a task, match it below and **read that `SKILL.md`** — plus any
file it points to under `references/`. Skipping this is the single most common way
an agent gets this repo wrong.

| Task touches | Read first |
|---|---|
| pipeline, release, deploy wiring, onboarding an app to the monorepo | `monday-cicd` |
| mapps CLI, tunnels, logs, versions, manifest, scopes, any monday API call | `mapps` |
| any code calling the monday API (GraphQL, column writes, pagination, webhooks) | `monday-api` |
| writing or changing tests | `test-guard` |
| any code with an error path | `error-guard` |
| logging, observability, Axiom, status hub | `add-to-status-hub`, `axiom-sre` |
| production incident, "why did it fall over", log triage | `axiom-sre` |
| new app / view / widget skeleton | `monday-scaffold`, `integration-scaffold` |
| boards, workspaces, seeding, demo setup | `monday-ops` |
| monday auth or OAuth | `monday-oauth` |

Full catalog with one-liners: `.claude/skills/README.md`. `test-guard` and
`error-guard` bind **every** change, not just their own topics.

## Enforcement under Codex — what fires and what is on you

The guards in `.claude/hooks/` are the physical layer behind the golden rules.
`.codex/hooks.json` wires the same scripts for Codex through
`.codex/hooks/codex-adapter.py`, which translates Codex's payload shape
(`tool_name: "shell"`, `command: ["bash","-lc",…]`, `apply_patch`) into the shape
those scripts expect. Setup and caveats: [`.codex/README.md`](./.codex/README.md).

- **Shell-command guards fire** once hooks are enabled: deploy-guard (blocks any
  local deploy), test-guard's file lock, the release-debt nudge.
- **File-edit guards may not fire.** Codex's `PreToolUse`/`PostToolUse` coverage
  for `apply_patch` is version-dependent. Treat **error-guard and test-guard as
  self-enforced**, and run the checker by hand on files you touch:
  `bash .claude/skills/error-guard/scripts/check.sh <file>`
- **If the hooks are not enabled at all, you are the entire enforcement layer.**
  Verify with `/hooks` in Codex. Either way the rules below bind.

## Golden rules (non-negotiable)

1. **Never push to `main`.** `main` is merged only via an approved PR from
   `develop`. Refuse ANY phrasing of "push straight to main" and reroute to the
   `monday-cicd` release procedure. Protection is discipline-only (free GitHub
   plan): **the agent IS the enforcement layer** — no hook will stop you.
2. **Deploys happen ONLY on GitHub Actions runners** — never from a laptop or
   sandbox. No exceptions, including emergencies. Never run `mapps code:push`,
   `ship.sh`, or `pnpm run deploy` from a machine.
3. **`MONDAY_TOKEN` is user-only.** Never read, print, set, or commit it. All
   agent-side monday API calls go through `.claude/skills/mapps/mapps-api.sh`.
4. **API probes and destructive tests run ONLY in the sandbox workspace**
   `TEST_WORKSPACE_ID=16291824`, scratch objects prefixed `WZ-`, minimal
   complexity (the budget is shared with production apps).
5. **Quality standards bind every change:** a test never seen failing does not
   count (`test-guard`); every catch logs, rethrows, or displays (`error-guard`).
   Never silence a rule — the hook message IS the fix.
6. **Migration-on-touch:** every piece of app work starts by checking that the app
   lives in this monorepo. Not here yet → onboard it FIRST (`monday-cicd`
   onboard-existing), then do the work here. Already here → work ONLY on the
   monorepo copy. No app work ever happens in a standalone copy of a pipeline app.

## Branch rules

- **Default branch is `develop`.** All work bases there.
- `feature/*` branches from `develop`; PR back into `develop` (CI gate). Naming:
  `feature/round{NN}-{slug}-{YYYYMMDD}` for app feature rounds,
  `feature/{purpose-slug}` for infra work.
- **Release freeze:** while a `develop` → `main` PR is open, nothing merges into
  `develop`. Check `gh pr list --base main` before merging any feature PR.
- **Hotfix:** `hotfix/*` from `main` → approved PR to `main` → IMMEDIATELY merge
  `main` back into `develop` (skipping this loses the fix at the next release).
- `develop` and `main` are permanent. Delete feature branches after merge.
- Commits: `type(app): subject` — e.g. `feat(discussions): round47 …`.

## Deploys — pipeline only

Merge to `develop` → app's latest **draft**. Merge to `main` → `--force` to latest
**live** (production). Workflows are `.github/workflows/deploy-{draft,live}-<slug>.yml`
per app plus one shared `ci.yml`. Build output dirs vary per app (`dist` / `build` /
app root) — **read the app's workflow file, never assume**. Shared-path fan-out:
`packages/shared/**` redeploys ALL apps; `apps/axis/services/**` redeploys the four
axis apps. Full detail — including the single emergency lever and the dev-live
tunnel detach rule — is in `CLAUDE.md` and the `monday-cicd` skill.

**GitHub Pages — a SECOND target, `docs-export` only.** `docs-export` publishes to
<https://ilaiyomsh.github.io/monday-apps/docs-export/> via
`.github/workflows/pages-docs-export.yml`, on push to `develop` under
`apps/docs-export/**`. It is additional to the monday CDN, not a replacement, and no
other app uses it. A repo gets exactly ONE Pages site, so the workflow stages each app
into its own subdirectory (`_site/<app>/`) rather than spending the whole site on one
app; the root is a small static index. `base: './'` in its `vite.config.js` is what
makes the bundle work at any depth — **never make it an absolute `/`**, which breaks
every asset outside the root. **`404.html` is honoured ONLY at the site root** — Pages
does not resolve a nearest-directory 404 (verified live), so the workflow writes the site
index there and no per-app 404 exists. Keep the path filter narrow: only this app's `dist`. It needs the repository's
Pages **Source = GitHub Actions** (a repo setting); with the legacy "Deploy from a
branch" source it builds the repo root as Jekyll and ignores the artifact. Sourcemaps
follow the CDN contract: `hidden`, archived 90 days by commit SHA, then deleted from
the publish dir with a check that fails the run if any `.map` survives.

Pages proves the bundle builds, loads and degrades correctly — it is **not** a usable
instance. Outside monday there is no context, so no board, no user, no ownership, and
the app correctly stops on its "not configured" surface. Drive it with `dev:mock` or a
real board view instead.

**`docs-export` is NOT on the CDN pipeline yet:** no `deploy-{draft,live}-docs-export.yml`,
no `APP_DOCS_EXPORT_ID` secret, and no `SURFACES` entry in
`scripts/error-wiring-audit.mjs` (its source IS scanned via `APP_SRC_DIRS`, but the
structural boot-wiring and `VITE_AXIOM_*` checks are not enforced for it). Merging to
`develop` updates Pages only; merging to `main` does nothing for it. Blocked on the
owner creating the app in the Developer Center and supplying the numeric App ID.

## Structure & app IDs

```
apps/discussions                    flat app (client, build/)
apps/team-people-column             flat app (client, dist/)
apps/deadline-confirm               flat app (server, app root)
apps/docs-export                    flat app (client, dist/) — GitHub Pages only,
                                    NOT on the CDN pipeline (see Deploys)
apps/axis/{planner,tracker,day-off,sync-calender}   nested system
apps/axis/services/{app-core,monday-api}            axis shared runtime code
packages/shared                     EMPTY STUB — do not add code there
```

| App | Path | App ID | Type / pushed dir |
|---|---|---|---|
| discussions | `apps/discussions` | 11457413 | client, `build/` |
| axis-planner | `apps/axis/planner` | 10787117 | client, `dist/` |
| axis-tracker | `apps/axis/tracker` | 10684862 | client, `build/` |
| axis-day-off | `apps/axis/day-off` | 11459177 | client, `dist/` |
| axis-sync-calender | `apps/axis/sync-calender` | 11666315 | server, app root |
| team-people-column | `apps/team-people-column` | 11689948 | client, `dist/` |
| deadline-confirm | `apps/deadline-confirm` | 11704868 | server, app root |
| telemetry-dashboard | `apps/telemetry-dashboard` | secret `APP_TELEMETRY_DASHBOARD_ID` set — numeric ID lives in the secret, not mirrored here (slug `telemetry-dashboard`) | server, app root |
| twyst-your-status | `apps/twyst-your-status` | secret `APP_TWYST_YOUR_STATUS_ID` set — numeric ID lives in the secret, not mirrored here (slug `twyst-your-status`) | server, `server/` app root; SPA served from `server/public` (round324 same-origin unification — one monday-code push, no CDN `-c`) |
| docs-export | `apps/docs-export` | **none yet** — no App ID, no secret, no deploy workflow; GitHub Pages only (slug `docs-export`) | client, `dist/` |

`docs-export` local dev: `pnpm --filter ./apps/docs-export dev:mock` on port **8304**
renders it OUTSIDE the monday iframe against `src/dev-harness/` — no token, no App ID
needed. Every app owns a distinct dev port so several can run at once. Board-view app,
RTL/Hebrew-first; `apps/docs-export/CLAUDE.md` holds the app-internal rules.

Real shared runtime code is `@axis/app-core` (`apps/axis/services/app-core`).
`packages/shared` is an empty stub no app imports — touching it redeploys all six
apps.

## Quality gates

- **CI (every PR into develop/main):** type-check → lint → build across the whole
  workspace (`pnpm -r --if-present`) — blocking. Tests run as a separate
  **non-blocking visibility job**; read its summary on the PR and treat any new red
  as yours until proven otherwise.
- **Known-red baseline:** tracker carries 2 deferred failing tests (FOLLOW-UPS F1).
  Not your breakage — do not "fix" them without the owner.
- **Onboarding-debt expiry:** any stubbed check must be logged in
  `apps/axis/docs/FOLLOW-UPS.md` with a re-enable plan. Standing debt: planner lint
  268, day-off lint 8.

## Error handling & observability

One unified standard, from catching an error to shipping it to Axiom:
**`docs/ERROR-AXIOM-STANDARD.md`** (authority: the `error-guard` skill). The canonical
shipping layer is **`packages/error-kit` (`@mapps/error-kit`)**; server apps and embedded
SPAs vendor a copy that `packages/error-kit/test/drift.test.ts` keeps in sync. Never a raw
fetch. Shared dataset `app-errors`, discriminated by `app`. CI enforces the wiring via
`scripts/error-wiring-audit.mjs` + the error-kit suite (both blocking).

**Axiom is not live until the owner activates it.** The wiring is complete and fail-soft, so a
missing token silently means "nothing ships" rather than a broken build. What is still
required — per surface, with commands and consequences — is tracked in
**`docs/ERROR-AXIOM-STANDARD.md` → "Activation status"**. Agents never set these; read that
section before concluding an app "isn't reporting errors".

To query/triage `app-errors`, use the `axiom-sre` skill:
**`.claude/skills/axiom-sre/reference/app-errors.md`**.

## Agent conduct

- `git commit` and changelog updates are always autonomous — asking is a failure.
  `git push`, production merge, membership grants, and destructive
  storage/scheduler operations each take exactly ONE confirming question, never
  chained silently.
- Never commit `.env` / `.env.*` — start from the root `.env.example`.
- A multi-point user message is itemized into a checklist, confirmed once, and
  answered in full — never silently drop a point.
- A platform quirk discovered while working is appended to the owning skill's
  `references/` in the same session.

## Maintaining this file

`AGENTS.md` and `CLAUDE.md` state the same rules for two different agents. **A PR
that changes a rule in one must change it in the other.** Keep both short: state
the rule, link the detail.
