# Error-Guard — Deep Research Synthesis (2026-07-07)

Sources: deep-research workflow run `wf_fd791d06-444` (25 sources fetched, 11 claims adversarially confirmed 3-0, 13 claims unverified due to session limit — marked ◐ below, each independently consistent with model knowledge and official docs), plus the Tracker reference implementation (`Axis/tracker/error-handling-bundle/`).

Legend: ✅ = confirmed 3-0 by adversarial verification · ◐ = high-confidence, verification incomplete · ⚠ = workflow verdict corrected by hand.

---

## 1. Error taxonomy — what a complete net must cover

The research confirms the 7-category taxonomy already used by the Tracker standard, and sharpens three distinctions:

1. **Render throws** — only catchable by React Error Boundaries.
2. **Unhandled promise rejections / floating promises** — invisible to boundaries; need `unhandledrejection` + lint.
3. **Async/race** — stale `setState` after unmount, out-of-order responses; need AbortController or fetch-id guards.
4. **Network failure vs. HTTP error status vs. GraphQL soft error** — three distinct classes:
   - ◐ Native `fetch` does **not** reject on non-2xx HTTP statuses — query functions must check `response.ok` and throw, or HTTP failures become silent (TanStack Query docs). `axios`/`graphql-request` throw automatically.
   - ✅ Apollo distinguishes **GraphQL errors** (execution errors inside an HTTP-200 response) from **network errors** — the exact "soft error in 200" class the monday API exhibits.
   - ✅ Apollo default `errorPolicy: 'none'` **discards `data` entirely** when any GraphQL error is present; `errorPolicy: 'all'` populates both `data` and `error` enabling partial-result rendering. Design decision, not an accident.
   - ✅ TanStack Query registers an error **only when the query function throws / rejects** — returning an error object silently never surfaces. GraphQL soft errors MUST be converted into thrown errors. This independently validates Tracker's `assertNoGraphQLErrors` pattern.
5. **Chunk-load failures** — need lazy-retry + a chunk-vs-render distinction in the boundary fallback.
6. **Storage/JSON parse** — guard every `JSON.parse` and storage access.
7. **Third-party SDK / host-page errors** — in iframe-embedded apps, host-page noise pollutes error streams (see §4 filtering).

## 2. Catching mechanisms — state of the art

- ✅ **Error Boundaries catch ONLY render-phase throws** of the tree below them. NOT caught: event handlers, async callbacks/`setTimeout`, unresolved promises, SSR, throws inside the boundary itself (react-error-boundary docs). A boundary-only strategy leaves most real-world error classes uncovered → global handlers + catch discipline are mandatory, not optional.
- ✅ **`react-error-boundary`** exposes `onError(error, componentStackInfo)` as the sanctioned logging hook, and ✅ the **`useErrorBoundary().showBoundary(err)`** hook re-routes async/event-handler errors into the nearest boundary — one funnel for render and non-render errors. React 19 alternative: errors thrown inside `startTransition` are caught by boundaries.
- ⚠ **React 19 root options** — the workflow refuted this 0-3 against the React 19 blog post, but the refutation is wrong on substance: `createRoot(container, { onCaughtError, onUncaughtError, onRecoverableError })` are documented in the `createRoot` reference. Correct nuance: `onRecoverableError` predates 19; `onCaughtError`/`onUncaughtError` are the React 19 additions. For React 19 apps (Tracker is on 19.2) these are the official hooks to route render-error reporting into a logging pipeline *without* patching `console.error`.
- ✅ **React 19 de-duplicated boundary logging**: pre-19, one caught error produced ~3 console reports (double throw + component-info `console.error`); React 19 logs a single entry. Any log-once/dedup contract must not assume the old triple-fire behavior.
- ✅ **Sentry's React integration** models the two-tier architecture explicitly: `reactErrorHandler()` as the **global safety net** wired into React 19 root hooks + `Sentry.ErrorBoundary` for **scoped fallbacks**, complementing each other. ✅ Its boundary exposes `beforeCapture` (enrich with tags/context before send) and `onError` (propagate to app state) — the catch→enrich→log pipeline shape. Tracker's local stack (globalErrorHandler + ErrorBoundary + `showErrorWithDetails`) is structurally identical to this industry pattern.

## 3. Logging pipeline conventions

- ◐ **Dedup is default-on industry behavior**: Sentry ships a `Dedupe` integration enabled by default — duplicate error events are dropped before reporting. Tracker's log-once `correlationId`/`__loggedId` contract is the same idea implemented locally. Keep it; it is not over-engineering.
- ◐ **`beforeSend`** (mutate-or-suppress-by-returning-null) is the standard client-side filter hook before a record leaves the app. The error-guard logger template should keep an equivalent single choke-point (`emit`) where redaction/suppression can be added.
- ◐ **Third-party error filtering for embedded apps**: Sentry's `thirdPartyErrorFilterIntegration` (SDK ≥ 8.10) tags first-party bundles with an `applicationKey` at build time and inspects stack frames at runtime to drop host-page noise — directly relevant to monday iframe apps when a remote sink goes live. For the local pipeline: filter records whose stack contains no first-party frame.

