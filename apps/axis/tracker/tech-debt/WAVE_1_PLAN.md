# Wave 1 — Implementation Plan

**Created:** 2026-05-07
**Branch base:** `chore/tech-debt-sweep` (each PR branches off this)
**Goal:** Close 4 low-risk hygiene tasks before any god-file refactor.
**PR strategy:** 1 PR per task (4 PRs total). Each merges back into `chore/tech-debt-sweep`.

---

## Decisions locked in (2026-05-07)

| Decision | Choice |
|----------|--------|
| `REFACTORING_ROADMAP.md` + `TASKS_PLAN.md` | **Delete entirely** (git history is the record) |
| `ARCHITECTURE.md` | **Rewrite from scratch** (current is 400 LOC, stale, mentions removed `@mondaycom/apps-sdk`) |
| README language | **English only** |
| PR strategy | **4 PRs**, one per Wave 1 sub-task |

---

## PR ordering & dependencies

```
1.1 (docs cleanup)  →  1.2 (README rewrite)  →  1.3 (i18n)  →  1.4 (ESLint)
                       ↑                          ↑              ↑
                       depends on 1.1             independent    runs after 1.3
                       (rewritten                                so its lint is
                       ARCHITECTURE.md)                          included
```

Each PR ships independently. Order matters because:
- 1.2 (README) links to `ARCHITECTURE.md`, which 1.1 rewrites.
- 1.4 (ESLint) baseline runs after 1.3 (i18n) so newly-added `useTranslation` imports are linted in the same baseline.

---

## PR 1.1 — Docs cleanup (F015 + F016 + F017 + F018 + F034) ✅ DONE (2026-05-07, commit `1e4398b`)

**Branch:** `tech-debt/wave-1.1-docs-cleanup` off `chore/tech-debt-sweep`

**Outcome:** 8 files changed, -2,451 / +73 LOC. Deleted `REFACTORING_ROADMAP.md`, `TASKS_PLAN.md`, `docs/api-calls-full-mapping.md`, `docs/reporting-board-api-calls.md`, plus orphaned `StructureOption.module.css` (caught in review). Trimmed CLAUDE.md size table to a one-line `wc -l` pointer. Rewrote `ARCHITECTURE.md` (400 → 87 LOC) — current stack, no `@mondaycom/apps-sdk`, adds `@hebcal/core`/`react-i18next`/`react-swipeable`. F016/F017/F018/F034 closed in `tech-debt/ANALYSIS.md`; F015 partial (README still pending in 1.2). Build ✅; tests 700/701 (the one failure pre-exists this branch — `featureFlags > isLanguagePickerEnabled` — unrelated to docs).

### Scope (do)

**Delete entirely:**
- `REFACTORING_ROADMAP.md` (435 LOC, dated 2026-01-19, mostly resolved)
- `TASKS_PLAN.md` (931 LOC, dated 2026-01-19, partially resolved)
- `docs/api-calls-full-mapping.md` (144 LOC, drift since `mondayApi.js` grew 60%)
- `docs/reporting-board-api-calls.md` (470 LOC, same)

**Modify:**
- `CLAUDE.md` — remove "Key Files by Size" table (lines 31–52). Replace with one line: `> File sizes drift; for current counts run` ` ``find src -name '*.js*' -not -path '*/__tests__/*' \| xargs wc -l \| sort -rn \| head`. ``
- `ARCHITECTURE.md` — full rewrite. New structure (target ≤ 250 LOC):
  1. **What this is** — one paragraph: Hebrew RTL Monday Board View for time tracking.
  2. **Tech stack** — current actual stack (no `@mondaycom/apps-sdk`, add `@hebcal/core`, `react-i18next`, `react-swipeable`, `@vibe/core`).
  3. **High-level flow** — 1 ASCII C4-style diagram: Monday Platform → App.jsx → Calendar/Settings.
  4. **Layers** — entry, contexts, hooks, components, utils, i18n. Brief paragraph each.
  5. **State management** — Settings (Context + monday.storage), local component state. Why no Redux.
  6. **Event types** — link to CLAUDE.md for the long version.
  7. **Build & deploy** — one paragraph: vite build → mapps push.
  8. **For deeper info** — link table to CLAUDE.md sections.

**Keep:**
- `docs/api-concurrency-issue.md` — referenced by F014, still applicable.
- All other `docs/*.md` (incident notes, settings-wizard, dashboard plans).

### Scope (don't)
- Don't touch `tech-debt/*` (this PR shouldn't change the tech-debt docs).
- Don't change `CLAUDE.md` beyond removing the size table.

### Verification
- `pnpm run build` ✅
- `pnpm run test:run` ✅ (701/701)
- Manual: `grep -r "REFACTORING_ROADMAP\|TASKS_PLAN\|api-calls-full-mapping\|reporting-board-api-calls" --include="*.md"` — should return zero outside the deleted files.
- Manual: open new `ARCHITECTURE.md` in a fresh window. Does someone unfamiliar understand what the app does in 60 seconds?

