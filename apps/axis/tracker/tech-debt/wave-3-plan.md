# Wave 3 Plan — Unify API Wrappers (F013 + F014)

> **Status:** plan, awaiting build kickoff. See `STATUS.md` Wave 3 queue for sub-task tracking.
> Per-task contracts (In-scope / Out-of-scope / Verification baseline) live in `STATUS.md`. This file is the rationale + design context.

---

## Context

Wave 2 (integration test harness + 6 golden-flow tests) landed at merge `622bb15` on `chore/tech-debt-sweep`. Wave 4 (god-file splits) is unblocked on the test side, but **not** on the API-layer side: `src/utils/mondayApi.js` (1,418 LOC) still ships two wrappers with divergent semantics. Splitting it now would relocate that divergence across multiple files. Wave 3 collapses the divergence first so Wave 4.2 (`mondayApi.js` split) is purely structural.

**The two wrappers today:**

| Wrapper | Defined at | Call sites | Retry on 429/500? | Throws on GraphQL soft errors? | Returns |
|---|---|---|---|---|---|
| `wrapMondayApiCall` | `mondayApi.js:196-257` | 27 internal (in same file) | ✅ yes (`MAX_RETRIES=2`, exponential backoff, honors `retry_in_seconds`) | ✅ yes (wraps in `MondayApiError`) | `{ response, duration }` |
| `safeApi` | `mondayApi.js:271-314` | 53 external + 4 internal across 17 files | ❌ **no** | ❌ no — logs at ERROR, returns `rawResponse` | raw response |

Both share `MondayApiError` for transport-error wrapping. Both validate the query via `validateQuery`. Both call `logger.api`/`logger.apiResponse`/`logger.apiError`. The retry helpers (`isRetryableCode`, `isRetryableError`, `getRetryDelay`, `RETRYABLE_STATUS`, `MAX_RETRIES`, `RETRYABLE_MESSAGE_PATTERNS`) are already factored as private functions and exposed for testing via `_testHelpers` (`mondayApi.js:1418`). `mondayApiRetry.test.js` covers them.

**The user-visible bug (F014):** the documented 429 burst in `docs/api-concurrency-issue.md` only retries when the caller is one of the 27 `wrapMondayApiCall` sites. The 53 `safeApi` callers — which include hot paths like `useFilterOptions`, `useMondayEvents` pagination tail, `useDashboardData`, `useColumnOptions` — fail hard on 429 with no recovery, surfacing as an `ErrorDetailsModal` toast.

Wave 3 is **F013 + F014 only**. Wave 4 (god-file splits) remains gated behind it for the API-layer files.

---

## Approach — 4 task branches

Mirrors Wave 2's pattern: docs-only seed, then small mechanical PRs. Each follows the contract in `STATUS.md` with In-scope / Out-of-scope / Verification baseline, branches off `chore/tech-debt-sweep`, gets reviewed, merges, and promotes the next row.

| # | Sub-task | Branch | Touches |
|---|----------|--------|---------|
| 3-plan | This plan + STATUS rows + Wave 2 archive (docs only) | `tech-debt/wave-3-plan` | `tech-debt/{STATUS,ANALYSIS,wave-3-plan}.md` |
| 3.1.0 | Extract `executeWithRetry(fn, options)` helper — pure refactor | `tech-debt/wave-3.1.0-extract-retry` | `mondayApi.js`, `__tests__/mondayApiRetry.test.js` |
| 3.1.1 | Apply retry to `safeApi` via `executeWithRetry` | `tech-debt/wave-3.1.1-safeapi-retry` | `mondayApi.js`, new `__tests__/safeApiRetry.test.js` |
| 3.1.2 | Integration regression — `safeApi` retries on 429 in a real flow | `tech-debt/wave-3.1.2-safeapi-integration` | new `src/__tests__/integration/safeApiRetry.test.jsx` |

