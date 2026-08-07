# Stage 1 — audit (any registered cleanup app)

**The normal way to run this is the saved workflow: `/cleanup-audit`**, optionally with an
app (default `twyst-your-status`) and a target inside it:

```
/cleanup-audit {"app":"discussions","target":"apps/discussions/src/components/MyTasksView"}
```

The script is `.claude/workflows/cleanup-audit.js`. This file is the stage *contract* —
what the workflow guarantees, and what to write in a prompt if you ever need to re-derive
the stage by hand (e.g. dynamic workflows unavailable).

---

## Contract

Precondition: `CLEANUP_APP=$APP bash scripts/cleanup/baseline.sh` exited 0, so that app's
`.cleanup/baseline.json` exists and every gate was green.

Scope: the ONE selected app only — its SPA (`src/`) plus `server/src/` when it has a
server workspace (client-only apps do not). The workflow refuses a target outside the app,
and an unregistered app, before spawning anything.

Strictly **read-only for source**. The only writes anywhere are under that app's
`.cleanup/` directory.

**Phase A — Scan (1 agent, `cleanup-scanner`).** knip once per workspace the app HAS (each
with its own `knip.jsonc`; a client-only app gets ONE run — a bare `knip` with no
`--directory` would scan the whole monorepo and report every other app's dead code as this
one's), jscpd over the app's source trees with tests excluded, eslint per workspace through
its own config and major, plus the TODO and commented-code inventories.
No `tsc` — both workspaces are plain JS. If knip's output is not trustworthy (invalid JSON,
zero files scanned), the workflow ABORTS: nothing downstream can be trusted.

**Phase B — Verify (1 parse agent + one `cleanup-verifier` per ~12 findings).** knip
findings get stable ids (`K-001`, …) and each is attacked: dynamic imports, string routes,
platform callers, cross-package test imports, subpath exports, globals. Verdicts:
`CONFIRMED_DEAD` / `FALSE_POSITIVE` / `TEST_ONLY` / `UNCERTAIN`.

**Phase C — Judge (4 `cleanup-auditor` agents, in parallel with Phase B).** One per focus
area: `patterns`, `comments`, `structure`, `dependencies`. Each writes
`.cleanup/audit/<area>.md` and returns a 3-line summary.

**Phase D — Consolidate (1 agent).** Merges everything into `.cleanup/CLEANUP_PLAN.md`:
only `CONFIRMED_DEAD` knip findings become actionable; `FALSE_POSITIVE`, `UNCERTAIN` and
`TEST_ONLY` go to a marked non-actionable appendix (in this repo `TEST_ONLY` is not
actionable — test files are locked); anything the path guard protects also goes to the
appendix, since an executor physically cannot apply it. Batches are ordered safest first:
comments (S) → dead files (M) → unused exports (M) → unused deps (M) → duplication (L) →
patterns (L) → structure (L). One category per batch.

**Every batch is written as `status: pending`.** Nothing in this stage may write
`approved` — that word is the human gate, and it is now physically enforced twice:
`guard-approval-word.sh` (repo-wide PreToolUse hook: no agent tool call can introduce it)
and `verify-approval.sh` (execute-time `git blame`: the committing identity must be human).

**Scanner noise is pre-filtered at the source, not re-litigated per run.** The
error/observability boot layer carries `@public` JSDoc tags (knip drops those exports) and
`useUiErrorSink.js` is a knip entry point — so what the scanners report should be treated
as real candidates, not as a pile to re-verify against the same known false positives.
If knip flags something obviously platform-reached, fix the tag/entry in the same session.

## 🚪 Human gate 1

Read the plan. Change the batches you want executed to `status: approved` (or `skipped`).
Then run `/cleanup-execute`.

## First run

Pilot ONE subdirectory to calibrate noise and cost before scanning the whole app.
