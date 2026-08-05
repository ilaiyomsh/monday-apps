---
name: test-guard
description: "The canonical testing skill — makes agent-written tests able to FAIL, so green means something. v2 adds a physical enforcement layer (hooks): locked test files, a session stop gate, survivor-driven strengthening. Use whenever writing or changing tests, doing TDD for new code, adding tests to an existing app, or judging test quality: unit tests, vitest/jest work, characterization tests, coverage questions, 'are these tests real?'. Trigger on the user's phrases: טסטים, בדיקות, לכתוב טסטים, בדיקות יחידה, כיסוי, מוטציות, TDD. Also invoked as `/test-guard tdd`, `/test-guard retrofit [path]`, `/test-guard audit [path]`, `/test-guard status`, `/test-guard strengthen <module>`, `/test-guard waive`."
argument-hint: "[tdd | retrofit [path] | audit [path] | status | strengthen <module> | waive]"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task, Workflow
---

# test-guard — tests that can fail

The failure mode this skill exists to end: the same agent writes the code and the tests,
both encode the same misunderstanding, everything is green, nothing is proven. Empirical
baseline in THIS repo (2026-07-03 mutation audit, `references/audit-2026-07-03.md`):
**32% of realistic injected bugs survived the existing suites** (68% kill rate) — survivors
cluster into repeatable patterns (`references/gap-patterns.md`).

The audit's sharpest lesson: tests written against a NAMED, OBSERVED failure killed every
mutation; tests written "to have tests" asserted weakly. Therefore the iron rule:

> **A test that was never seen failing does not count.**
> New code: the test fails first (red gate). Existing code: the test kills a mutation.
> Either way, failure is observed before green is trusted.

All gates run through `scripts/redgreen.sh` — a STATEFUL gate: red records the test file's
hash and failing test names; green blocks if the file changed, if zero tests ran, if tests
are skipped, or if a red-recorded test vanished. Don't reason around the script — run it.

## The gates are PHYSICAL now (v2 hooks)

Research finding (`references/research-2026-07-07.md`): prompt-level anti-cheating has
near-zero effect; Claude-family agents cheat >79% of the time by EDITING TEST FILES. So
v2 enforces mechanically — three hooks are registered in `.claude/settings.json` and fire
regardless of what any prompt says (design tour: `references/hooks-design.md`):

1. **Test-file lock** (PreToolUse): between `red` and `green`, any Write/Edit of the test
   file — and any Bash `rm`/`mv`/`cp`/`git checkout`/redirect onto it — is DENIED.
2. **Route nudge** (PostToolUse, non-blocking): editing product source with no armed gate,
   no DONE verdict, and no waiver injects a reminder to route through this skill.
3. **Stop gate** (Stop): the session cannot end while a touched module is neither DONE nor
   waived. It blocks at most `TEST_GUARD_STOP_MAX_BLOCKS` (default 2) times, then yields
   with a recorded warning — it never hangs the session. A touched path **deleted** during
   the session is skipped (no code left to cover) and the skip is reported, not silent —
   nothing to gate, and every gate command needs the file to exist.

Do not fight the hooks; use the sanctioned exits, both logged:

- **Locked test genuinely wrong?** `scripts/redgreen.sh amend-intent <test> "<reason>"` —
  unlocks exactly ONE edit (one-shot, consumed atomically); `green` then requires
  `--amended "<reason>"`, and ≥1 spot-check mutation must target the amended assertion.
- **Gate genuinely inapplicable?** `scripts/redgreen.sh waive <test> "<objective reason>"`
  — satisfies nudge and stop gate. Only for objectively trivial code (no conditionals, no
  arithmetic, no key mapping; pure passthrough/config).

Never weaken a test to make it pass. Never signal a hook block with a workaround file
path or a rephrased destructive command — the deny reasons name the legitimate way out.

## Iron rules (all modes)

1. **Red before green** — `redgreen.sh red <test>` then `redgreen.sh green <test>`.
   Between them the test file is hash-locked AND hook-locked (see above).
2. **Mutation spot-check after green** — `redgreen.sh spotcheck-arm` / `spotcheck-fire`,
   ≥2 KILLED mutations per changed module (`references/mutation-protocol.md`, including
   selection discipline: distinct targets, ≥1 aimed where no assertion pins the line).
   Waiver only per the objective-triviality bar above.
