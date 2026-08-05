# Cleanup workflow — twyst-your-status only

A staged, multi-agent code cleanup under human gates. Deterministic scanners (knip, jscpd,
eslint) find candidates; LLM subagents only **verify** findings, **judge** gray areas, and
**execute** approved batches. Tests are the ground truth. Every batch is one revertable
commit. A human approves the plan between stages. Zero behaviour change, ever.

**Scope: `apps/twyst-your-status`, and nothing else.** That is not a convention here, it is
enforced: `scripts/cleanup/guard-protected-paths.sh` runs as a `PreToolUse` hook on the
`cleanup-executor` agent and blocks any edit outside the app (38 fixtures cover it —
`bash scripts/cleanup/guard-protected-paths.test.sh`). Onboarding a second app means a
second copy of `cleanup-env.sh` with its own `APP_DIR`, never widening these globs.

## The three commands

```bash
bash scripts/cleanup/baseline.sh     # Stage 0 — branch, green gate, metrics snapshot
/cleanup-audit                       # Stage 1 — scan → verify → judge → CLEANUP_PLAN.md
                                     # 🚪 human sets batches to status: approved
/cleanup-execute                     # Stage 2 — one commit per batch, full gate between
                                     # 🚪 human reviews the commits
/cleanup-verify                      # Stage 3 — clean-install gate, metrics, adversarial review
```

`/cleanup-audit` takes an optional target inside the app —
`/cleanup-audit {"target":"apps/twyst-your-status/src/components/OnClickDialog"}`.
**Pilot one subdirectory on the first run** to calibrate noise and cost.
`/cleanup-execute` takes an optional `{"batches":[1,3]}` to narrow the selection; it can
never widen it past what a human approved.

## What lives where

| Path | Role |
|---|---|
| `scripts/cleanup/cleanup-env.sh` | single source of truth: the app, the commands, the gate, pinned scanner versions |
| `scripts/cleanup/baseline.sh` | Stage 0. Branch rules, green gate, metrics → `.cleanup/baseline.json` |
| `scripts/cleanup/guard-protected-paths.sh` | `PreToolUse` scope guard (the executor's frontmatter attaches it) |
| `scripts/cleanup/guard-protected-paths.test.sh` | 38 fixtures for the guard — a guard that stops blocking looks exactly like one that passed |
| `scripts/cleanup/post-edit-format.sh` | `PostToolUse` per-workspace `eslint --fix`. **No prettier** — see below |
| `scripts/cleanup/prompts/*.md` | the three stage contracts (documentation + hand-run fallback) |
| `.claude/agents/cleanup-*.md` | scanner, verifier, auditor, executor, reviewer |
| `.claude/workflows/cleanup-{audit,execute,verify}.js` | the saved workflows the slash commands run |
| `apps/twyst-your-status/knip.jsonc` + `server/knip.jsonc` | per-workspace scanner config |
| `apps/twyst-your-status/.cleanup/` | runtime state: `baseline.json`, `CLEANUP_PLAN.md`, `CLEANUP_REPORT.md`, `audit/`, `raw/` (gitignored) |

## How this differs from the upstream cleanup package

Every deviation is a monorepo fact, not a preference:

- **pnpm, not npm.** `pnpm install --frozen-lockfile`, `pnpm --filter <path> …`,
  `pnpm remove --filter …`. Never npm/yarn (CLAUDE.md toolchain rule).
- **Two workspaces, one app.** The SPA (`apps/twyst-your-status`) and the guard server
  (`apps/twyst-your-status/server`) are separate pnpm workspaces with different eslint
  majors (8 legacy config vs 9 flat), so every scanner and gate step runs twice, per
  workspace, through that workspace's own config.
- **No `tsc` step.** Both workspaces are plain JavaScript; the app's `type-check` script is
  `echo no-typescript`. The gate keeps a typecheck slot anyway, so the day TypeScript
  arrives it is already covered.
- **The gate is this repo's blocking CI set, narrowed to this app**, not just
  build+test: `error-wiring-audit.mjs` (twyst-your-status is two surfaces in it),
  `eager-graph.mjs` (`@vibe/core` must never be statically reachable from `src/index.jsx`),
  and `@mapps/error-kit`'s drift suite (which imports the server's vendored sink
  directly). A cleanup can break any of these without a single test going red.
