# Tech Debt — Agent Briefing

**You are here:** `/tech-debt/` directory in the `tracker` repo.
**Repo:** Monday.com Board View calendar (Hebrew RTL + English LTR), React 18 + Vite.

---

## What this directory is

Three documents tracking a ~13-week tech-debt cleanup effort:

| File | Purpose | When to read it |
|------|---------|-----------------|
| `STATUS.md` | **Operational queue.** One row per sub-task with status (🟢 NEXT / 🚧 IN-PROGRESS / 🟡 IN-REVIEW / ✅ MERGED) and an in-scope/out-of-scope spec per row. | First — every sub-task starts here. Builder picks 🟢 NEXT, reviewer picks 🟡 IN-REVIEW. |
| `ANALYSIS.md` | Per-finding analysis with verification, fix logs, and severity adjustments. **The live history doc** — every fix appends a structured "Fix applied" entry here. | After `STATUS.md`, to read the F0XX history before implementing. |
| `ROADMAP.md` | The 5-wave plan with sequencing, dependencies, and timeline. | Background. Read when `STATUS.md` references something unfamiliar, or when planning a new wave split. |
| `AUDIT.md` | Original 35-finding audit (F001–F035). Source of truth for *what's broken*. | When you encounter a finding ID and need the original context. Frozen — never edited. |

---

## 🎯 CURRENT MISSION — Wave 1

**Status:** Wave 1 active. Wave 0 (quick-win sweep) shipped in commit `9131c6d` — 9 findings closed.

**Wave 1 goal:** close 4 low-risk hygiene tasks before touching any god-file. None of these require tests or refactors. Each ships as its own PR.

### The 4 tasks (in order)

1. **Docs cleanup — F015 + F016 + F017 + F018 + F034**
   Stale architecture/refactoring docs cite file sizes from 4+ months ago that drifted 30–60%. Decision needed: auto-generate via `pnpm run loc` script + CI check, OR delete the size tables and keep prose-only.
   **Recommended path:** delete the size tables in `CLAUDE.md` and `ARCHITECTURE.md`, archive `REFACTORING_ROADMAP.md` and `TASKS_PLAN.md` (date-stamped Jan 2026, partially resolved), delete `docs/api-*-mapping.md` (git history is the source of truth).
   **Done when:** No doc in the repo claims a file size that's wrong.

2. **README rewrite — F015**
   Current `README.md` is the Monday Quickstart boilerplate. Needs to describe the actual product (Hebrew RTL time-tracking calendar, structure modes, settings flow).
   **Done when:** Someone landing on the repo from GitHub understands what the app does in 30 seconds.

3. **i18n completion — F029**
   5 components are suspected to have hardcoded Hebrew strings and don't import `useTranslation`: `Toast`, `ErrorDetailsModal`, `UndoBanner`, `SettingsValidationDialog`, `MobileResizeOverlay`.
   **Order (high → low user exposure):** Toast → ErrorDetailsModal → UndoBanner → SettingsValidationDialog → MobileResizeOverlay.
   **Done when:** Every user-facing string in those 5 components flows through `t()` with corresponding keys in both `he` and `en` locale files.

4. **ESLint in CI — F033**
   `eslintConfig: react-app` exists in `package.json` but `.github/workflows/test.yml` doesn't run lint. Baseline run came in at 171 problems (54 errors, 117 warnings) — too big for one review pass, so the cleanup is split into three task branches before the CI gate. Four-PR sequence:
   - **PR A1** (`wave-1.4a-eslint-baseline`): clear all 54 errors + low-risk warning categories (auto-fix `import/first`, malformed `eslint-disable` comments, `rules-of-hooks` fixes, anonymous default exports, mixed operators, `default-case`, unused `vi` test imports).
   - **PR A2** (`wave-1.4b-unused-vars`): remaining `no-unused-vars` cleanup — delete dead imports/declarations.
   - **PR A3** (`wave-1.4c-exhaustive-deps`): `react-hooks/exhaustive-deps` per-callsite triage — real fix, add dep, or `eslint-disable-next-line` with Hebrew rationale.
   - **PR B** (`wave-1.4d-eslint-ci`): add `pnpm exec eslint src/ --ext .js,.jsx --max-warnings 0` step to CI.
   **Done when:** A lint regression breaks CI.

