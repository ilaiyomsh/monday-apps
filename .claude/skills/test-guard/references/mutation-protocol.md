# Mutation Protocol

The mechanical answer to "the agent wrote the tests, of course they pass": inject a
realistic bug, watch the tests catch it. A test that stays green while the code is broken
is not a test. Used in three places: the spot-check after TDD green, the retrofit red
gate (characterization tests can't be born red — killing a mutation IS their red), and
the full audit mode.

## Mechanized spot-check (preferred for single modules)

`scripts/redgreen.sh` runs the backup/restore cycle for you and records results in the
gate state (`status` reads them for the done verdict):

```bash
scripts/redgreen.sh spotcheck-arm  src/services/foo.ts src/__tests__/foo.test.ts
# → verifies green baseline, snapshots foo.ts.mutbak
#   now apply exactly ONE semantic mutation to foo.ts with Edit, then:
scripts/redgreen.sh spotcheck-fire src/services/foo.ts src/__tests__/foo.test.ts \
  'flip year-clip boundary r.end < yStart → <='
# → runs the test (must FAIL), restores foo.ts, re-verifies green, records KILLED/SURVIVED
```

Repeat arm→mutate→fire until ≥2 KILLED. A SURVIVED entry blocks the done verdict until
the test is strengthened and the SAME mutation re-applied and killed. The manual protocol
below is for multi-module audits and projects where the script can't run.

## Safety rules (non-negotiable)

- One mutation at a time. Backup/restore protocol:
  `cp SRC SRC.mutbak` → apply single mutation → run tests → `mv SRC.mutbak SRC` (ALWAYS,
  even on error).
- NEVER modify a test file during a mutation run. NEVER git commit/checkout/stash.
- Baseline first: the relevant tests must be green before any mutation; re-verify green
  after the last restore.
- End-of-run check: `find . -name "*.mutbak" -not -path "*/node_modules/*"` must be empty
  and (if a git repo) `git status --porcelain` must match its pre-run state.
- Mutations run on LOCAL code only — this protocol never touches monday data. (Live-API
  probes are a different tool with their own sandbox rules — monday-api skill.)

## Designing mutations

SEMANTIC mutations — bugs an engineer could actually ship:

- boundary flip: `<` ↔ `<=`, `>` ↔ `>=`
- negated / weakened condition: `&&` ↔ `||`, dropped `!`
- wrong key in a produced payload: `label` → `labels`, `_index` → `_idx`
- dropped guard/filter clause (empty-string guards, kind filters, clip guards)
- swapped branches: ternary arms, if/else, spread order (`{...d, [k]: v}` → `{[k]: v, ...d}`)
- changed default/fallback value (`?? 0` → `?? 100`, `null` → `''`)
- off-by-one in date/index arithmetic, `Math.round` → `Math.floor`

NOT mutations (invalid, prove nothing): syntax errors, removed exports, broken imports,
type-only changes. (`spotcheck-fire` records these as INVALID — a mutated run that fails
with no per-test failures doesn't count as a kill.)

**Selection discipline** — the agent picking mutations also wrote the assertions, and
aiming all mutations at the line its strongest `toEqual` already pins produces guaranteed
kills that certify nothing. Therefore: the 2–3 mutations must hit DISTINCT targets, and
at least ONE must target a line, branch, or produced key that is NOT literally quoted in
any assertion of the test file — aim where `gap-patterns.md` P1–P6 predict weakness
(a dropped guard, a boundary operator, an unasserted payload key). The done report names
each mutation's target and which P-pattern axis it probes.

## Verdicts

- **Killed** — at least one relevant test failed. A kill claim REQUIRES evidence: the
  failing test names copied from runner output. Restore and move on.
- **Survived** — all tests passed. Before recording: (a) verify the mutated line is
  reachable and actually exercised (not dead code — if dead, that's a different finding;
  pick another mutation); (b) in audit mode, re-run the FULL project suite once for the
  candidate survivor — a mutation killed by a different test file (integration/consumer
  tests) is a kill, not a survivor. A genuine survivor gets a one-sentence
  `survivalAnalysis`: WHY the suite missed it, classified by pattern
  (`gap-patterns.md` P1–P6).
- **Fixing a survivor** = strengthen the assertion or fixture, then re-apply the SAME
  mutation and watch it die. A fix that was never re-tested against its mutation doesn't
  count — same principle as the red gate.

**Strengthening a SURVIVED verdict is not a free-form retry.** The strengthen step MUST
consume `scripts/survivors.sh report <test-file>` first — the exact line, the mutation
diff, and the hypothesis for why the suite missed it. Guessing at a stronger assertion
without reading that brief throws away the single most useful signal available: targeted,
fine-grained survivor feedback (line + diff + hypothesis, not just "you missed something")
is worth roughly +14 percentage points of fault detection over generic retry prompting
(AdverTest ablation). Read the brief, write the assertion it points at, re-arm, re-fire the
SAME mutation, then `survivors.sh resolve` on a kill.

**Cap strengthen iterations at 4.** Call `survivors.sh iterate <test-file>` once per round;
at iteration 4 it emits a convergence warning and further iteration is not sanctioned —
escalate to the user instead of continuing to guess. This mirrors the empirical convergence
point for automated mutation-killing search (MutGen): additional iterations past ~4 rarely
kill genuine survivors and more often signal an equivalent mutant or an untestable seam
that needs a redesign or an explicit waiver, not more test-writing effort.

## Spot-check sizing

- After TDD green / after retrofitting a module: 2–3 mutations on the changed module,
  aimed at the logic the tests claim to cover. All must be killed before the change is
  done.
- Full audit (`/test-guard audit`): 3 mutations per module across the suite — run the
  parameterized workflow `.claude/workflows/mutation-audit.js` via the Workflow tool
  (one agent per project, parallel; pass `[{name, dir, scope}]` as args). Report: kill
  rate + survivor list; survivors become the fix backlog (see `audit-2026-07-03.md` for
  the baseline run's format).

## Manual gate (no vitest/jest, REDGREEN_RUNNER not viable)

When `redgreen.sh` can't run mechanically, the gate is manual but NOT self-judged:

1. Red: run the test with the project's runner; paste the failing output into the
   transcript; confirm the failure is an assertion (or NOT_IMPLEMENTED stub throw) —
   not module resolution, syntax, or a TypeError on a missing function.
2. Green: re-run after implementing; paste the passing summary (must show ≥1 test
   executed, none skipped without justification).
3. Spot-check: follow the Safety rules above by hand (`.mutbak` copy, one mutation,
   run, restore, re-verify green) and report each mutation + verdict with evidence.

"Judged red manually" with no pasted output is not compliance.