- **No prettier.** This repo has none, so running it would reformat whole files to
  prettier's defaults and bury the one-line deletion a batch was supposed to be. The
  post-edit hook runs each workspace's own `eslint --fix` instead.
- **Tests are never edited, at all.** test-guard locks test files repo-wide and the cleanup
  guard blocks them, so `TEST_ONLY` findings are non-actionable here — removing a test-only
  symbol needs a separate, human-owned change.
- **The error/observability boot layer is off-limits** (`src/utils/{logger,globalErrorHandler,
  axiomLoggerAdapter}.js`, `src/hooks/useUiErrorSink.js`, `src/components/ErrorBoundary/**`,
  `server/src/helpers/{logger,process-guards,axiomServerSink}.js`). knip cannot see that
  those exports are reached from the platform or from another package's tests, so every
  "unused" finding there is a false positive with an outage behind it.
- **Scanners run via `pnpm dlx` at pinned versions** (`knip@5.88.1`, `jscpd@4.2.5`) instead
  of being added as devDependencies: no lockfile churn, and no dev-only tool landing in the
  redeploy path of an app whose deploy triggers on `apps/twyst-your-status/**`.
- **Branch rules replace the package's `cleanup/<date>` branch.** `baseline.sh` refuses
  `main`, creates `feature/cleanup-twyst-your-status-<date>` from `develop`, and otherwise
  stays on the current `feature/*`, `claude/*` or `hotfix/*` branch.
- **Commit format follows the repo:** `chore(twyst-your-status): cleanup <category> —
  <title> [batch-N]`, not `chore(cleanup): …`.
- **`cloc` is gone.** LOC is `git ls-files` + `wc -l` over non-test source — one less
  network dependency, gitignore-aware by construction.

## Hard safety rules (override any operator shortcut)

1. Red gate → full stop. Never "fix the test to make it pass" during cleanup.
2. Stage 1 is read-only for source. Writes only under `.cleanup/`.
3. Stage 2 executes **only** `approved` batches, exactly as written. Scope creep is a bug.
4. `UNCERTAIN` is never deleted.
5. Edit batches never run in parallel.
6. Protected paths are never edited. The guard prints the reason; that reason IS the answer.
7. One category per batch, one batch per commit. Never push from a workflow — the push and
   the PR into `develop` are human decisions (exactly one confirming question), and a
   release freeze may be in effect (`gh pr list --base main`).
8. No deploys, ever, from any stage. Deploys happen only on GitHub Actions runners
   (CLAUDE.md golden rule 2); merging the PR is what deploys the draft.

## Troubleshooting

- **Agent not found** → `.claude/agents/` was created after the session started; restart
  Claude Code so the five agents load.
- **Hook did not fire** → workspace trust not granted, or `scripts/cleanup/*.sh` lost `+x`.
  Verify with `bash scripts/cleanup/guard-protected-paths.test.sh`.
- **`jq: command not found`** → the guard and `baseline.sh` fail closed on purpose. Install jq.
- **knip flags an obviously-used file** → fix the entry points in that workspace's
  `knip.jsonc` before trusting any audit output. Note that knip's own hint
  "`server` — remove from ignoreWorkspaces" is wrong: dropping that line puts phantom
  unlisted dependencies from `server/tests/**` into the SPA report (verified 2026-08-05).
- **knip exits 1** → that means it HAS findings. It is a report, not a failure.
- **A run pauses on a shell permission prompt** → the command is missing from
  `permissions.allow` in `.claude/settings.json`; add it and resume.