3. **Assertion quality at write time** — apply P1–P9 from `references/gap-patterns.md`:
   every produced field asserted or waived (P1); named boundaries actually fed (P2);
   factories have an "absent" variant, mock ARGUMENTS asserted (P3); exact values over
   substrings/counts (P4); exports diffed against consumers (P5); precedence pinned by a
   both-branches-match fixture (P6); boundary fixtures sit exactly ON the edge (P7); no
   mocks by default, captured-fixture fakes over interaction mocks, never mock the unit
   under test, no value-revealing console.log in committed tests (P8); test names state
   expected outcome + condition, never "works"/"handles it" (P9).
4. **Real fixtures for monday-facing code** — mocks generated from captured probe
   responses per the monday-api skill (LAND step), never hand-built. Probes obey the
   sandbox rules (TEST_WORKSPACE_ID, WZ- prefix) — monday-api's domain, defer to it.
5. **No coverage targets.** Coverage is gameable by exactly the tests this skill exists
   to prevent (measured: 100% coverage with 4% mutation score). The metric is kill rate.
6. **Impact-scoped, not test-everything.** Naive procedural "TDD all the things" measured
   WORSE than no TDD at all; impact-targeted testing cut regressions 70%. Before writing
   tests for a change, run `scripts/impact.sh <changed-src-file>` and aim tests at the
   impacted behaviors/consumers it lists. Volume is not the KPI; passed gates are.

## Scope: what gets unit tests at all

- YES: services, domain logic, column-value mappers, webhook handlers, date/money/balance
  math, settings persistence/validation, layout math (e.g. calendar bar packing).
- NO: interaction/visual behavior of React views inside the monday iframe — that goes
  through the `verify` skill / browser automation, not unit tests. Don't force TDD on JSX
  (the route nudge already excludes `.jsx`/`.tsx`).

## Mode: TDD (new code) — `/test-guard tdd`

1. **Scope by impact**: `scripts/impact.sh` on the module(s) being changed; target the
   impacted behaviors (rule 6).
2. **Write tests via a test-writer subagent — this is the DEFAULT** for any new module
   with logic. The subagent receives ONLY the spec/contract and the interface (signatures,
   types, fixtures) — never your implementation ideas or code — so the tests can't inherit
   your misunderstanding, and an author who can't see the implementation can't pin it.
   Inline writing is the exception, reserved for trivial cases (single pure function,
   obvious contract).
3. **Stub, then red.** Create signatures as stubs (bodies `throw new Error('NOT_IMPLEMENTED')`)
   so the red failure is behavioral, not a missing import. Then
   `scripts/redgreen.sh red <test-file>` — must pass (assertion/NOT_IMPLEMENTED failures
   count; passing tests and plumbing failures fail the gate).
4. Implement. The test file is hook-locked during this step (amend-intent for the exception).
5. **Green gate:** `scripts/redgreen.sh green <test-file>`.
6. **Spot-check:** per module, `spotcheck-arm` → ONE semantic mutation via Edit →
   `spotcheck-fire` with a description; repeat until ≥2 KILLED. On SURVIVED, enter the
   strengthen loop below.
7. Done = `scripts/redgreen.sh status <test-file>` prints `VERDICT: DONE`.

**If you jumped ahead** and real logic already exists: say so explicitly and take the
retrofit flow with ≥3 killed mutations instead of 2. Jumping ahead never buys a lower bar.

## Mode: RETROFIT (existing app) — `/test-guard retrofit [path]`

1. Inventory by risk: webhook handlers → column_values mappers → money/date/balance/domain
   logic → settings persistence/validation → UI logic. Per module, run `impact.sh` first:
   untested live exports get tests; exports with no production importers get flagged as
   dead code (its `DEAD-CODE CANDIDATES` section), not tests.
2. Write characterization tests with real fixtures (rule 4). Writer-subagent default
   applies when the module has real logic.
3. Characterization tests are born green, so their red gate is a killed mutation:
   `spotcheck-arm` → mutate → `spotcheck-fire`. First kill = red equivalent; complete
   ≥2 KILLED per module per the protocol's selection discipline.
4. Batch report at the end: modules covered, kill counts, dead code flagged.

## Mode: AUDIT (existing tests) — `/test-guard audit [path]`

Measures whether existing suites catch real bugs. Run the parameterized workflow
`.claude/workflows/mutation-audit.js` (Workflow tool, args = `[{name, dir, scope?}]`) or
follow `references/mutation-protocol.md` manually for one module. Kill claims require
named failing tests; survivors are confirmed against the FULL suite. Output: kill rate +
survivor list classified by gap pattern. Survivors are the fix backlog — fixing one goes
through STRENGTHEN below. Baseline: `references/audit-2026-07-03.md`.

