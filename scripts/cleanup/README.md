# Cleanup workflow — registered apps only (twyst-your-status, discussions)

A staged, multi-agent code cleanup under human gates. Deterministic scanners (knip, jscpd,
eslint) find candidates; LLM subagents only **verify** findings, **judge** gray areas, and
**execute** approved batches. Tests are the ground truth. Every batch is one revertable
commit. A human approves the plan between stages. Zero behaviour change, ever.

**Scope: exactly ONE registered app per run, never a union.** `CLEANUP_APP` (default
`twyst-your-status`) selects the app's env file under `scripts/cleanup/env/<app>.sh`; the
dispatcher (`cleanup-env.sh`) refuses an unregistered name FAIL-CLOSED — on both guard
surfaces an unknown app blocks everything. The scope is enforced on **both** write surfaces
of the per-app executor agents (`cleanup-executor`, `cleanup-executor-discussions`) —
`Edit|Write|MultiEdit` through `guard-protected-paths.sh`, and `Bash` through
`guard-bash-ops.py` — both delegating to the one decision function in `lib-path-verdict.sh`,
which reads the active app's allowlist AND its protected boot-layer list from the env file.
133 fixtures cover them, including the cross-app isolation cases (under
`CLEANUP_APP=discussions` the twyst tree closes): `bash scripts/cleanup/guard-protected-paths.test.sh`.

**Onboarding app N+1** (exactly what the discussions onboarding did):
1. `scripts/cleanup/env/<app>.sh` — the app's facts: dirs, filters, gate commands, bundle
   dir (read the deploy workflow — `dist/` vs `build/`), protected boot-layer files. A
   client-only app leaves `CLEANUP_SRV_*` EMPTY and every consumer skips the server half.
   Watch the test script: if `test` is a watch-mode alias, point the env at `test:run`.
2. Register the app: the `case` line in `cleanup-env.sh` + the `APPS` tables in the three
   workflows + a per-app executor agent (`.claude/agents/cleanup-executor-<app>.md`, same
   body, hooks prefixed `CLEANUP_APP=<app>`).
3. `apps/<app>/knip.jsonc` — entry points, and the app's vite aliases under `"paths"`
   (knip resolves aliases from ITS config, not vite's — a missing alias makes every module
   reached through it a phantom "unused file").
4. Extend `guard-protected-paths.test.sh` with the new app's cases FIRST, then run
   `CLEANUP_APP=<app> bash scripts/cleanup/baseline.sh` — `lint-config-audit.sh` will
   refuse an app whose eslint cannot see a dangling identifier; fix the app's lint config
   before anything else (discussions only needed `react/jsx-no-undef` added).

> The Bash half was **missing** from the first version of this package, and a pre-approval
> refutation pass is what found it: a dead-file batch deletes with `rm`, which no Edit hook
> can see, so the most destructive operation in the whole workflow was the one operation the
> scope guard never inspected. Nothing failed while the hole was open — an unenforced guard
> looks exactly like a guard that passed. If you extend this package, extend the fixtures
> first.

## The 2026-08-07 redesign — every discipline rule that failed became a mechanism

The first full run (shipped as 3.15.3) worked, but its two blocking findings and its
costliest manual work all traced to rules that lived in prose. Each is now a script with
an exit code; the run history that motivated each one is in the script's own header.

