# Error-Handling Standard (portfolio-wide)

This document defines when an error source in code counts as **handled**. It is the yardstick
for every fallible site in every app in the portfolio, and the formal input to `audit` mode.
It generalizes the fully-implemented Tracker standard (the reference model) — the same seven
source categories, the same four PASS criteria, the same severity model — expressed in terms
of **roles**, not app-specific file names.

## Role vocabulary

Every wired app provides these roles (names/files vary per app; the roles do not):

| Role | Responsibility |
|------|----------------|
| **the app's logger** | Single funnel for all log records; owns `emit`, sinks, ring buffer, and log-once dedup. Never `console.*` directly. |
| **the API funnel** | The one wrapper through which ALL platform/API calls pass. Logs every call path; converts GraphQL soft errors to thrown errors on write paths. |
| **the global handler** | `window.onerror` + `unhandledrejection` (+ resource-error capture) → the app's logger. The runtime safety net for everything that escapes. |
| **the error boundary** | React boundary above the tree (plus per-lazy-tree boundaries); catches render throws, prevents white screens, logs via the app's logger. |
| **the UI error sink** | Turns qualifying ERROR log records into exactly one user-facing toast/display. Subscribes to the logger; does not log. |

---

## 1. What counts as an "error source"

Every site in code that can fail. Seven categories:

1. **Every `await` of an async operation** — API calls, SDK storage, context fetches.
2. **Direct SDK calls** — `monday.api`, `monday.execute`, `monday.listen`, and equivalents.
3. **Parsing external data** — `JSON.parse`, storage reads, deep field access on API responses that may be missing (`res.data.boards[0]...`).
4. **`useEffect` that launches async work** — race risk, `setState` after unmount, out-of-order responses.
5. **Event handlers that call async operations.**
6. **Code that runs during render and can throw** — null deref on props/state.
7. **Date/number parsing** — `new Date()`, `parseFloat`, `parseInt` on uncertain input.

In addition, two global infrastructures are audited as dedicated items:

- **Global safety net** — the global handler is installed and routes to the app's logger.
- **Error boundary** — a boundary exists above the tree and prevents white screens.

## 2. Scoring dimensions (audit table columns)

| Column | Possible values |
|--------|-----------------|
| Location | `file:line` |
| Action | what the code does |
| Category | API / render / network / race / uncaught / validation / SDK |
| Caught? | no / `try-catch` / `.catch` / wrapper / error boundary |
| Logged? | swallowed / bare `console` only / logger error-level / logger API-error / logger warn |
| Shown to user? | no / toast / inline / fallback UI / not-relevant (background) |
| Clear? | mapped through the app's error parser / generic message / opaque |
| Severity | critical / high / medium / low |
| Verdict | PASS / gap (+ gap type) |
| Proposed fix | short description (not applied — for approval) |

## 3. PASS definition — must satisfy ALL FOUR

1. **Correct-mechanism coverage** — the failure is caught by the mechanism appropriate to its
   category: `try/catch` around `await` for async; error boundary for render; global handler
   for escapees; abort/guard for races. (Canonical pattern per category: `catch-patterns.md`.)
2. **Zero silent swallow** — the failure path calls the app's logger (at some level) with
   module + message + the error object. An empty `catch`, `catch {}`, or a `catch` that only
   returns a default / changes UI without logging = **automatic fail**.
3. **Error identity** — the error has an identity: a code/category (mapped through the app's
   error parser / typed error class), and where it faces the user — a specific Hebrew message
   plus a required-action hint, not a generic fallback.
4. **User-facing display when user-initiated** — see section 5.

## 4. The silent-swallow rule

Every `catch` / `.catch` must include a call to the app's logger. Without it — a gap, even if
the error is "expected" and negligible ("negligible" is a decision you may make only after
SEEING the error, never instead of seeing it).

**The single allowed exception — deliberate cancellation:**

```js
} catch (e) {
    if (e.name === 'AbortError') return;   // deliberate cancellation — not an error
    logger.error('Module', 'operation failed', e);
}
```

**Bare `console`** — code that catches and prints via direct `console.log` / `console.error`
instead of the app's logger: not a swallow (the error is visible), but a **low-severity gap** —
it never reaches any sink and violates the portfolio convention. Marked in the "Logged?"
column as "bare `console` only".

## 5. User-facing display — conditional on impact

| Situation | Display required? | If not displayed |
|-----------|:---:|------------------|
| Failed user action (save / delete / blocking load) | yes | gap — high/critical severity |
| Failure that white-screens / breaks render | yes (fallback UI) | critical gap |
| Background load / prefetch / optional | no | PASS (if logged) |

For every source classified as "user action": check that the catch path includes a display
(the UI error sink / toast / inline / fallback) **and** that the message is specific (mapped
through the app's error parser), not generic.

## 6. The log-once ownership contract

One error = **one canonical log record** = at most **one toast**. Without this contract the
same failure gets logged 3–4 times along its propagation chain (API funnel soft-error log →
funnel catch → caller catch → display layer), and every duplicate would also ship to a remote
sink.

1. **`correlationId`** — an id stamped **once** on the `Error` object at the earliest catch
   point (inside the API funnel when wrapping into the typed error class; inside the global
   handler for non-API errors). Included in every record for that error.
2. **Log-once in `emit`** — the first time an `Error` instance passes through the logger's
   `emit`, it is marked (`error.__loggedId`). A repeat pass of the *same* instance is marked
   `record.duplicate = true`; the console may abbreviate it and remote-sink forwarding is skipped.
3. **Ownership rule — the richest record is canonical, owned by the catch closest to the
   source:** the API funnel for API errors (it has the query and raw response), the global
   handler for uncaught errors, the error boundary for render throws.
4. **Downstream display layers log only if not already logged** — the display facade
   (e.g. a `showErrorWithDetails`-style call) logs **only when** `!error.__loggedId`
   (i.e. only errors that no upstream owner recorded, such as bare render/validation errors).
   Never place a `logger.error` adjacent to the display call for the same error — that
   double-logs and double-displays. Layers that convert-and-rethrow (e.g. a soft-error
   assertion after the funnel) do **not** log; they propagate the stamped id so the eventual
   catch is deduped.

## 7. Severity model

- **Critical** — silent swallow on a data-mutating path (create/update/delete), or an
  uncaught failure that can white-screen (no error boundary).
- **High** — caught but not logged (invisible to monitoring) on a read path; or a generic
  message on a failed user action.
- **Medium** — logged but unclear/unmapped; or missing user display on a user-initiated
  (non-critical) action.
- **Low** — cosmetic / dev-only / bare `console` / already handled but tightenable.

## 8. Out of scope (owned elsewhere)

- **Remote monitoring sink** — this standard stops at the logger boundary. Wiring a remote
  sink/dashboard is the `add-to-status-hub` skill.
- **monday API error shapes, codes, and complexity/rate-limit semantics** — the `monday-api`
  skill.
