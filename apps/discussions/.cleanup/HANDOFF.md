# discussions cleanup — handoff to the next agent

**Written:** 2026-08-07, end of the session that redesigned the cleanup package and
onboarded `discussions` as its second registered app.
**Branch:** `claude/twyst-status-cleanup-37o0n1` (based on `develop` after PR #665 merged).
**State:** Stage 0 complete and green. **Nothing has been audited, planned or executed yet.**

Read this first, then `scripts/cleanup/README.md` (runbook + the failure→mechanism table).
Repo rules stay in the root `CLAUDE.md`.

## What is already done

**PR #665 is merged into `develop`** — the package redesign plus the twyst-your-status lint
hardening. Every discipline rule that failed in the 3.15.3 cleanup round is now a script
with an exit code: approval custody (`verify-approval.sh` + the repo-wide
`guard-approval-word.sh` hook), finding reconciliation (`reconcile-plan.sh`), toolchain
pinning (`check-toolchain.sh`), lint-capability auditing (`lint-config-audit.sh`).

**On this branch, not yet merged:** multi-app support and the discussions onboarding.
`CLEANUP_APP=<slug>` selects `scripts/cleanup/env/<slug>.sh`; the dispatcher fails CLOSED on
an unregistered name (both guard surfaces block everything). All five subagents and the
three stage prompts are app-agnostic. `discussions` is registered end to end and its
baseline is written.

## Your next step

```bash
# The baseline is already green at the branch HEAD. Only re-run it if base_sha drifts:
CLEANUP_APP=discussions bash scripts/cleanup/baseline.sh

# Then — PILOT ONE SUBDIRECTORY FIRST. Do not scan all 351 files on the first run.
/cleanup-audit {"app":"discussions","target":"apps/discussions/src/components/<one dir>"}
```

Then the human gate: **the owner** sets batches to approved in their own editor and commits
it under their own identity. You cannot write that word — the hook blocks it, and
`verify-approval.sh` blames every approval line before execution starts.

## Baseline — discussions vs twyst-your-status

| metric | discussions | twyst (shipped round, for scale) |
|---|---|---|
| source LOC / files | 76,663 / 351 | 15,729 / 110 |
| **jscpd duplication** | **5.68% — 290 clones** | 0.12% — 3 clones |
| knip unused exports | 182 | 7 |
| knip unused files | 1 | 0 |
| knip unused deps | 2 | 0 |
| bundle (served, no maps) | 3,848 KB (`build/`) | 716 KB (`dist/`) |

**Duplication is the headline: 47× twyst's rate.** That is where the value of this round is,
and it is why batch 5 (duplication consolidation) will be the big one. The 182 unused
exports are mostly barrel `default` re-exports that nothing imports by default (named
imports bypass them) — verified by sampling, but each still needs the verifier's judgement.

## discussions-specific traps — every one cost real time to find

1. **No server workspace.** `CLEANUP_SRV_*` are EMPTY in the env, and every consumer skips
   the server half. If you add a server-shaped assumption anywhere, guard it on the var
   being non-empty.
2. **Build output is `build/`, not `dist/`.** A stale `dist/` may exist; measuring it
   measures garbage. `CLEANUP_BUNDLE_DIR` already points at `build/`.
3. **`test` is vitest in WATCH mode.** The gate runs `test:run`. If you ever call the app's
   `test` script directly from a gate, the run hangs forever with no output.
4. **knip resolves vite aliases from ITS OWN config**, not `vite.config.js`. The
   `@generated` / `@components` / `@api` mappings live in `apps/discussions/knip.jsonc`
   under `"paths"`. Drop one and every module reached only through it becomes a phantom
   "unused file". `index.jsx` itself imports `@generated/App.jsx`.
5. **`@mapps/error-kit` is a knip false positive** (subpath import `/browser`), ignored with
   rationale — removing it takes the Axiom pipeline down.
6. **Platform contracts are invisible to grep.** `monday.storage` keys
   (`discussions_settings_*`, `discussions_templates_*`, `discussions_topic_order_*`, the
   digest-keyed export-asset keys), the column aliases in `boards.config.js`
   (`ALIAS_MIGRATIONS`, `RETIRED_COLUMN_ALIASES`) and the Hebrew-named board classes are
   reached by convention. A rename here silently orphans every board already configured.
   Skip and flag anything near them.
7. **The app's fail-soft catch pattern is a catch whose body is ONLY a rationale comment**
   (storage unavailable → defaults). Those comments are load-bearing; deleting them as
   "commented-out code" is a real regression. The app's `CLAUDE.md` is dense with such
   facts — assume WHY until proven WHAT.
8. **`react-hooks/exhaustive-deps` is `warn` and `lint` runs `--quiet`** — ~20 standing
   warnings are invisible by owner decision (round338). Do not "fix" them inside a cleanup
   batch; that is a separate, human-owned change.

## Two live bugs this session found — do not reintroduce them

- **A server-less app scanned the whole monorepo.** With `CLEANUP_KNIP_SRV_ARGS` empty,
  `baseline.sh` ran `pnpm dlx knip` with no `--directory` from the repo root and recorded
  **183 unused files / 624 exports / 20 deps** — every OTHER app's findings — as this app's
  baseline. Fixed (`cd00ce6`), and `cleanup-scanner` now reports `knipTrustworthy: false`
  when the file count looks monorepo-sized. If a number ever looks impossibly large, this
  is the first thing to check.
- **`.gitignore` had one app's `raw/` path**, so six discussions scanner outputs were
  committed. The rule is now written as "one line per registered app" — onboarding app N+1
  must add its line.

## Onboarding app N+1

The recipe is in `scripts/cleanup/README.md` (§ "Onboarding app N+1"). The order that
matters: **fixtures FIRST**, then the env file, then registration in the dispatcher + the
three workflow `APPS` tables + a per-app executor agent, then `knip.jsonc`, then the
baseline. `lint-config-audit.sh` will refuse an app whose eslint cannot see a dangling
identifier — fix the app's lint config before anything else (discussions needed exactly one
rule added, `react/jsx-no-undef`).

## Fixture suites — run both before and after touching any guard

```bash
bash scripts/cleanup/guard-protected-paths.test.sh   # 133 — scope, both surfaces, both apps
bash scripts/cleanup/guard-approval-word.test.sh     #  27 — the human-only approval word
```

The approval-word guard blocked this session three times while being built: a test command,
a commit message quoting the round-2 attack, and documentation using `<app>` placeholders.
Each false positive was folded back into the fixtures and the heuristic tightened — never
loosen it without adding the case that proves the write is still caught.

## Toolchain note for a cloud session

CI and the cleanup pins are **Node 20**; this container ships Node 22, and
`check-toolchain.sh` refuses the wrong major (it is a gate step, not advice). Fetch Node
20.20.2 and put it first on `PATH` before running any stage.
