# Stage 2 — execute (twyst-your-status)

**The normal way to run this is the saved workflow: `/cleanup-execute`**, optionally
narrowed:

```
/cleanup-execute {"batches":[1,3]}
```

The script is `.claude/workflows/cleanup-execute.js`. This file is the stage *contract*.

---

## Contract

Precondition: a human has set the batches they want to `status: approved` in
`apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md`. Args can only **narrow** that set — they
never override a status. No approved batch → the workflow stops and says so.

**Selection.** Read the plan and `baseline.json`. Refuse to start on a dirty working tree:
every batch must be its own revertable commit.

**Execution loop — strictly sequential, never two edit batches at once.** Per batch:

1. `cleanup-executor` applies exactly that batch's findings. It carries
   `scripts/cleanup/guard-protected-paths.sh` as a `PreToolUse` hook, so an edit outside
   `apps/twyst-your-status/{src,server/src}` + the two `package.json` files is blocked at
   the tool call — including tests, config, build output, and the error/observability boot
   layer. A blocked finding is skipped and reported, never worked around.
2. A verifier agent runs the full gate: wiring audit → eager-import audit → typecheck →
   lint (both workspaces) → build (both) → tests (both, full) → error-kit drift.
3. **Green** → `git add -A -- apps/twyst-your-status`, verify nothing outside the app is
   staged, commit `chore(twyst-your-status): cleanup <category> — <title> [batch-N]`, set
   the batch to `done` in the plan, commit the plan change.
4. **Red** → ONE fix attempt by the same executor, limited to its own edits, then re-gate.
5. **Still red** → revert scoped to the app (`git restore --staged --worktree --
   apps/twyst-your-status` then `git clean -fd -- apps/twyst-your-status`), mark the batch
   `failed` with the reason, commit the plan change, continue to the next batch. Never a
   third attempt, never a dirty tree between batches.

**Never** push, merge, deploy, widen scope, or edit a test to make a gate pass.

## 🚪 Human gate 2

Review the commits (`git log --oneline <base>..HEAD`, `git show <sha>`) before verification.
Then run `/cleanup-verify`.
