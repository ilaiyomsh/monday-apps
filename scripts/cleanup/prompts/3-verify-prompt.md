# Stage 3 — verify (twyst-your-status)

**The normal way to run this is the saved workflow: `/cleanup-verify`** (no args).
The script is `.claude/workflows/cleanup-verify.js`. This file is the stage *contract*.

---

## Contract

Run after `/cleanup-execute`, once a human has glanced at the commits.

**Phase A — Full gate (1 agent).** Toolchain check (Node/pnpm majors = CI pins), then
`pnpm install --frozen-lockfile` (a clean install is the only place a dependency batch that
broke resolution shows up), then `reconcile-plan.sh --all-done` (every done batch fully
accounted — a disposition-less finding in a done batch is round 2's silent-skip failure),
then wiring audit, eager-import audit, typecheck, lint, lintcfg (`lint-config-audit.sh` —
the lint must be ABLE to see a dangling identifier), build, full test suites for both
workspaces, and the error-kit drift suite. Also measures the SPA bundle via
`cleanup_bundle_kb` (sourcemaps excluded) the same way the baseline did. **Any failure
forces the verdict to `ISSUES_FOUND`,** whatever the review says.

**Phase B — Re-scan (1 agent, `cleanup-scanner`).** Same scanners, same scope, `-after`
suffix. A metric compared against a different scope is not a metric.

**Phase C — Compare (1 agent).** before → after → delta for source LOC, source file count,
knip unused files/exports/dependencies, jscpd clones and duplication %, eslint problems, and
bundle KB, plus the per-batch results table from the plan. Written to
`.cleanup/CLEANUP_REPORT.md`. A metric that cannot be computed is written `unknown`, never
guessed.

**Phase D — Adversarial review (1 agent, `cleanup-reviewer`, in parallel with B/C).**
Fresh context, base SHA only. Runs the two mechanical custody checks first
(`verify-approval.sh`, `reconcile-plan.sh --all-done` — any failure is blocking), then
walks every commit hunting behaviour changes, deleted-but-referenced code (including
string routes and paths named in `scripts/error-wiring-audit.mjs` /
`scripts/lib/eager-graph.mjs`), lost WHY-comments, touched tests, error-handling
regressions, platform-contract changes (`settings_str` keys, storage keys, webhook config,
OAuth scopes, routes), any file outside the app — and whether `- disposition: applied`
lines are TRUE against the diff, the one lie the scripts cannot see.

**Phase E — Report (1 agent).** Appends the review verbatim, writes the final
`VERDICT: READY_FOR_PR | ISSUES_FOUND`, and commits
`chore(twyst-your-status): cleanup verification report`.

## What this stage never does

Opens no PR and pushes nothing. On `READY_FOR_PR` it proposes a title and a 5-line body;
the push is a human decision (one confirming question), the PR targets **develop** — never
`main` — and a release freeze may be in effect (`gh pr list --base main`).
