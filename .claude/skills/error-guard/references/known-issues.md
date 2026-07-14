# error-guard — Known Issues & Self-Correction Log

Log of the skill's OWN defects: false positives/negatives of the rule kit,
script/hook misbehavior, template bugs, and wrong guidance. Protocol: SKILL.md
§ "Self-correction". Every entry gets a date, the trigger, the resolution, and
which consumers were checked. Newest first.

## Sanctioned rule exceptions (false-positive registry)

Shapes the kit flags that are legitimate BY DESIGN. An inline `eslint-disable`
is allowed ONLY for shapes listed here, with a comment naming the entry.

| # | Shape | Why legitimate | Where |
|---|-------|----------------|-------|
| FP-1 | Silent catch inside the UI error sink's own display path | The sink IS the display layer; calling the logger from inside it would recurse through `emit` (its re-entrancy guard exists for exactly this). The logger's `dispatchToSinks` try/catch already reports a throwing sink via raw `console.error`. | `templates/useUiErrorSink.js` (`uiHandler`) |

## Documented false negatives (holes the kit cannot close)

| # | Shape | Net | Status |
|---|-------|-----|--------|
| FN-1 | Bare async call (`doAsync()` with no `await`/`.then`/`.catch`) in plain JS | Runtime: global `unhandledrejection` handler. Audit: manual check listed in mode C. | Permanent (needs TypeScript type info to lint) — see `eslint-rules.md` |

## Defect log

### 2026-07-07 — Template defect: React 19 `onCaughtError` double-surface (FIXED)
- **Trigger:** live smoke in headless Chrome during the build's template verification.
- **Defect:** `entry-react19.jsx` logged boundary-caught render errors as module
  `'ReactRoot'`; since React 19's root `onCaughtError` fires BEFORE
  react-error-boundary's `onError`, that record was the canonical one and the UI
  sink's `startsWith('ErrorBoundary')` filter missed it → toast on top of the
  fallback screen (double surface).
- **Fix:** the `onCaughtError` log module is `'ErrorBoundary:ReactRoot'`
  (`onUncaughtError` deliberately unchanged — with no boundary there is no
  fallback screen, so its toast is the correct single surface).
- **Consumers checked:** scaffold entry template (React 18 wiring — not affected);
  CEO_Display pilot (React 18 entry — not affected).

### 2026-07-07 — Guidance defect: stale "stage 3 — pending" wording (FIXED)
- **Trigger:** pilot agent reported the runbook/SKILL still described
  `check.sh`/`audit.sh` as not yet existing while using them as the acceptance gate.
- **Fix:** wording removed from SKILL.md + retrofit-runbook.md same session.

### 2026-07-14 — check.sh false positive on foreign inline eslint-disable (FIXED)
- **Trigger:** editing `DatePickerPopover.jsx`, which carries an
  `eslint-disable-next-line react-hooks/exhaustive-deps` comment, tripped the
  PostToolUse hook with `[react-hooks/exhaustive-deps] Definition for rule ...
  was not found` — a rule the error-guard config never defines.
- **Defect:** ESLint treats an inline disable that references an unknown rule as
  a ruleId-bearing message, so the gate counted it as a violation. Any file with
  an inline disable for a rule outside the error-guard kit false-failed on every
  edit.
- **Fix:** `check.sh` now runs ESLint with `--no-inline-config`. Side benefit:
  inline comments can no longer silence the error-guard rules themselves
  (aligns with "never silence a rule"). Verified on the trigger file (clean) and
  the rule kit still fires (violations still reported on a crafted bad catch).
