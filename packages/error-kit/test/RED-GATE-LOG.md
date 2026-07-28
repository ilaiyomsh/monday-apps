# RED-GATE-LOG — @mapps/error-kit

Each of the 5 fixes was written TDD-first: the test was authored against the AS-IS
baseline (ported verbatim from `@axis/app-core`), RUN, and OBSERVED FAILING before the
implementation existed. This log records the observed red for each — test name + the
assertion line that failed against the baseline. Only after logging the red was the fix
implemented and the test driven green.

Baseline before fixes: 92 tests passing (44 transport + 21 sink + 2 attach-guard +
8 global-handler + 17 server, ported/adapted from app-core + team-people-column + deadline-confirm).

---

## Fix 1 — droppedShipFailure counter  (test/fix-transport.test.ts)

RED (against baseline, no counter existed):
- `fix1: droppedShipFailure counter > F1a: a failed single-event flush increments droppedShipFailure by that event count`
  → `expect(...droppedShipFailure).toBe(1)` — Received: undefined (stats had no such field)
- `F1b: a failed multi-event batch counts every lost event`
  → `expect(...droppedShipFailure).toBe(3)` — Received: undefined
- `F1c: a successful flush does NOT increment droppedShipFailure`
  → `expect(...droppedShipFailure).toBe(0)` — Received: undefined
- `F1d: the inert (gated-off) transport reports droppedShipFailure: 0`
  → `expect(...droppedShipFailure).toBe(0)` — Received: undefined  (line 132)

Fix: `ship()` increments `droppedShipFailure += count` on every failed POST; field added to
AxiomTransportStats, the live stats(), and the inert stats.

## Fix 2 — terminal (hidden) flush with an OPEN breaker  (test/fix-transport.test.ts)

RED (against baseline: an open breaker inside its 60s window made doFlush a no-op for ALL
reasons, so a page-close flush shipped nothing and lost the queue silently):
- `fix2: terminal flush with an open breaker > F2a: hidden flush while OPEN still fires exactly one keepalive POST of the queued events`
  → `expect(fetchFn).toHaveBeenCalledTimes(4)` — got 3 (open → no-op, zero POST)
- `F2b: a failing terminal keepalive send counts the loss in droppedShipFailure`
  → `expect(fetchFn).toHaveBeenCalledTimes(4)` — got 3
- `F2c: a succeeding terminal keepalive send ships the queued events (shipped increments)`
  → `expect(stats().shipped).toBe(shippedBefore + 2)` — Received: +0 (nothing shipped)

Fix: doFlush's open-breaker branch, when reason==='hidden', performs one best-effort
cutBatchHidden()+keepalive ship regardless of the breaker window (at-most-once makes it safe);
a failed send is counted by fix 1's droppedShipFailure.

## Fix 5 — dedup key includes err_name + first 40 chars of the error message  (test/fix-transport.test.ts)

RED (against baseline dedup key = `level|tag|message`, so distinct errors sharing one
generic logger message collided and were dropped as duplicates):
- `fix5: ... > F5a: distinct err_name under the SAME logger message does not dedup-collide`
  → `expect(s.queued).toBe(6)` — Received: 5 (the RangeError collided on the message and was dropped)
- `F5c: err_msg differing within the first 40 chars does not collide`
  → `expect(s.queued).toBe(6)` — Received: 5
- `F5b: genuinely identical errors STILL dedup (5-per-window policy preserved)` — GREEN on
  baseline (kept as the regression guard that the 60s window / 5-per-key policy is unchanged).

Fix: dedup key is now `level|tag|message|err_name|err_msg.slice(0,40)`; window (60s) and
per-key cap (5) unchanged.

## Fix 3 — extended `stack` (top 5, scrubbed, cap 1500) + `component_stack` (scrubbed, cap 1000)
   (test/fix-transport.test.ts + test/fix-sink.test.ts)