---

## Branching & merge model

Three-tier branching, kept strict so review and rollback stay simple:

```
main                              ← never touched directly
  └── chore/tech-debt-sweep       ← long-lived integration branch for ALL tech-debt
        ├── tech-debt/wave-1.1-...  ← short-lived task branch → review → merge → delete
        ├── tech-debt/wave-1.2-...  ← idem
        ├── tech-debt/wave-1.3-...  ← idem
        ├── tech-debt/wave-1.4-...  ← idem
        ⋮
        (when a full wave / Wave 1–4 is done)
              ↓
        chore/tech-debt-sweep → merged into `main` as one big PR
```

### Iron rules

1. **Never commit to `main`.** Don't even branch off it for tech-debt work.
2. **Every sub-task = its own short-lived branch off `chore/tech-debt-sweep`** (off the *latest* sweep, not off a sibling task branch).
   Naming: `tech-debt/wave-<N.M>-<short-slug>` (e.g. `tech-debt/wave-1.3-i18n-final-five`).
3. **Reviewed task branch → merge into `chore/tech-debt-sweep` → delete** (local + remote).
4. **Parallel siblings**: when sibling A merges into sweep first, sibling B **rebases** onto the updated sweep before its own review.
5. **`main` stays untouched** until a wave (or all of Wave 1–4) is ready to ship as one big PR.
6. **Don't commit until the user asks.** Stage, run verification, report. Same applies to merging back into sweep.

### Recovery from drift

If a task branch ends up sitting on a stale sweep (because new commits landed on sweep meanwhile), the standard fix is:

```bash
git checkout tech-debt/wave-<N.M>-<slug>
git rebase chore/tech-debt-sweep
# resolve, re-run pnpm run test:run + build, then continue review
```

If two task branches got chained (e.g. 1.2 branched off 1.1 instead of off sweep), merge the upstream one into sweep first, then rebase the downstream one onto the updated sweep.

---

## Working agreements (read before editing code)

These are non-negotiable in this project:

- **Hebrew comments only.** All in-code comments stay in Hebrew per `CLAUDE.md`.
- **All user-facing strings via `t()`.** Both `src/i18n/locales/he/translation.json` and `.../en/translation.json` must be updated together.
- **Use `logger`, not `console`.** `import logger from '../utils/logger'`.
- **Status labels by ID, never by text.** See `tech-debt/../memory/feedback_status_column_label_ids.md` and `CLAUDE.md`.
- **Never use `settings_str` in GraphQL.** Use `settings` (typed JSON). Exception: `useBoardBuilder.js` for newly-created columns — see F027 in `ANALYSIS.md`.
- **`pnpm run test:run` must pass before commit.** Currently 701/701.
- **`pnpm run build` must succeed.** Vite produces `build/` output.
- **No `--no-verify`, no skipping hooks.**
- **Don't commit unless the user asks.** Stage and report; user reviews.
- **Update `ANALYSIS.md` after every fix.** Add a `**Fix applied:**` line under the relevant finding section. This file is the live status doc.

---

## Agent procedure — closing a tech-debt task

Follow these steps in order. No shortcuts.

