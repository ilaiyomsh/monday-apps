# HANDOFF — twyst-your-status cleanup, round 2 (batches 5 and 7)

**Audience: the next agent, starting with zero context.** Everything you need is in this
repo; nothing important lives only in a chat transcript. Read this file top to bottom before
touching anything.

Written 2026-08-05 at `d3de63b` on branch `claude/twystyourstatus-cleanup-workflow-ud6gpw`.

---

## 0. Orient yourself first (in this order)

1. `CLAUDE.md` → the "Cleanup workflow — `twyst-your-status` ONLY" subsection under Quality
   gates. Repo-wide rules bind you; the golden rules are non-negotiable.
2. `scripts/cleanup/README.md` → the runbook, the file map, and every deviation this package
   makes from the upstream cleanup package.
3. `apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md` → the plan. Read the
   **"Pre-approval refutation pass"** block near the top before reading any batch.
4. `apps/twyst-your-status/.cleanup/CLEANUP_REPORT.md` → round 1's verification report,
   including the adversarial reviewer's 8 numbered findings in `## Overall`.
5. `apps/twyst-your-status/.cleanup/baseline.json` → the authoritative command strings. Read
   commands from here, never from memory.

## 1. What already happened (round 1)

Stages 0→3 ran. **Batches 1, 2, 3, 4 and 6 are `done`**, each its own revertable commit,
each gated green before it was committed:

| batch | category | findings | commit |
|---|---|---|---|
| 1 | comments | 9 | `025e490` |
| 2 | dead files | 3 | `ecbc9e6` |
| 3 | unused exports | 5 | `6d308c1` |
| 4 | dead `React` default bindings | 17 files | `0e2d9a8` |
| 6 | pattern alignment | 4 | `ba46684` |

Measured effect: **source LOC 15,223 → 14,998 (−225, −1.48%)**, source files 90 → 86, knip
unused files 4 → 1, unused exports 20 → 16. **Bundle unchanged at 716 KB** — expected: dead
code that was never imported was never in the bundle. Duplication unchanged at 0.38% because
that is batch 5, which has not run.

The audit's headline result, worth knowing before you trust any scanner: **74% of knip's
findings were false positives** (20 of 27). Without the adversarial verify phase the plan
would have proposed deleting the app's whole error layer — `logger.js`,
`globalErrorHandler.js`, `axiomLoggerAdapter.js`, `AppErrorBoundary`, `useUiErrorSink` — all
"unimported" because the platform reaches them. Never act on a raw scanner finding here.

## 2. Your task

Two things, in this order:

### 2a. Close the three open findings from round 1's report

Five of the report's eight findings are already fixed (`0371cfe`, `d3de63b`). These three are
open:

- **Finding 1 — the branch mixes two deliverables.** 8+ files outside
  `apps/twyst-your-status/` are in this branch (`CLAUDE.md`, `AGENTS.md`,
  `.claude/agents/`, `.claude/workflows/`, `scripts/cleanup/**`). The reviewer's position: a
  cleanup branch is scoped to the app, so the tooling belongs in its own PR. The mitigating
  fact: this branch was created to *build* the cleanup package, and the run came after.
  **This is the owner's call — ask, do not decide.** Options: (a) split into two PRs
  (tooling / cleanup run), (b) one PR that states in its body that it carries both.
- **Finding 2 — the human approval gate was operated by an agent.** In round 1 an agent
  wrote `approved` into the plan for batches 1-4+6 after the owner said "start implementing"
  without naming batches; the 1-4+6 / 5+7 split was the agent's own recommendation. The
  reviewer's remedy stands: **the owner must re-confirm on the PR that exactly batches
  1,2,3,4,6 were intended.** For round 2 this is already cleaner — see §3.
- **Finding 8 — every round-1 metric and gate ran on the wrong Node major.**
  `baseline.json` records `node v22.22.2`; CI and `apps/twyst-your-status/package.json`
  pin Node 20 (`engines: ^20`). The sandbox had no nvm/fnm/volta and no Node 20, so this
  could not be fixed there. **If your environment has Node 20, re-run the baseline on it and
  say so in the report.** If it does not, state plainly that the gate is Node-22-green and
  that CI on the PR is the first Node-20 verification.

### 2b. Run batches 5 and 7

`bash scripts/cleanup/baseline.sh` → set the statuses (§3) → `/cleanup-execute` →
`/cleanup-verify`. Invoke the workflows **by path**, not by name — see §6.