| failure in the real run | mechanism now |
|---|---|
| An agent wrote `status: approved` (953f8ce); the whole approval chain was agent-authored | `guard-approval-word.sh` — repo-wide PreToolUse hook (all sessions, both write surfaces): no agent tool call can introduce the word. Fixtures: `guard-approval-word.test.sh` |
| …and nothing at execute time checked who wrote it | `verify-approval.sh` — `git blame` on every approved line; a Claude author, a Claude trailer, or an uncommitted edit fails custody. The execute workflow aborts on it |
| A-structure-07 silently skipped; batch 7 still flipped to `done` | per-finding `- disposition:` bullets written by the executor + `reconcile-plan.sh` as gate step 0 — a batch with an unaccounted finding cannot go green, and stage 3 re-audits all done batches |
| The SPA lint could not see a dangling identifier, so the reviewer hand-scanned 41 files and two findings were struck for un-catchable `ReferenceError`s | the SPA config now holds `no-undef`/`no-unused-vars` + `react/jsx-uses-vars`/`jsx-no-undef`; `lint-config-audit.sh` fails any gate whose effective config loses them again |
| The re-baseline nearly ran on Node 22 (container default) vs CI's Node 20 | `check-toolchain.sh` — Node/pnpm majors pinned in `cleanup-env.sh`, enforced as a precondition and a gate step |
| jscpd's default `--max-lines 1000` silently skipped the 1,352-line `ColumnSettings.jsx` — the single biggest cleanup target was absent from the baseline scan | `--max-lines 5000` pinned in `CLEANUP_JSCPD_ARGS` |
| Every audit re-verified the same boot-layer false positives (8 exports + 1 file, every run) | `@public` JSDoc tags on the guard-protected boot-layer exports (knip drops them at the source) + `useUiErrorSink.js` as a knip entry — the scanner report now equals the actionable space |

## The three commands

```bash
bash scripts/cleanup/baseline.sh     # Stage 0 — branch, green gate, metrics snapshot
/cleanup-audit                       # Stage 1 — scan → verify → judge → CLEANUP_PLAN.md
                                     # 🚪 human sets batches to status: approved
/cleanup-execute                     # Stage 2 — one commit per batch, full gate between
                                     # 🚪 human reviews the commits
/cleanup-verify                      # Stage 3 — clean-install gate, metrics, adversarial review
```

For an app other than the default, select it everywhere the same way:

```bash
CLEANUP_APP=discussions bash scripts/cleanup/baseline.sh
/cleanup-audit  {"app":"discussions"}          # + optional "target" as usual
/cleanup-execute {"app":"discussions"}         # + optional "batches"
/cleanup-verify {"app":"discussions"}
```

`/cleanup-audit` takes an optional target inside the app —
`/cleanup-audit {"target":"apps/twyst-your-status/src/components/OnClickDialog"}`.
**Pilot one subdirectory on the first run** to calibrate noise and cost.
`/cleanup-execute` takes an optional `{"batches":[1,3]}` to narrow the selection; it can
never widen it past what a human approved.

## What lives where

| Path | Role |
|---|---|
| `scripts/cleanup/cleanup-env.sh` | fail-closed dispatcher: `CLEANUP_APP` → `env/<app>.sh` (unknown app = everything blocked) |
| `scripts/cleanup/env/<app>.sh` | per-app single source of truth: dirs, filters, gate commands, scanner+toolchain pins, bundle dir, protected boot layer |
| `scripts/cleanup/env/lib-metrics.sh` | shared cleanup_loc / cleanup_bundle_kb / cleanup_file_count, server-workspace-optional |
| `scripts/cleanup/baseline.sh` | Stage 0. Toolchain + branch rules, green gate, metrics → `.cleanup/baseline.json` |
| `scripts/cleanup/check-toolchain.sh` | gate step: Node/pnpm majors must match the CI pins — unpinned runtimes make metrics incomparable |
| `scripts/cleanup/lint-config-audit.sh` | gate step: each workspace's EFFECTIVE eslint config must hold `no-undef`/`no-unused-vars` (+ the react JSX pair for the SPA) at `error` |
| `scripts/cleanup/verify-approval.sh` | execute-time custody: `git blame` every `status: approved` line; only human-committed approvals count |
| `scripts/cleanup/reconcile-plan.sh` | accounting: `--batch N` before a done-flip, `--all-done` at verify — every non-struck finding needs a disposition |
| `scripts/cleanup/guard-approval-word.sh` | repo-wide `PreToolUse` hook (`.claude/settings.json`, all sessions): no agent writes `status: approved`, on either write surface |
| `scripts/cleanup/guard-approval-word.test.sh` | 24 fixtures for the approval-word guard |
| `scripts/cleanup/lib-path-verdict.sh` | the ONE path decision both scope guards call — no rule can hold on one surface and not the other |
| `scripts/cleanup/guard-protected-paths.sh` | `PreToolUse` scope guard on `Edit\|Write\|MultiEdit` (executor agent) |
| `scripts/cleanup/guard-bash-ops.py` | `PreToolUse` scope guard on `Bash` — file deletions, redirects, in-place edits, `git` writes, package-manager scope |
| `scripts/cleanup/guard-protected-paths.test.sh` | 133 fixtures across both surfaces and both apps (incl. cross-app isolation + unknown-app fail-closed) — a guard that stops blocking looks exactly like one that passed |
| `scripts/cleanup/post-edit-format.sh` | `PostToolUse` per-workspace `eslint --fix`. **No prettier** — see below |
| `scripts/cleanup/prompts/*.md` | the three stage contracts (documentation + hand-run fallback) |
| `.claude/agents/cleanup-*.md` | scanner, verifier, auditor, reviewer (app-agnostic) + one executor per app (`cleanup-executor`, `cleanup-executor-discussions`) |
| `.claude/workflows/cleanup-{audit,execute,verify}.js` | the saved workflows the slash commands run |
| `apps/twyst-your-status/knip.jsonc` + `server/knip.jsonc` | per-workspace scanner config (boot-layer noise pre-filtered — see redesign table) |
| `apps/twyst-your-status/.cleanup/` | runtime state: `baseline.json`, `CLEANUP_PLAN.md`, `CLEANUP_REPORT.md`, `audit/`, `raw/` (gitignored) |