1. **Read first** — `STATUS.md` (the operational queue: which row is 🟢 NEXT, what's its spec), then the relevant `F0XX` section in `ANALYSIS.md` (the per-finding history). `ROADMAP.md` is background — read only if `STATUS.md` references something unfamiliar.
2. **Claim the row** — flip the 🟢 NEXT row to 🚧 IN-PROGRESS in `STATUS.md` and fill the `Branch` cell with your planned branch name. This is the lock that prevents two builders from grabbing the same row.
3. **Branch** — `git checkout chore/tech-debt-sweep && git pull && git checkout -b tech-debt/wave-<N.M>-<short-slug>`. Always off the latest `sweep`, never off a sibling task branch. The branch name must match what you wrote in `STATUS.md`.
4. **Implement** — stay strictly within the **In scope** block of the row's spec in `STATUS.md`. The **Out of scope** block is the second half of your contract. No drive-by fixes. Hebrew comments stay; user-facing strings go through `t()`.
5. **Verify locally** — `pnpm run test:run` (must match the **Verification baseline expected** in the spec), `pnpm run build` (must succeed). For UI changes, eyeball the dev server.
6. **Update `ANALYSIS.md`** — append to the relevant `F0XX` section using exactly this structure (the reviewer audits against it; vague entries fail review):
   ```markdown
   ### F0XX — <title> ✅ FIXED (YYYY-MM-DD)        # or 🔄 PARTIAL — Wave <N.M>
   - **Fix applied (Wave <N.M>):** one paragraph — what changed, how it differs from the audit's recommendation, what was verified.
   - **In scope:** (copy the spec's bullets, expanded to what actually shipped).
   - **Out of scope (deliberately not changed):** (copy + add anything you discovered en route).
   - **Verification baseline:** lint counts before→after; test pass/fail with note on pre-existing failures; build status.
   - **Judgment calls:** anything where you chose between two reasonable options.
   ```
   Truth beats consistency with the audit. If a claim turned out wrong, say so.
7. **Flip status** — in `STATUS.md`, change the row from 🚧 IN-PROGRESS to 🟡 IN-REVIEW. Stage all your changes (`STATUS.md`, `ANALYSIS.md`, code).
8. **Stage and report** — show diff + verification numbers + the contract from `ANALYSIS.md`. **Do not commit**, do not push, do not open a PR. Hand off to the user.
9. **After user review** — a reviewer-merger agent (or the user) commits on the task branch → merges into `chore/tech-debt-sweep` → deletes the task branch (local + remote) → flips the row to ✅ MERGED in `STATUS.md` and fills `Merge SHA`. Promote the next row from ⬜ FUTURE → 🟢 NEXT if all its blockers are now ✅ MERGED.
10. **If a sibling task already merged into sweep meanwhile** — rebase your branch onto the updated sweep before review. Re-run verification afterwards (numbers may shift).

### When you'd touch a *different* doc

- `STATUS.md` — every sub-task touches this file. Status flip + branch name + (when finishing) merge SHA.
- `ANALYSIS.md` — every fix touches this file. Append a structured "Fix applied" entry per the template above.
- `ROADMAP.md` — only if **strategy** changed (a wave splits, ordering changes, a finding moves between waves). Then mirror the change in `tech-debt/README.md` task #N.
- `README.md` (this file) — only if **methodology** changed (branching, working agreements, agent procedure). Rare.
- `AUDIT.md` — **never**. It's a frozen snapshot of the original 35 findings.

If you find yourself updating more than `STATUS.md` + `ANALYSIS.md` (+ your code) for a normal fix, stop and ask why.

---

## Don't touch (yet)

- **Anything in `MondayCalendar.jsx`, `mondayApi.js`, `MappingTab.jsx`, `EventModal.jsx`, `AllDayEventModal.jsx`, `useMondayEvents.js`, `useBoardBuilder.js`, `AdditionalTab.jsx`** beyond the i18n strings in Wave 1 (#3). These are Wave 4 territory and require integration tests (Wave 2) before they're safe to refactor.
- **`patches/react-big-calendar+1.19.4.patch`.** Load-bearing. See F004 in audit.
- **The 8-attempt × 500ms retry loop in `SettingsContext.jsx:212`.** Documented mobile-flake workaround.
- **`window.__monday`** — already gated behind `import.meta.env.DEV` in commit `9131c6d`. Don't re-expose.

---

## Verifying you understood the mission

Before writing any code, the agent should be able to answer:

1. Which wave are we in, and which findings are part of it?
2. Which 6 god-files are off-limits in this wave?
3. Where do you log a completed fix?
4. What test command must pass before committing?
5. Where do new i18n keys go, and in which two files?

If any of these are unclear, re-read this README and the linked sections in `ROADMAP.md`.

---

## Quick file map

```
tech-debt/
├── README.md     ← you are here (mission briefing)
├── AUDIT.md      ← all 35 findings (F001–F035), original
├── ANALYSIS.md   ← per-finding status + fix log (LIVE)
└── ROADMAP.md    ← 5-wave plan with sequencing
```