- **Batch 5 — duplication consolidation, 10 findings, risk L.** `A-patterns-01, -02, -04,
  -08, -09, -10, -11, -12, -13, -14`.
- **Batch 7 — structure, 13 findings of which 2 are STRUCK, so 11 to execute, risk L.**
  `A-structure-01, -03, -04, -05, -06, -07, -09, -10, -11, -12, -13`.

## 2c. Branches — where to work, and what to do before you start

**Work on this same branch: `claude/twystyourstatus-cleanup-workflow-ud6gpw`.** Do not start a
fresh branch off `develop`, and do not cherry-pick batches 5/7 onto a clean base.

Why this branch and not a new one: batches 5 and 7 must run on a tree where batches 1-4+6 are
already applied. They share files — `ColumnSettings.jsx` was touched by 2 round-1 commits,
`PersonPicker.jsx` by 4, `graphqlQueries.js` by 2, `stores.js` by 2 — and the plan's `done`
statuses, its amended anchors, and the `A-structure-10` ↔ `A-patterns-04` ordering note all
describe the post-round-1 tree. On a clean base the findings do not describe reality.

**First action, before `baseline.sh`: merge `develop` in.** As of `f8fd039` this branch is
**25 ahead / 23 behind** `origin/develop`, and develop carries a feature commit inside this
very app:

- `6931dc3 feat(twyst-your-status): resilient SecureStorage — retry transient Vault errors,
  coalesce reads` — adds `server/src/helpers/secure-storage-resilient.js` (93 lines), wires it
  in `server/src/index.js`, and adds `server/tests/secure-storage-resilient.test.js` (10
  tests). It does **not** touch `stores.js`.

```
git fetch origin develop
git merge origin/develop        # verified CLEAN at f8fd039 — no conflicts
bash scripts/cleanup/baseline.sh
```

Three consequences you must not skip:

1. **Re-run `baseline.sh` after the merge.** The existing `baseline.json` was captured at
   `4380d77`, which predates that feature. Every metric and the recorded command set are
   stale until you re-capture.
2. **The server suite grows 221 → 231 tests.** A gate that reports 221 after the merge means
   the merge did not land — treat that as a failure, not a variation.
3. **`secure-storage-resilient.js` is new source the audit never scanned**, and it is inside
   the cleanup allowlist (`server/src/**`). Batch 5 is the *duplication* batch and that file
   is retry/coalescing logic, so it is exactly the shape that could duplicate something
   already present. Do not add it to a batch on your own judgement — if a scan flags it,
   surface it as a NEW finding for the owner rather than folding it into an approved batch.
   An approved batch covers the findings it lists and nothing else.

Do not rebase this branch. It is pushed and its commits are the audit trail — one revertable
commit per batch is the whole safety model, and a rebase rewrites the shas the report and this
handoff cite. Merge, never rebase.

**If the owner decides to split the branch (report finding 1),** the tooling PR merges FIRST:
`scripts/cleanup/**`, `.claude/workflows/cleanup-*.js`, `.claude/agents/cleanup-*.md`,
`CLAUDE.md`, `AGENTS.md`. The cleanup run cannot be re-verified without the guards and
workflows, so a cleanup-only PR that lands first is not reproducible. Ask before splitting —
it rewrites history that the report cites.

**Targets and prohibitions:** the PR targets `develop`, never `main`. Check the release freeze
before merging anything into `develop` (`gh pr list --base main` — nothing merges into
`develop` while a develop→main PR is open). Cloud sessions push `claude/*` branches based on
`develop`; that is what this branch is.

## 3. The approval gate — read this before you write anything

`approved` is a **human-only** word (CLAUDE.md). No agent writes it on its own judgement.

For round 2 the owner named the batches explicitly, in session, on 2026-08-05:
*"ליישם ממצאים ולהמשיך בתוכנית את שלבי 5,7"* — implement the findings and continue the plan
with batches 5 and 7. That is a specific selection by the owner, which is exactly what round
1 lacked.

So: transcribe that decision into `CLEANUP_PLAN.md` (batch 5 and batch 7 headers **and** the
Summary table rows) **with attribution**, exactly as the existing "Approval record" block
does — say who decided, when, and in what words. Then add nothing else to the gate.
**Do not approve any other batch. Do not widen the selection.** If the owner has not spoken
in your session and you cannot see that instruction, stop and ask.

## 4. Mandatory amendments — a literal reading of the plan will break the app