RED (baseline shipped only `stack1` and never read context.componentStack; the transport
allowlist had neither `stack` nor `component_stack`, so both were sanitizer-dropped):
- `fix3 (transport): ... > F3t: stack ships capped at 1500 and component_stack capped at 1000`
  → `expect((e.stack).length).toBe(1500)` — key dropped by sanitizer → undefined
- `fix3 (sink): extended stack > F3s-a: ships `stack` = top 5 frames joined by newline, alongside the compat `stack1``
  → `const frames = (ev.stack).split('\n')` — TypeError: Cannot read properties of undefined (reading 'split')  (line 37)
- `F3s-b: each frame is scrubbed (a token in a frame URL is redacted)`
  → `expect(ev.stack).toContain('[redacted]')` — ev.stack undefined
- `fix3 (sink): component_stack from context > F3s-d: ships component_stack when the record context carries componentStack`
  → `expect(ev.component_stack).toContain('in App')` — ev.component_stack undefined
- `F3s-f: component_stack is scrubbed ... and capped at 1000`
  → `expect(ev.component_stack).not.toContain('admin@corp.com')` — ev.component_stack undefined
- `F3s-c` / `F3s-e` (absence guards) — GREEN on baseline; kept as privacy/absence regressions.

Fix: buildAllowlist adds `stack`(1500) + `component_stack`(1000); the sink ships
`stack` = top-5 frames each via scrubMessage joined by '\n' capped 1500, and
`component_stack` = scrubCapped(context.componentStack, 1000).

## Fix 4 — ErrorBoundary ships componentStack in the ERROR record context  (test/ErrorBoundary.test.tsx)

RED (baseline componentDidCatch called `logger.error('ErrorBoundary', msg, error)` with NO
context arg, and emitted a separate `logger.debug(...)` DEBUG record that never shipped):
- `ErrorBoundary — fix 4 ... > F4a: componentDidCatch passes { componentStack } as the ERROR record context`
  → `expect(error).toHaveBeenCalledWith('ErrorBoundary', 'render blew up', err, { componentStack: ... })`
    — called with only 3 args (no context)  (line 28)
- `F4b: no separate DEBUG record is emitted (it never shipped)`
  → `expect(debug).not.toHaveBeenCalled()` — was called 1 time (line 38)
- `F4c: getDerivedStateFromError flips hasError to true` — GREEN on baseline (unchanged behavior).

Fix: componentDidCatch now calls `logger.error('ErrorBoundary', error.message, error,
{ componentStack: info.componentStack })` and the separate `logger.debug` call is removed,
so the sink's component_stack mapping (fix 3) has a record context to read.

## drift.test.ts — 2026-07-21

**Purpose:** guarantee the vendored copies (3 browser SPAs + 3 server sinks) never rot
against the canonical error-kit contract.

**Red-gate (browser contract):** the `BROWSER_CHECKS` list (gate inertness, fix1
droppedShipFailure, fix2 terminal flush, fix3 stack/component_stack allowlist, fix5 dedup
key) was run against `makeBrokenTransport` — an in-memory transport with the OLD
`level|tag|message` dedup key and NO droppedShipFailure accounting (a faithful stand-in for
the pre-fix telemetry-dashboard copy that this change repaired).

- Observed: the broken variant FAILS fix1 (droppedShipFailure stays 0), fix5 (the RangeError
  behind the shared message dedup-collides → queued 5, droppedDedup 1), fix2 and fix3 as well
  (4 of 5 checks reject it). The committed meta-test asserts `failures >= 2`.
- Confirmed independently by pointing the same checks at the real telemetry-dashboard copy
  BEFORE it was re-vendored: fix1/fix2/fix3/fix5 all red. After re-vendoring from the canonical
  source, all green.

**Server contract:** the `is opts-injected` check was seen RED against the pre-migration
telemetry-dashboard server sink (module-level `process.env.AXIOM_*` reads); green after the
sink was migrated to the opts-injected model and index.js was rewired to inject the config.
