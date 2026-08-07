# Stage 2 — execute (any registered cleanup app)

**The normal way to run this is the saved workflow: `/cleanup-execute`**, optionally
narrowed:

```
/cleanup-execute {"app":"discussions","batches":[1,3]}
```

The script is `.claude/workflows/cleanup-execute.js`. This file is the stage *contract*.

---

## Contract

Precondition: a human has set the batches they want to approved status in that app's
`.cleanup/CLEANUP_PLAN.md`. Args can only **narrow** that set — they
never override a status. No approved batch → the workflow stops and says so.

**Custody, before anything runs.** `bash scripts/cleanup/verify-approval.sh` — every
`status: approved` line must be blame-attributable to a HUMAN commit (no Claude author, no
Claude trailer, not uncommitted). An agent transcribing the owner's words is not custody
(round 2, commit 953f8ce); the workflow aborts on a non-zero exit. The preventive half is
`guard-approval-word.sh`, a repo-wide PreToolUse hook under which no agent can write the
word at all.

**Selection.** Read the plan and `baseline.json`. Refuse to start on a dirty working tree:
every batch must be its own revertable commit.

**Execution loop — strictly sequential, never two edit batches at once.** Per batch:

1. The app's executor agent (`cleanup-executor`, `cleanup-executor-discussions`, ...)
   applies exactly that batch's findings. It carries `scripts/cleanup/guard-protected-paths.sh`
   as a `PreToolUse` hook (dispatched via `CLEANUP_APP`), so an edit outside that app's
   `src` dirs + its `package.json` manifest(s) is blocked at the tool call — including tests, config, build output, and the error/observability boot
   layer. A blocked finding is skipped and reported, never worked around. As it goes, it
   appends one `- disposition: applied | skipped — reason | guard-blocked` bullet per
   finding in the plan — the accounting the gate checks.
2. A verifier agent runs the full gate: reconcile (`reconcile-plan.sh --batch N`, every
   non-struck finding accounted) → toolchain (Node/pnpm majors = CI pins) → wiring audit →
   eager-import audit → typecheck → lint (both workspaces) → lintcfg
   (`lint-config-audit.sh`, the lint must be ABLE to see a dangling identifier) → build
   (both) → tests (both, full) → error-kit drift.
3. **Green** → `git add -A -- apps/$APP`, verify nothing outside the app is
   staged, commit `chore($APP): cleanup [category] — [title] [batch-N]`, set
   the batch to `done` in the plan (Edit tool — a shell round-trip mentioning the approval
   word is blocked), commit the plan change.
4. **Red** → ONE fix attempt by the same executor, limited to its own edits, then re-gate.
5. **Still red** → revert scoped to the app (`git restore --staged --worktree --
   apps/$APP` then `git clean -fd -- apps/$APP`), mark the batch
   `failed` with the reason, commit the plan change, continue to the next batch. Never a
   third attempt, never a dirty tree between batches.

**Never** push, merge, deploy, widen scope, or edit a test to make a gate pass.

## 🚪 Human gate 2

Review the commits (`git log --oneline <base>..HEAD`, `git show <sha>`) before verification.
Then run `/cleanup-verify`.
