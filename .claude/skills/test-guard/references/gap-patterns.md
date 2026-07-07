# Gap Patterns — why agent-written tests pass while the code is broken

Six failure patterns, each observed in the 2026-07-03 mutation audit of this repo's own
suites (full evidence: `audit-2026-07-03.md`). Every pattern ends with the rule that
prevents it. Apply the rules at WRITE time; the mutation spot-check catches what slips.

## P1 — Produced but never asserted

The code computes a field/effect; no test ever looks at it.

- `vacationService.mapRequest` — fixtures set `created_at`, output carries `submittedAt`,
  no assertion touches it.
- `settingsValidation` — the aggregate `errors.columns` key (lights the settings-tab dot)
  asserted for missing columns but not for wrong-type columns.

**Rule:** enumerate the output object's fields when writing the test. Every field is
either asserted or explicitly waived with a comment saying why. "The test passes" is not
evidence for fields nobody read.

## P2 — Boundary named but never fed

The test's NAME claims a boundary or dimension; no fixture actually pins it.

- "stable across DST-style boundaries" — the span contains no DST transition.
- "compares element-wise by id/title/color/index" — no fixture pair differs by exactly
  one of those axes.
- Work-hours validation: `start >= end` guard, but no fixture with `start == end`.
- Year-clip guard: no request ending exactly on Jan 1. Trend split: no entry exactly on
  the midpoint.

**Rule:** if the test name mentions a boundary, at least one fixture must sit exactly ON
it, and one just past it. If the test compares "by X, Y, Z", there must be a fixture pair
per axis differing ONLY in that axis.

## P3 — Factory/mock hides the axis under test

Test factories and mocks fill in every field and answer every call happily, so defaults,
fallbacks, and error/empty branches never execute.

- Employee factory always injects `allocationPercentage` → the `?? 0` missing-FTE
  fallback is unobservable.
- Storage mock ignores its options argument → dropping `previous_version` (optimistic
  concurrency) is invisible.
- Every mocked history window returns data → the empty-window exhaustion rule never runs.

**Rule:** every factory needs an "absent" variant (field undefined/null) and every
suite that mocks persistence/API must assert the ARGUMENTS the mock received, not just
the code's return value. Empty/error mock responses are fixtures too — each guard branch
must execute at least once. For monday-facing code, mocks are generated from captured
probe responses (monday-api skill, LAND step) — never hand-built.

## P4 — Weak assertions: substring, count, "some element"

The assertion is satisfiable by many wrong outputs.

- `formatCost` asserted by substring/prefix — fraction-digit change invisible.
- Markdown report asserted by line COUNT — a reversed sort passes.
- Calendar continuation edges: "some bar has `.cont-start`, some has `.cont-end`" — the
  swapped layout also has "some" of each.

**Rule:** assert exact values whenever the exact value is knowable. For lists, assert
order and content, not length. For DOM, assert WHICH element carries the class, not that
one exists. Substring assertions require a one-line justification.

## P5 — Live code adjacent to a suite, never imported by it

A tested module exports a function the suite never imports; consumers have no tests, so
the function has zero coverage while looking "covered by association".

- `workDaysUtils.isLoadCountedDay` — module has a healthy test file that never imports
  it; its consumers (`useCompanyLoad`, `useEmployeeLoad`) are untested.
- `SettingsDialogShell.handleSave` — the shell has tests (for `setField` only); the whole
  save flow is unexercised across every app that shares it.

**Rule:** when touching a module, diff its EXPORTS against the test file's IMPORTS; every
live export is either tested or flagged. While at it, grep for consumers — an export with
no production importers is dead code: flag it for deletion instead of testing it
(`useProjectCosts` case).

## P6 — Order/precedence unobservable in fixtures

Fixtures are constructed so that only one branch can ever match, making branch ORDER
untestable.

- `projectClassification` — internal/external value sets are disjoint in every fixture,
  so ID-first precedence (the drifted-settings case the design exists for) is invisible.

**Rule:** when the code defines precedence (first-match-wins, ID-before-text), write one
fixture where BOTH branches match and assert which one won.

## P7 — Boundary-exactness (near the boundary is not on it)

The test claims to cover a boundary but every fixture sits comfortably away from it — LLMs
empirically pick "safely inside" or "obviously outside" values, not the exact edge.

- A `>=` guard tested with values 10 and -10 either side of a 0 threshold — never with 0
  itself.
- A date-range "inclusive end" claim tested with a date two days after the end — the actual
  end date is never fed in.

**Rule:** assert AT the named boundary value itself, not merely near it — the fixture must
equal the threshold/edge exactly (`start === end`, `count === limit`, `date === cutoff`),
in addition to one step past it. A test that only exercises values far from the boundary
does not test the boundary.

## P8 — Mock discipline

Mocking is the default failure mode for agent-written tests: agents reach for mocks more
than humans do, and when they do, one mock shape dominates regardless of whether it fits
the case (evidence: agents add mocks in 36% of test commits vs. 26% for humans, and 95% of
those mocks are a single type — interaction/call mocks — a monoculture that misses
state-based bugs).

- An interaction mock (`expect(fn).toHaveBeenCalled()`) with no assertion on what it was
  called WITH — a call with the wrong payload still passes.
- The mock stands in for the very function/module the test is supposed to verify, so the
  test asserts the mock's own behavior, not the unit's.
- `console.log(result)` left in a committed test to "see" the value during development,
  with no accompanying assertion — the value is revealed to the human eye, never checked
  by the suite.

**Rule:** default to no mocks. When a real dependency can't run in-test, prefer a
captured-fixture fake (a real recorded response, monday-api LAND-step style) over an
interaction mock. Never mock the unit under test itself. Every mock that remains must have
its call ARGUMENTS asserted, not just call-count. Any `console.log` that reveals a value
for manual inspection must be converted into an assertion before the test is committed —
a value worth looking at is a value worth checking.

## P9 — Behavior-stating test names

The test name describes the scenario setup or the function called, not the expected
outcome — so a reader (or an LLM judging "does this look right") can't tell from the name
alone whether the test passed for the right reason. Naming quality measurably affects
oracle accuracy: behavior-stating names improve correct pass/fail judgment by +16.1%.

- `"handles the request"` — handles it how? Succeeds? Rejects? Falls back?
- `"works with empty array"` — asserts what, given an empty array?

**Rule:** name = expected outcome + the condition that produces it (e.g. "returns 0 when
allocationPercentage is undefined", "rejects when start equals end"), not the mechanism
being poked. If the name can't state an outcome, the test probably doesn't have one yet.
