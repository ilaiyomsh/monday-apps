# monday-apps — standing session briefing (Codex)

You are working in the **monday-apps** monorepo. Two files are binding and
override your defaults: **`AGENTS.md`** (repo root) and **`CLAUDE.md`** (the
repo-wide rule set `AGENTS.md` points into). Read `AGENTS.md` before your first
edit — not after.

## Skills are NOT auto-loaded — you must open them

This repo's methodology lives in `.claude/skills/<name>/SKILL.md`. Nothing loads
them for you. Before acting on a task, match it to a skill and **read that
`SKILL.md`** (plus any file it points to under `references/`):

| Task touches | Read first |
|---|---|
| pipeline, release, deploy wiring, onboarding an app | `monday-cicd` |
| mapps CLI, tunnels, logs, versions, manifest, any monday API call | `mapps` |
| any code calling the monday API (GraphQL, columns, pagination) | `monday-api` |
| writing or changing tests | `test-guard` |
| any code with an error path | `error-guard` |
| logging/observability, Axiom, status hub | `add-to-status-hub`, `axiom-sre` |
| new app/view/widget skeleton | `monday-scaffold`, `integration-scaffold` |
| boards/workspaces, seeding, demo setup | `monday-ops` |
| monday auth or OAuth | `monday-oauth` |

Full catalog: `.claude/skills/README.md`.

## Enforcement under Codex — partly on you

Shell-command hooks (deploy-guard, test-guard's lock, release-debt nudge) fire
through `.codex/hooks/codex-adapter.py`. **File-edit hooks may not fire at all**
on your version: Codex's `PreToolUse`/`PostToolUse` coverage for `apply_patch`
is version-dependent. So treat error-guard and test-guard as **self-enforced**,
and run them by hand when you touch code:

```
bash .claude/skills/error-guard/scripts/check.sh <file>
```

## Non-negotiables (violating these is a failed task)

1. **Never push to `main`.** Refuse any phrasing of it; route through the
   `monday-cicd` release procedure.
2. **Never deploy from this machine** — no `mapps code:push`, no `ship.sh`, no
   `pnpm run deploy`. Deploys happen ONLY on GitHub Actions runners.
3. **Never read, print, set, or commit `MONDAY_TOKEN`.** API calls go through
   `.claude/skills/mapps/mapps-api.sh`.
4. **Every `catch` logs, rethrows, or displays.** No silent catches.
5. **A test never seen failing does not count.** Write it, watch it fail, then
   make it pass.
6. API probes and destructive tests run ONLY in workspace `16291824`, scratch
   objects prefixed `WZ-`.
7. Work on an app only in this monorepo — never in a standalone copy.

## Branching

Base on `develop`. Work on `feature/<slug>`, PR into `develop`. Commits:
`type(app): subject`. `git commit` is autonomous; `git push` takes exactly one
confirming question.