### Expected size
~10 files changed, ~1,800 LOC deleted, ~250 LOC added (new ARCHITECTURE.md).

### Update `tech-debt/ANALYSIS.md`
Mark F015, F016, F017, F018, F034 as ✅ FIXED with date and what changed.

---

## PR 1.2 — README rewrite (F015)

**Branch:** `tech-debt/wave-1.2-readme` off `tech-debt/wave-1.1-docs-cleanup` (or off the merged `chore/tech-debt-sweep` if 1.1 lands first)

### Scope (do)
Replace `README.md` (currently Monday Quickstart boilerplate) with a real product README. Target ≤ 200 LOC, English.

**Sections:**
1. **Title + one-line tagline.** "Monday.com Board View for Hebrew/English work-hours reporting"
2. **What it does** (3-4 bullets, user-facing):
   - Drag-and-drop calendar UI in Hebrew (RTL) or English (LTR)
   - Tracks billable/non-billable hours, vacation/sick/reserves
   - Configurable column mapping to any Monday board
   - Manager approval flow + multi-user filtering
3. **Screenshots / GIF** — placeholder (`<!-- TODO: add screenshot -->`); skip for now.
4. **Quick start** — `pnpm install`, `pnpm start`, then "open the tunnel URL in Monday's iframe."
5. **Commands** — table of `pnpm` scripts (start/build/deploy/test/expose/stop) with a sentence each.
6. **Configuration** — bullet list of env vars (`MONDAY_SIGNING_SECRET`, `PORT`, etc.) without copy-pasting from `apps/.claude/CLAUDE.md`. Link to it.
7. **Documentation** — link table:
   - `CLAUDE.md` — coding conventions, hooks, settings reference
   - `ARCHITECTURE.md` — high-level architecture
   - `tech-debt/` — ongoing tech-debt cleanup
8. **Tech stack** — one-line summary.
9. **License / contribution** — TBD if not already specified.

### Scope (don't)
- Don't paste the full hooks list or settings reference (they live in CLAUDE.md).
- Don't translate to Hebrew (decision: English only).
- Don't add new screenshots in this PR (separate concern).

### Verification
- Render the README on GitHub (push branch, view on github.com) — formatting OK?
- All internal links resolve.
- Word count < 700 (rough cap to keep it scannable).

### Expected size
1 file changed. README from ~30 LOC of boilerplate → ~150-200 LOC of real content.

### Update `tech-debt/ANALYSIS.md`
F015 already partly addressed by 1.1; close it fully here.

---

## PR 1.3 — i18n completion for 5 components (F029)

**Branch:** `tech-debt/wave-1.3-i18n-final-five` off latest `chore/tech-debt-sweep`

### Scope (do)
Audit and migrate 5 components, in this order (high → low user exposure):

| # | Component | Path | Why first |
|---|-----------|------|-----------|
| 1 | `Toast` | `src/components/Toast/Toast.jsx` | Most-frequently rendered |
| 2 | `ErrorDetailsModal` | `src/components/ErrorDetailsModal/ErrorDetailsModal.jsx` | Critical to error UX |
| 3 | `UndoBanner` | `src/components/UndoBanner/UndoBanner.jsx` | Frequent, after delete actions |
| 4 | `SettingsValidationDialog` | `src/components/SettingsValidationDialog/SettingsValidationDialog.jsx` | Rare but blocks first-install flow |
| 5 | `MobileResizeOverlay` | `src/components/MobileResizeOverlay/MobileResizeOverlay.jsx` | Edge case |