A pre-approval refutation pass (6 agents, mandate: refute) produced **52 SOUND · 17 RISKY ·
3 WRONG** over the findings. All of this is marked inline in the plan with `⛔ STRUCK` and
`⚠ AMENDED`, but it is repeated here because it is the difference between a clean round and a
broken app:

- **`A-structure-02` — STRUCK. Do not execute.** It moves `guardConn` state and
  `handleAuthorizeGuard` into a child component while explicitly leaving `handleGuardToggle`
  in the parent — and that handler reads and calls both. Result: a **ReferenceError on the
  switch that arms the guard** (the round326 auto-revert contract). It also relocates the
  guard-status probe and the window `focus` listener below the parent's early returns,
  changing when they first fire.
- **`A-structure-08` — STRUCK. Do not execute.** Its extraction ranges contradict each other
  (the loop-guard block it says to keep inline sits inside the range it says to extract), and
  three early returns cannot be expressed by a value-returning helper. The echo test does not
  pin the call count it would break, so a broken version ships green.
- **`A-structure-10` — AMENDED, mandatory.** Batch 5's `A-patterns-04` adds the first
  `../../../src/domain/…` import to `server/src/services/stores.js`. This finding then moves
  `createRulesStore` one directory deeper, where that specifier resolves to a directory that
  does not exist and **the build gate fails**. Either rewrite the moved specifier to
  `../../../../src/domain/columnConfigKey.js`, or run `A-structure-10` **before**
  `A-patterns-04`. Also: `REFRESH_CUSHION_MS` belongs in `tokenStore.js`, not
  `unwrapStoredValue.js` — its only use is inside `createTokenStore`.
- **`A-patterns-14` — AMENDED.** The `requireReader` helper sends 409 and still returns a
  falsy reader, so every call site must be `const reader = await requireReader(...); if
  (!reader) return;`. Without the `return` it double-sends and throws
  `ERR_HTTP_HEADERS_SENT`.
- **Plan-wide rule that overrides the plan's own "batches are independent" claim:**
  **relocate every finding by SYMBOL, never by the line numbers quoted in the plan.** Every
  line number was correct at base `4380d77` and at no point after; batches shift each
  other's anchors in at least four known places.
- **Fragment requirement.** `.twyst-owners` is `display: flex; flex-direction: column`
  (`ColumnSettings.css:286-295`). `A-structure-04` and `A-structure-05` each extract multiple
  sibling nodes out of it, so the new components must return a **Fragment** — a wrapper
  `<div>` collapses N flex items into one and silently changes the layout, which no test
  catches.

## 5. The gate is weaker than it looks — this changes how you work

**`no-undef` is OFF for the SPA.** `apps/twyst-your-status/package.json → eslintConfig` does
not extend `eslint:recommended`; its only rules are `no-console`, `no-empty`, the error-guard
catch rule, and `promise/catch-or-return`. So a free identifier left by a botched extraction
**passes lint, passes the build** (esbuild does not resolve free identifiers) **and passes
tests** wherever no test exercises that control. For batches 5 and 7 the gate proves
"nothing I can see broke", not "nothing broke".

Practical consequence: after each structural finding, grep the file for every symbol you
moved and confirm each remaining reference resolves. Do not rely on the gate for this class
of error.

Related: several batch-5/7 extractions have **no locked test behind them at all** — nothing
exercises outside-click/Escape dismissal or overlay clamping (`A-patterns-08`), the owners
subtree (`A-structure-04`), or `BypassMonitor`'s rows (`A-structure-13`).

## 6. Mechanics

**Invoke the workflows by path, never by name.** Invoking by name serves the copy the session
registered at startup, not the file on disk — verified: a fixed `cleanup-audit.js` kept
refusing with its pre-fix message until it was invoked by `scriptPath`.

```
Workflow({ scriptPath: ".claude/workflows/cleanup-execute.js", args: {"batches":[5,7]} })
Workflow({ scriptPath: ".claude/workflows/cleanup-verify.js" })
```

Stage 0 first, and it requires a clean tree:

```
bash scripts/cleanup/baseline.sh
```

The gate per batch (the repo's blocking CI set narrowed to this app; command strings live in
`baseline.json`): error-wiring audit → eager-import audit → type-check → lint ×2 → build ×2
→ full tests ×2 (1,048 tests) → error-kit drift.

Guard fixtures, run them if you touch the guards: `bash
scripts/cleanup/guard-protected-paths.test.sh` → expect **108 passed, 0 failed**.

