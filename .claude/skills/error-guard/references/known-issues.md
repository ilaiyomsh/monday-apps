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