The 4-PR split (vs. ROADMAP §3.1's "one PR ~1 day") is a methodology choice — small reviews, per-PR revertability. 3.1.0 is the highest-judgment piece (refactor without behavior change); 3.1.1 is where the user-visible fix lands; 3.1.2 proves it under the Wave 2 harness.

**Deferred to Wave 4.2 (per ROADMAP §3.1 step 3):** migrating the 27 internal `wrapMondayApiCall` callers in `mondayApi.js` to `safeApi`. That migration only makes sense once the file splits — re-routing 27 sites twice (now and during the split) is wasted churn.

---

## 3.1.0 — Extract `executeWithRetry(fn, options)`

Pure refactor. The retry loop currently lives inside `wrapMondayApiCall` (`mondayApi.js:204-256`). Extract it so both wrappers can call it.

**Shape:**
```js
// Internal helper — not exported (yet — 3.1.1 may export for tests).
const executeWithRetry = async (fn, { functionName, onRetry } = {}) => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt < MAX_RETRIES && isRetryableError(error)) {
                const delay = getRetryDelay(error, attempt + 1);
                onRetry?.({ error, attempt: attempt + 1, delay });
                await sleep(delay);
                continue;
            }
            throw error;
        }
    }
};
```

`wrapMondayApiCall` rewrites internally to call `executeWithRetry(() => oneAttempt())`, where `oneAttempt` does the `apiCall()` + GraphQL-error-throw + logging. **No public-API change.** The 27 callers don't notice.

- **In scope:** `mondayApi.js` — extract `executeWithRetry`; rewrite `wrapMondayApiCall` to use it. Add `executeWithRetry` to `_testHelpers` so `mondayApiRetry.test.js` can target it directly. Add ~5 new unit tests in `mondayApiRetry.test.js` for the extracted helper (retries on retryable, throws after MAX_RETRIES, no retry on non-retryable, honors `retry_in_seconds`, calls `onRetry` callback).
- **Out of scope:** `safeApi` (3.1.1's job). Behavior change of any kind in `wrapMondayApiCall`. Logging-format changes. Any call-site edit.
- **God-files:** `mondayApi.js` is the file under refactor — narrow surgical edits at lines 196-257 only.
- **Verification baseline expected:** lint stays at 34. Tests `708/709` (708 prior + 5–8 new). Build clean. Manually: spot-check that one `wrapMondayApiCall` caller (e.g., `fetchProjectsForUser`) still retries on a synthesized 429.

**Risk:** subtle log-output drift. The old loop logs the retry warning **before** sleep using `_getErrorExtensions(error)?.code` to extract `errorCode`. Keep that exact log path inside the `onRetry` callback so log assertions (if any) keep passing. The reviewer should diff log lines before/after.

---

## 3.1.1 — Apply retry to `safeApi`

The user-visible fix for F014. `safeApi` swallows GraphQL soft errors — that contract stays. Retry only applies to **transport-level** failures (the `catch` branch in `safeApi`), exactly like `wrapMondayApiCall`.

**Shape:**
```js
export const safeApi = async (monday, callerName, query, options = {}) => {
    const { warnings: queryWarnings } = validateQuery(query);
    logger.api(callerName, query, options.variables || null);

    const startTime = Date.now();
    let rawResponse = null;

    const oneAttempt = async () => {
        rawResponse = options.variables
            ? await monday.api(query, { variables: options.variables })
            : await monday.api(query);
        // GraphQL soft errors: log only, don't throw — preserves safeApi contract.
        // (Unchanged — only transport errors propagate to executeWithRetry.)
        return rawResponse;
    };

    try {
        const response = await executeWithRetry(oneAttempt, {
            functionName: callerName,
            onRetry: ({ error, attempt, delay }) => {
                const retryCode = error.errorCode || _getErrorExtensions(error)?.code;
                logger.warn('API', `${callerName} - Retryable error, attempt ${attempt}/${MAX_RETRIES}, waiting ${delay}ms`, {
                    errorCode: retryCode, attempt
                });
            }
        });
        const duration = Date.now() - startTime;
        logger.apiResponse(callerName, response, duration);

        if (response?.errors?.length > 0) {
            logger.error('API', `${callerName} - GraphQL errors in response`, {
                query, rawResponse: response, errors: response.errors, queryWarnings
            });
        }
        return response;
    } catch (error) {
        // existing catch block — wrap in MondayApiError, re-throw
        // (unchanged)
    }
};
```

Key invariants preserved:
1. **GraphQL soft errors still don't throw.** They're returned to the caller exactly as before. None of the 53 sites change behavior on this path.
2. **Transport errors still throw `MondayApiError`** — but only after retries are exhausted.
3. **Soft GraphQL errors with retryable codes do NOT retry.** This matches `wrapMondayApiCall`'s spirit: retry happens in the catch branch, and soft errors don't enter the catch in `safeApi`. Documenting the asymmetry is part of the F013 contract — both wrappers retry transport-level failures; only `wrapMondayApiCall` retries on retryable GraphQL soft errors (because it throws on them). Acceptable: 429 from monday's GraphQL transport is reported via HTTP status / `extensions.code` on a thrown error, not via soft errors. The Wave 2 + 3.1.2 integration test exercises the realistic path.

- **In scope:** `mondayApi.js` `safeApi` body — wire to `executeWithRetry`. New `src/utils/__tests__/safeApiRetry.test.js` — 6–8 tests: retries on 429 transport error, retries on `RATE_LIMIT_EXCEEDED`-coded thrown error, gives up after `MAX_RETRIES`, does NOT retry on non-retryable transport (e.g., 401), does NOT retry on soft GraphQL errors (call counts == 1), honors `retry_in_seconds` from the SDK error, wraps final failure in `MondayApiError` with `query` and `apiRequest` populated.
- **Out of scope:** any call-site change (none of the 53 callers should need modification — that's the proof). `wrapMondayApiCall` (3.1.0 already wired). New retry config knobs. Adding a global request queue (ROADMAP §3.1 "Optional" — explicitly deferred).
- **God-files:** `mondayApi.js` only — `safeApi` body edit.
- **Verification baseline expected:** lint stays at 34. Tests `708 + 3.1.0's_new + 6–8 new = 716–718 / one-more-than-pre-existing-failures`. Build clean. **Manual smoke (recommended):** run `pnpm start`, open the calendar with throttled network in DevTools forced to fail one request, verify the toast no longer appears for a transient 429.

**Risk to flag during review:** test isolation. The retry loop uses real `setTimeout` via `sleep()`. Tests must pin `vi.useFakeTimers()` and advance time deterministically, or the suite slows to ~6 seconds per retry test (worst case 2s + 4s exponential). Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(delay)` per attempt.

---

## 3.1.2 — Integration regression: `safeApi` retries on 429 in a real flow

Proves end-to-end that the F014 fix lands in user-flow code paths, not just unit-tested in isolation. Reuses the Wave 2 harness (`renderCalendar.jsx` + `mondayMock.js`).

**Test outline:**
1. `renderCalendar()` with the standard seeded settings.
2. Configure the mock to throw a 429-shaped error on the first `useFilterOptions` query, succeed on the second.
3. Open `FilterBar` → assert reporters dropdown eventually populates (i.e., the retry kicked in).
4. Assert `monday.api` was called twice for that operation name.

This catches regressions where a future refactor removes retry from `safeApi` — the Wave 2 unit smoke wouldn't notice (it doesn't throw 429); the unit retry test from 3.1.1 wouldn't notice (it doesn't run through `useFilterOptions`).

- **In scope:** `src/__tests__/integration/safeApiRetry.test.jsx`. Extend `mondayMock.js` only if necessary to support per-call response sequencing (a small `respondInSequence([err, ok])` helper). Reuse `renderCalendar()` defaults.
- **Out of scope:** any production-code change; new harness scaffolding beyond a single per-call sequencer; testing more than one flow.
- **God-files:** none modified.
- **Verification baseline expected:** lint 34; tests `+1` over 3.1.1; build clean.

---

## Critical files

**Touched (production code):**
- `src/utils/mondayApi.js` — extract retry helper (3.1.0); apply to `safeApi` (3.1.1).

**Touched (tests):**
- `src/utils/__tests__/mondayApiRetry.test.js` — extended in 3.1.0.
- `src/utils/__tests__/safeApiRetry.test.js` — new in 3.1.1.
- `src/__tests__/integration/safeApiRetry.test.jsx` — new in 3.1.2.
- `src/test-utils/mondayMock.js` — minor extension in 3.1.2 (per-call sequencing) only if needed.

**Read-only references during builds:**
- `docs/api-concurrency-issue.md` — the documented 429 issue F014 references.
- All 17 `safeApi` consumer files (used as input to the "no caller breaks" verification, not modified).

**Tracking docs (per Wave-1/2 contract):**
- `tech-debt/STATUS.md` — Wave 3 queue + 4 per-task specs (added in this plan branch).
- `tech-debt/ANALYSIS.md` F013 + F014 — one structured `**Fix applied (Wave 3.1.x):**` entry per merged sub-task.
- `tech-debt/ROADMAP.md` — only if a sub-task deviates from §3.1's intent. None expected.

---

## Reuse — DO NOT reinvent

Already in repo, all consumed by Wave 3:
- `isRetryableCode` / `isRetryableError` / `isRetryableMessage` / `getRetryDelay` / `_getErrorExtensions` — `mondayApi.js:161-192`. Already covered by `mondayApiRetry.test.js`. **Do not edit semantics.**
- `MondayApiError` — `mondayApi.js:91-108`. Used by both wrappers; no shape change in Wave 3.
- `validateQuery` / `extractOperationName` — `mondayApi.js:71`. Already called by both wrappers; no change.
- `MAX_RETRIES = 2`, `RETRYABLE_STATUS = [429, 500, 502, 503]`, `RETRYABLE_MESSAGE_PATTERNS` — `mondayApi.js:152-159`. Single source of truth — both wrappers already share these.
- Wave 2 harness (`renderCalendar.jsx`, `mondayMock.js`, `apiPayloadCapture.js`) — leveraged by 3.1.2.

The retry helpers are already factored. Wave 3 is essentially: extract the *loop*, plumb it into `safeApi`, prove it.

---

## Risks to flag

1. **Test timing on real `setTimeout`.** `sleep()` uses real timers. New retry tests must use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` or each retry test takes 2–6 seconds. Same risk applied in `mondayApiRetry.test.js` — check how it handles timing (it tests helpers in isolation, doesn't execute the loop, so it doesn't hit this; 3.1.0/3.1.1 do).
2. **Log-format drift.** The retry warning today reads `${functionName} - Retryable error, attempt N/MAX_RETRIES, waiting Xms`. Preserve the exact string under both wrappers — search-for-this-string runbooks may exist in monday's ops world.
3. **GraphQL soft errors with retryable codes.** Asymmetry between the two wrappers (see 3.1.1 invariants). Acceptable but document in `ANALYSIS.md` F013 closing entry.
4. **Hot-path regression.** `useMondayEvents` pagination tail is a `safeApi` caller. Adding retry means a single 429 in pagination can now cost up to 6 extra seconds of waiting. Acceptable (preferable to "lost half the calendar"), but flag in the merge note.
5. **Internal-callers deferral.** `wrapMondayApiCall`'s 27 internal callers stay on `wrapMondayApiCall` until Wave 4.2. Resist the urge to migrate them in Wave 3 — re-routing 27 sites twice is the kind of churn the wave methodology exists to prevent.

---

## Verification — end-to-end

After each sub-task lands on `chore/tech-debt-sweep`:

```bash
pnpm exec eslint src/ --ext .js,.jsx --max-warnings 34   # exit 0
pnpm run test:run                                         # 708 prior + N new; pre-existing featureFlags failure unchanged
pnpm run build                                            # clean
```

After all 4 sub-tasks merged:
- `pnpm run test:run` reports ~720 passing (708 prior + ~5–8 from 3.1.0 + ~6–8 from 3.1.1 + 1 from 3.1.2).
- `safeApi` retries transient transport failures; `wrapMondayApiCall` behavior unchanged.
- `tech-debt/ANALYSIS.md` F013 + F014 stamped with `**Fix applied (Wave 3.1.x):**` entries and verdict moved to ✅ FIXED.
- Wave 4.2 (`mondayApi.js` split) unblocked: the file ships one retry loop, two wrappers that share it, and a clear migration target (`safeApi` is now the canonical wrapper for new code).

**Manual smoke after 3.1.1 (recommended):** open the calendar with DevTools network throttling on, force one request to 429, confirm no toast and the data loads. Document outcome in the `**Fix applied:**` entry.

---

## Out of scope for Wave 3

- Migrating the 27 internal `wrapMondayApiCall` callers to `safeApi` — Wave 4.2.
- Splitting `mondayApi.js` — Wave 4.2.
- Global request queue / startup staggering (ROADMAP §3.1 "Optional"). Defer until evidence shows retry alone doesn't cover 95% of 429 hits.
- New retry knobs (custom backoff, jitter, per-call MAX_RETRIES override). Not requested by any caller.
- Touching `MondayApiError` shape, log levels, or `validateQuery`.
- Any Wave 4 god-file extraction.