## 7. Hard rules

1. **Never push to `main`.** Work on this branch; the PR targets `develop`. Check the release
   freeze first: `gh pr list --base main` — nothing merges into `develop` while a
   develop→main PR is open.
2. **Never deploy.** Not `mapps code:push`, not `ship.sh`, not from any sandbox. Merging the
   PR is what deploys the draft.
3. **`git push` takes exactly one confirming question.** So does opening a PR. Neither is
   automatic.
4. **Never edit a test.** test-guard locks them and both cleanup guards block them. A red
   test means your edit was wrong.
5. **error-guard binds every change:** every `catch` still logs, rethrows, or displays.
6. **Never work around a guard.** If `guard-protected-paths.sh` or `guard-bash-ops.py` blocks
   a path, the printed reason IS the answer: skip the finding and report it.
7. **One batch = one category = one revertable commit**, message
   `chore(twyst-your-status): cleanup <category> — <title> [batch-N]`. Red gate → one fix
   attempt → revert that batch, mark it `failed`, continue.
8. **Zero behaviour change.** A cleanup that changes runtime behaviour is a bug, not a
   trade-off.

## 8. Enforcement, and the story behind it

The two guards are the physical scope layer: `guard-protected-paths.sh`
(`Edit|Write|MultiEdit`) and `guard-bash-ops.py` (`Bash`), both delegating to one decision
function, `lib-path-verdict.sh`. `guard-bash-ops.py` **denies by default** — a read-only verb
allowlist plus narrowly sanctioned write patterns.

It is written that way because the first version enumerated *mutating* verbs and allowed
everything else, and a live adversarial probe walked through it in minutes: `node -e`,
`node --eval`, `node -p`, `python3 -c`, `python3 - <<EOF`, `git -C <dir> commit` (the
directory was parsed as the subcommand), `1> file` and `2> file` (numbered fds were skipped
so `2>&1` would pass), `bash -c "rm ..."`, `sh script.sh`, `ex -sc wq file`. Eight holes, all
now pinned by fixtures. **If you extend the guard, extend the fixtures first.** Enumerating
ways to write to a disk is a game you lose; and nothing failed while the hole was open, which
is the whole problem — an unenforced guard is indistinguishable from one that passed.

## 9. What "done" looks like

- Batches 5 and 7 each either `done` with a commit, or `failed` with the reason recorded in
  the plan. No batch left half-applied, no dirty tree between batches.
- `/cleanup-verify` re-run to completion, `CLEANUP_REPORT.md` updated, and its verdict
  **earned, not edited**. If the reviewer says `ISSUES_FOUND`, fix the findings and run it
  again. Never hand-edit the report to say `READY_FOR_PR`.
- The three open report findings (§2a) each either fixed or explicitly handed to the owner
  with the options laid out.
- A status summary that separates what was measured from what was assumed, and states the
  Node-major caveat if it still applies.
- **No PR opened and nothing pushed without asking the owner first.**

## 10. Things that are true and easy to get wrong

- `pnpm` only. Never npm/yarn (tracker's postinstall needs pnpm; CI runs `--frozen-lockfile`).
- The app is plain JS. `type-check` is literally `echo no-typescript` — it carries **zero**
  signal. Do not treat a green type-check as evidence of anything.
- knip exits **1** when it has findings. That is a report, not a failure.
- `ignoreWorkspaces: ["server"]` in `apps/twyst-your-status/knip.jsonc` is load-bearing
  despite knip's own hint telling you to remove it: dropping it injects 6 phantom unlisted
  dependencies from `server/tests/**` into the SPA report.
- `@mapps/error-kit` is a permanent knip false positive (subpath-imported) and **is** the
  error pipeline. Never a removal candidate.
- Two workspaces, two eslint majors: the SPA is eslint 8 with a legacy `eslintConfig` block
  in `package.json`; the guard server is eslint 9 with a flat config. Run each through its
  own workspace.
- There is no prettier anywhere in this repo. Do not introduce one mid-cleanup.
- `A-dependencies-02` is a real production risk deliberately kept out of every batch: the
  guard server's four deps float on carets and the pushed archive carries no lockfile, so
  production installs versions CI never tested, while two files are incident workarounds
  written against `@mondaycom/apps-sdk` 0.1.4 exactly. It needs a release decision, not a
  cleanup commit. Do not batch it; do remind the owner it is open.