**Per component:**
1. Open the file, list every literal Hebrew string.
2. If zero: skip. Note in PR description.
3. If non-zero:
   a. Add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();`.
   b. Choose a namespace (e.g., `toast.*`, `errorModal.*`, `undoBanner.*`).
   c. Add keys to **both** `src/i18n/locales/he/translation.json` and `src/i18n/locales/en/translation.json`.
   d. Replace each Hebrew string with `t('namespace.key')`. Use `{{count}}` interpolation for plurals.
4. Run `pnpm run test:run` after each component (the keySymmetry test will catch he/en mismatches).

### Scope (don't)
- Don't touch other components in this PR.
- Don't refactor the components beyond i18n.
- Don't add a `useLocale` migration — that's a separate concern (already done for most of the codebase).

### Verification
- `pnpm run test:run` ✅ (especially `src/i18n/__tests__/keySymmetry.test.js` — fails if he and en have different key sets).
- Manual: switch language in dev (`localStorage.setItem('i18nextLng', 'en')`, refresh) — every previously-Hebrew string is now in English.
- `grep -nE "[א-ת]" src/components/{Toast,ErrorDetailsModal,UndoBanner,SettingsValidationDialog,MobileResizeOverlay}/*.jsx` — returns zero matches outside comments.

### Expected size
5 component files + 2 translation.json files modified. Estimated +50/-50 lines per component, plus ~30 lines of new keys per locale. Total ~10 files changed.

### Update `tech-debt/ANALYSIS.md`
Mark F029 as ✅ FIXED with audit results (which had strings, which didn't).

### Risk
**Low.** Each component is small and self-contained. The keySymmetry test catches the most-likely failure mode (forgot to add a key in one locale).

---

## PR 1.4 — ESLint baseline + CI enforcement (F033)

Baseline run on 2026-05-07 produced **171 problems (54 errors, 117 warnings)** — too large for one review pass, so the cleanup was split into three task branches before the CI gate. Final plan: **A1 → A2 → A3 → B**. See `README.md` and `ROADMAP.md` for the canonical sequence.

### PR A1 — `tech-debt/wave-1.4a-eslint-baseline` ✅ MERGED (commit `81e0390`)
Cleared all 54 errors + low-risk warning categories: auto-fix `import/first`, fix malformed `eslint-disable` comments (em-dash silently broke rule names), lift hooks above early returns to fix `rules-of-hooks`, name anonymous default exports, `no-mixed-operators` parens, `default-case`, drop unused `vi` test imports. Result: **95 problems (0 errors, 95 warnings)**.

### PR A2 — `tech-debt/wave-1.4b-unused-vars`
Remaining `no-unused-vars` triage — delete dead imports/destructured fields/locals. Three intentional cases (setter-only `useState`, dormant `fetchAssignmentMirrorColumns` feature) annotated with `// eslint-disable-next-line no-unused-vars -- <Hebrew rationale>`. Expected result: **48 problems (0 errors, 48 warnings)** — all `react-hooks/exhaustive-deps`.

### PR A3 — `tech-debt/wave-1.4c-exhaustive-deps`
`react-hooks/exhaustive-deps` per-callsite triage. Highest-judgment piece. For each warning:
- **Real issue** (missing dep that masks a stale closure): fix by adding the dep.
- **Intentional** (e.g., effect that should run only on mount): `eslint-disable-next-line` with Hebrew rationale.
- **Pre-existing disables** in `useMondayEvents.js`: leave as-is, don't widen scope.

### PR B — `tech-debt/wave-1.4d-eslint-ci`
Edit `.github/workflows/test.yml`:
```yaml
- name: Lint
  run: pnpm exec eslint src/ --ext .js,.jsx --max-warnings 0
```
Add before the test step so lint failures surface fast. Optionally add `pnpm audit --prod --audit-level=high` as a non-blocking step (`continue-on-error: true`) for F004 visibility.

### Scope (don't)
- Don't migrate to a different config (`eslint-plugin-react`, etc.) — current `react-app` is fine.
- Don't add Prettier here (separate concern).
- Don't rewrite code to fix style — fix only what eslint flags.

### Verification (per PR)
- `pnpm exec eslint src/ --ext .js,.jsx` warning count drops as expected.
- `pnpm run test:run` ✅ no regressions.
- `pnpm run build` ✅.
- After PR B: push, confirm CI runs lint and blocks on warnings.

### Update `tech-debt/ANALYSIS.md`
Each merged PR appends a "Fix applied" line documenting the wave. Mark F033 as ✅ FIXED only after PR B lands.

### Risk
**Medium.** First time lint has run here. Real bugs surfaced in A1 (`rules-of-hooks` violations, malformed disable comments). A3 carries the most judgment — flag any suspicious `exhaustive-deps` warning in PR description rather than silently disabling.

---

## Working agreements (re-stated here for convenience)

These come from `tech-debt/README.md` and `CLAUDE.md`:

- Hebrew comments only.
- All user-facing strings via `t()`. Both `he` and `en` json files updated together.
- Use `logger`, not `console`.
- `pnpm run test:run` must pass before commit (baseline: 701/701).
- `pnpm run build` must succeed.
- Don't commit unless the user asks. Stage and report.
- Update `tech-debt/ANALYSIS.md` after every fix.

---

## Sequencing summary

| Day | PR | Effort estimate | Blockers |
|-----|----|--------|---------|
| 1 | PR 1.1 (docs cleanup + ARCHITECTURE.md rewrite) | half day | none |
| 2 | PR 1.2 (README rewrite) | 2 hours | 1.1 merged |
| 3-4 | PR 1.3 (i18n × 5 components) | half-full day | none (parallel-able with 1.2) |
| 5 | PR 1.4 — Phase A (eslint cleanup) | 2 hours – full day | 1.3 merged |
| 6 | PR 1.4 — Phase B (CI step) | 30 min | Phase A merged |

Real calendar time: 1-2 weeks if interleaved with other work.

---

## When Wave 1 is done

- 6 stale doc files deleted, ARCHITECTURE.md rewritten.
- README is real.
- 5 final components fully i18n'd.
- ESLint runs in CI on every push.
- `tech-debt/ANALYSIS.md` shows ✅ FIXED on F015, F016, F017, F018, F029, F033, F034.

**Then:** Wave 2 begins (integration tests for the god-files). That's the gate before any of the F005/F006/F007 refactors can start.

---

## Open question for after Wave 1 (don't act on this now)

Should `chore/tech-debt-sweep` be merged into `main` periodically (after each wave?), or held back and merged as one big PR at the end of Wave 4? Affects review burden and risk of conflicts. Decide before Wave 2.