**The full gate, in order** (authoritative command strings in `baseline.json` `commands`):
per-batch — reconcile → toolchain → wiring → eager → typecheck → lint → lintcfg → build →
tests → drift; stage 3 prepends a clean `install` and swaps reconcile for `--all-done`.
Custody (`verify-approval.sh`) runs once, before any batch executes.

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
9. `status: approved` is written by a human, in their own editor, committed under their own
   git identity. Enforced twice: `guard-approval-word.sh` (no agent can write it) and
   `verify-approval.sh` (execute aborts unless every approved line blames to a human
   commit). An agent transcribing the owner's words is NOT approval.
10. Every non-struck finding in an executed batch gets a truthful `- disposition:` bullet.
    A false `applied` is the one lie the scripts cannot catch — the stage-3 reviewer
    spot-checks dispositions against the diff for exactly that reason.

## Troubleshooting

- **Agent not found** → `.claude/agents/` was created after the session started; restart
  Claude Code so the five agents load.
- **You edited a workflow and the old behaviour persists** → invoking by name serves the
  copy the session registered at startup, not the file on disk (verified 2026-08-05: a
  fixed `cleanup-audit.js` kept refusing with the pre-fix message). Either restart Claude
  Code, or invoke by path: `Workflow({scriptPath: ".claude/workflows/cleanup-audit.js"})`.
  Each run also persists its own copy under the session's `workflows/scripts/` — diff that
  copy against the repo file when a run behaves like an older version.
- **Hook did not fire** → workspace trust not granted, or `scripts/cleanup/*.sh` lost `+x`.
  Verify with `bash scripts/cleanup/guard-protected-paths.test.sh`.
- **`jq: command not found`** → the guard and `baseline.sh` fail closed on purpose. Install jq.
- **knip flags an obviously-used file** → fix the entry points in that workspace's
  `knip.jsonc` before trusting any audit output. Note that knip's own hint
  "`server` — remove from ignoreWorkspaces" is wrong: dropping that line puts phantom
  unlisted dependencies from `server/tests/**` into the SPA report (verified 2026-08-05).
- **knip exits 1** → that means it HAS findings. It is a report, not a failure.
- **Re-running the baseline** → `baseline.json` is tracked, so overwrite it in place and
  commit the change. Do NOT `rm -rf .cleanup/` first: the deletion itself dirties the tree
  and `baseline.sh` then refuses its own clean-tree precondition.
  Re-baseline whenever `base_sha` drifts from `HEAD` — stage 3 reviews `base_sha..HEAD`, so a
  stale base drags unrelated commits into the cleanup diff.
- **A run pauses on a shell permission prompt** → the command is missing from
  `permissions.allow` in `.claude/settings.json`; add it and resume.
