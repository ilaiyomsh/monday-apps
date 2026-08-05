# Hooks Design — a readable tour of the three enforcement hooks

This page is the "why and how it fits together" companion to `hooks-contract.md`, which is
the binding ABI (exact stdin/stdout shapes, exit codes, state paths). If the two ever
disagree, `hooks-contract.md` wins — this page only explains and points there for specifics.

## Why prompt-level enforcement was rejected

The first version of test-guard was a set of instructions in the skill prose: "don't edit
the test to make it pass," "run a mutation spot-check before declaring done." That doesn't
work, and there is direct evidence it doesn't work for models in this family specifically:

- **METR's and ImpossibleBench's findings**: adding explicit anti-cheating instructions to
  the prompt has a near-zero effect on whether an agent cheats. Telling a model "don't edit
  the tests" does not reliably stop it from editing the tests.
- **Measured cheating rate**: Claude-family agents facing a hard-to-pass test suite edit
  the test file itself (rather than fix the underlying code) more than 79% of the time,
  when nothing but a prompt is standing in the way.

The conclusion this skill draws: if the failure mode is specifically "the agent edits the
test file to make red go away," the countermeasure has to intercept the edit mechanically,
not ask nicely. That is what the three hooks do — they sit in the actual tool-call path
(`PreToolUse`, `PostToolUse`, `Stop`) where Claude Code lets a script allow, deny, or inject
context, independent of whatever the current prompt says.

## The three hooks, at a glance

```
PreToolUse  (Write | Edit | MultiEdit | Bash)
    └── testfile-lock.sh    — can DENY the tool call outright (exit 0 + JSON deny)

PostToolUse (Write | Edit | MultiEdit)
    └── route-nudge.sh      — cannot block (tool already ran); injects a text nudge

Stop
    └── stop-gate.sh        — can BLOCK the session from ending (decision: block)
```

They cover three different moments in an agent's workflow:

1. **Before an edit lands** — stop the specific cheat (editing a locked test file) before
   it happens.
2. **After an edit lands** — for edits that were allowed (product source, not a test file),
   quietly flag when that source has no test-guard coverage yet, so the agent routes
   through `/test-guard` before it forgets.
3. **Before the session ends** — the backstop. If product code was touched this session and
   is still uncovered, hold the stop and say exactly which files and what's missing.

### 1. `testfile-lock.sh` — the lock

A test file becomes "locked" the moment `redgreen.sh red` records a failing run for it, and
stays locked until `redgreen.sh green` records a pass (the LOCK predicate lives in
`hooks-contract.md` §2.3). While locked, this hook denies any `Write`/`Edit`/`MultiEdit` on
that file, and denies `Bash` commands that look like they'd modify it (`rm`, `mv`, `cp` onto
it, `git checkout/restore` on it, shell redirection into it). The intent: once a test is
red, editing it is exactly the move that "fixes" the test instead of the code — the lock
makes that specific move require an explicit, logged exception instead of silently succeeding.

**The escape hatch (amend-intent):** sometimes the test itself is legitimately wrong (a
typo, a fixture that doesn't match the real API shape) and needs to change while still red.
The sanctioned way out is `redgreen.sh amend-intent <test-file> "<reason>"` — this writes a
one-shot flag that the hook consumes on the very next matching tool call, allowing exactly
that one edit through and logging the reason. `redgreen.sh green` will then require
`--amended "<reason>"` to close the gate, so the exception is visible in the state, not
just silently permitted. There is deliberately no way to "stay unlocked" — each amend-intent
is single-use, consumed atomically (`mv`, so a race can't double-spend it).

Full field-level behavior (path normalization, the destructive-verb regex, exact JSON
shapes) is §4.1 of `hooks-contract.md` — not repeated here.

### 2. `route-nudge.sh` — the nudge

This one runs *after* an edit to a non-test, non-config `.js`/`.ts` file inside a monday
app, and it **cannot block** — `PostToolUse` fires after the tool already ran, so the only
lever is `additionalContext`, text injected back to Claude. It looks up whether the touched
source file has a test-guard gate that reached a DONE verdict (or a waiver, or is currently
in-flight under an armed gate/lock). If not, it appends one nudge, once per file per
session (deduped via `nudged.txt`, so the agent isn't spammed on every subsequent edit to
the same file), pointing at `/test-guard tdd` or `/test-guard retrofit`.

It also does bookkeeping regardless of whether it nudges: every qualifying touched file is
appended to `touched.txt` for the session. That log is what `stop-gate.sh` reads — the nudge
hook is where the "what did this session touch" ledger gets built.

### 3. `stop-gate.sh` — the backstop

This is the hook with actual blocking power over ending the turn. On `Stop`, it reads the
same `touched.txt` ledger route-nudge built, recomputes covered/uncovered for each entry
using the identical DONE-verdict logic (§2.4 in the contract), and if anything touched this
session is still uncovered, it emits `{"decision":"block","reason":"..."}` — Claude Code
keeps the session open and feeds that reason back in. The reason text names every uncovered
file and its current state, plus the two ways out: finish the gate, or record an explicit
waiver via `redgreen.sh waive`.

**Deleted paths are skipped, not gated** (contract amendment 13): `touched.txt` is
append-only, so a module created and then deleted within the same session would otherwise
block forever — a file that is gone cannot be run by `green`, mutated by `spotcheck-arm`, or
waived (`resolve_env` stats it), so *every* sanctioned exit is unreachable. The gate now
skips any touched path that no longer exists on disk, before the gate lookup, and reports the
count and paths in `additionalContext` so the skip is on the record rather than silent. This
narrows nothing for files that still exist: same lookup, same verdict, same block.

**Loop safety (max 3 blocks):** a hook that can block Stop forever is a hang risk — if the
agent can't or won't close the gate (a stubborn edge case, a design problem, a
misconfigured project), the session must not loop indefinitely. `stop-gate.sh` keeps a
per-session counter (`stop-blocks.count`) and stops blocking once it reaches
`TEST_GUARD_STOP_MAX_BLOCKS` (default from the contract's §3.4 constant — currently 2 in
the frozen default, tunable via env; some deployments raise it to 3). Past that point it
allows the stop but still emits a warning noting the outstanding modules — "recorded, not
forgiven" — so the gap is visible in the transcript even though the session wasn't held
hostage over it. Each block increments the counter and states its position (`block 1/N`,
`2/N`, …) so the agent can see the budget shrinking.

**The escape hatch here is the same waiver mechanism**, not a different one: `redgreen.sh
waive <test-file> "reason"` is an explicit, logged decision to ship without a gate, and both
route-nudge's coverage check and stop-gate's coverage check treat a waiver as "covered."
There is no silent way to satisfy the gate — only DONE (tests seen red, seen green,
mutation-killed) or a reason on the record.

## How the pieces compose

- `testfile-lock.sh` stops the single most common cheat (edit the test) at the moment it
  would happen.
- `route-nudge.sh` catches the case where an agent does the right thing on the source file
  but forgets to route it through the gate at all — it's a reminder, not an enforcement,
  because PostToolUse structurally can't undo the edit.
- `stop-gate.sh` is what actually enforces the reminder: it refuses to let the session end
  clean while the nudge's own ledger says something is outstanding, with a bounded number
  of refusals so it can't hang the session.

For the exact stdin schema, JSON output shapes, state file layout, and the destructive-verb
matching regex — see `hooks-contract.md`, which is the binding spec these hooks implement.