## 4. Lint-level enforcement — what exists and where the holes are

- ◐ **`no-restricted-syntax`** accepts arbitrary ESTree selectors + a **custom message per selector** — the mechanism behind Tracker's proven `catch-must-log` rule. The custom message doubles as *agent instruction*: the lint error text literally tells the AI agent which invariant it violated and how to fix it. Write these messages as remediation instructions, not just prohibitions.
- ◐ **`@typescript-eslint/no-floating-promises`** targets the floating-promise class directly, defining exactly five accepted handlings (`.then(ok, err)` / `.catch(fn)` / `await` / `return` / `void`). **Requires type information → unavailable in Tracker-style plain-JS projects.** Also has a known loophole: default `ignoreVoid: true` lets `void somePromise()` silence the rule without handling anything — an AI agent *will* discover this suppression; set `ignoreVoid: false` in TS projects.
- ◐ **`eslint-plugin-promise` / `catch-or-return`** — works **without type info** (fits JS apps): every `.then()` chain must terminate in `.catch()` (or be returned). Default also flags the two-arg `then(onFulfilled, onRejected)` form because the rejection handler does not catch throws from the fulfillment callback (`allowThen` disables — keep it off).
- **Residual hole (no off-the-shelf rule in plain JS):** a *bare async call* `doAsyncThing()` (no `.then`, no `await`) is invisible to `catch-or-return` and needs type info for `no-floating-promises`. Mitigations, in order: (a) the `unhandledrejection` global handler is the runtime net — this is why it is non-negotiable; (b) a heuristic `no-restricted-syntax` selector for known-async local API surfaces (e.g. calling `safeApi`/storage helpers as a bare ExpressionStatement) is feasible per-project; (c) full closure requires TypeScript — out of scope by standing decision.
- **Conclusion for the skill:** enforcement trio (proven in Tracker) + `eslint-plugin-promise/catch-or-return` = the practical JS-project maximum. Document the bare-call hole explicitly so audits look for it manually.

## 5. Deterministic enforcement on AI-generated code

Web results on this angle were thin (the field is young); grounded primarily in Claude Code's own harness semantics:

- **Lint-on-edit feedback loop**: a `PostToolUse` hook on `Edit|Write` for `*.js|*.jsx|*.ts|*.tsx` runs the error-rules-only ESLint pass on the *single edited file* (fast) and returns violations as feedback (exit 2 → the agent sees the message and self-corrects immediately, while the code is still in working memory). Non-blocking for the file write itself; blocking for the agent's attention.
- **Hard gate at the irreversible step**: the same scanner runs as a required check inside the ship/deploy procedure (`ship.sh` preflight) and fails the deploy on any violation. Rationale: immediate feedback maximizes correction quality, the gate guarantees nothing slips through — same two-tier logic as Sentry's safety-net-plus-boundary.
- **Lint messages are the contract**: since the same rules fire in the hook, in CI, and in the gate, encode the *how-to-fix* into the rule message once (see §4).
- **Determinism principle**: agent-facing enforcement must be a real tool exit code, not prose in a skill file. Skills teach the pattern; hooks and gates enforce it. (Direct parallel: test-guard's red-gate script vs. its SKILL.md.)

## 6. What this changes in the error-guard design (delta vs. the pre-research recommendation)

1. **Templates get a React-19 path**: entry template wires `createRoot(container, { onUncaughtError, onCaughtError })` → logger, alongside (not replacing) `window.onerror`/`unhandledrejection` for non-React errors. React 18 apps keep the boundary-only + console-patch-free variant.
2. **Prefer `react-error-boundary` in *new-app* templates** (`onError` + `showBoundary` funnel) — less custom code than Tracker's class boundary; Tracker itself stays on its test-locked local implementation (existing standing decision).
3. **ESLint kit grows from 3 to 4 rules**: `no-console` + `no-empty` + `catch-must-log` (selector) + `promise/catch-or-return` (new dep: `eslint-plugin-promise`). TS projects additionally get `no-floating-promises` with `ignoreVoid: false`.
4. **catch-patterns reference must cover the three-class network taxonomy** (`response.ok` / network reject / GraphQL-soft-in-200) and the "convert soft errors to throws" rule for any data-fetching layer (validated by both Apollo and TanStack Query semantics).
5. **Logger template keeps `emit` + log-once + ring buffer** (industry-validated) and adds a documented `beforeSend`-style suppression point + first-party stack filter note for future remote sinks.
6. **Document the bare-async-call hole** in the audit checklist — the one class static analysis cannot close in plain JS.