## Mode: STATUS — `/test-guard status`

`scripts/redgreen.sh status-all` — aligned table of every tracked test file
(RED/GREEN/LOCKED/KILLED/SURVIVED/WAIVER/VERDICT). For one file: `redgreen.sh status <test>`;
`redgreen.sh locked` lists currently locked files. Read-only, runs no tests.

## Mode: STRENGTHEN (survivor loop) — `/test-guard strengthen <module>`

A survivor means a missing assertion, and fine-grained feedback is what makes the fix
work (measured: showing the surviving diff/line vs just the count is worth ~14pp fault
detection). Per round:

1. `scripts/survivors.sh record <test> --src <src> --line <N> --hypothesis "..."` with the
   mutation diff on stdin (spotcheck-fire already logs the SURVIVED line — no `--log-kills`).
2. `scripts/survivors.sh report <test>` — the strengthen-brief: each OPEN survivor's exact
   diff, file:line, and hypothesis. Strengthen the assertion the hypothesis names.
3. Re-arm and re-fire the SAME mutation; watch it die. Then
   `scripts/survivors.sh resolve <test> <NNN>` (rewrites the SURVIVED line so the verdict
   can reach DONE) and `survivors.sh iterate <test>` once per round.
4. **Max 4 iterations.** Research shows convergence by ~4; at the warning, stop looping
   and escalate to the user — remaining survivors indicate an equivalent mutant or an
   untestable seam. Propose redesign or an explicit waiver, not iteration 5.

## Mode: WAIVE — `/test-guard waive`

`scripts/redgreen.sh waive <test-file> "<objective reason>"` — the ONLY sanctioned way to
mark a module covered without a passed gate. The reason must be objective (triviality per
rule 2's bar, or genuinely out of scope, e.g. JSX-visual). Waivers are recorded in state
and visible in `status`/`status-all`; the stop gate and nudge honor them. A waiver on
code with real logic is a lie to your future self — say so to the user before writing one.
A path that no longer exists on disk is accepted (state-only resolution) so a module
deleted mid-session can still get a recorded waiver — the stop gate already skips it, so
this is audit trail, not the escape itself.

## Runner support

`redgreen.sh` auto-detects vitest/jest from the nearest `package.json` (monorepo-aware:
runs from the nearest package dir, binary may be hoisted; never auto-installs). Other
runners: `REDGREEN_RUNNER='npx mocha' scripts/redgreen.sh ...`, or if no mechanical runner
fits, follow the **Manual gate** in `references/mutation-protocol.md` — paste the failing
and passing outputs into the transcript; self-judged green without either is not compliance.
All scripts honor `REDGREEN_STATE_ROOT` (testing only — never point it elsewhere to dodge
a lock or the stop gate).

## Self-improvement — when the skill itself misfires

The gates and hooks are code and WILL have defects; the loop below produced contract
amendments 5–7 on this skill's first day of real use. When a gate blocks you or a nudge
looks wrong:

1. **A blocking gate is DATA, never an obstacle.** Assume it is right first; diagnose
   against `references/hooks-contract.md` (the binding ABI) before touching anything.
2. **Confirmed false positive?** Fix the mechanism, prove the fix with a fixture (crafted
   stdin payload / `REDGREEN_STATE_ROOT` sandbox — both directions: the false positive
   gone AND the true positives still firing), and record a numbered amendment in
   `references/hooks-contract.md` in the SAME session. A fix without an amendment is a
   future regression.
3. **Can't fix now?** Record a Known-gap entry in the contract page (what observed, fix
   directions), surface it to the user, and use only the sanctioned escapes
   (`amend-intent`, `waive`, the stop gate's counted yield) — all logged, never silent.
4. **Never weaken enforcement to get unblocked.** Narrowing a check is legitimate ONLY
   when the blocked action was provably safe — the fixture from step 2 is that proof.

## Definition of done (any mode)

`scripts/redgreen.sh status <test-file>` prints `VERDICT: DONE`. That means:
- [ ] Red observed (red gate) or retrofit kills recorded — no unresolved SURVIVED entries
      (resolve via `survivors.sh resolve`, never by hand-editing kills.log)
- [ ] Green gate passed (no zero-test/skipped-suite greens); any amend on record
- [ ] ≥2 KILLED mutations, or an objective waiver on record
- [ ] No leftover `.mutbak` files; tree clean
- [ ] monday-facing fixtures traceable to a probe capture (not checkable by the script —
      state it in the done report)

The stop gate independently verifies every touched module reaches this bar (or a waiver)
before the session may end.
