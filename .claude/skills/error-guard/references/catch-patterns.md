# Canonical Catch Patterns — per error category

The one sanctioned pattern for each error-source category from `standard.md`. Each pattern
shows a WRONG example (a real gap shape found in audits) and the RIGHT form. All patterns
assume the app roles defined in `standard.md`: the app's logger, the API funnel, the global
handler, the error boundary, the UI error sink.

Grounding: claims marked with source anchors come from the research synthesis
(`research-2026-07.md`) and the Tracker reference implementation.

---

## (a) async/await — try/catch → logger

Every `await` of a fallible operation lives inside a `try/catch` whose catch path reaches
the app's logger (or rethrows to a caller that does).

**WRONG — swallow / default-without-logging:**

```js
async function loadProjects() {
    try {
        return await fetchProjects(boardId);
    } catch {
        return [];   // silent swallow: monitoring never sees this failure
    }
}
```

**RIGHT:**

```js
async function loadProjects() {
    try {
        return await fetchProjects(boardId);
    } catch (error) {
        logger.error('Projects', 'failed to load projects', error);
        return [];   // the fallback is fine — AFTER logging
    }
}
```

If the caller owns the user-facing handling, rethrow instead of logging twice — see
pattern (i) for who logs.

---

## (b) The three network error classes — SEPARATELY

Research confirms these are three distinct classes and each needs its own handling
(`research-2026-07.md` §1 item 4). Conflating them is the single most common source of
false-success paths.

### (b1) HTTP error status — native `fetch` does NOT reject

Native `fetch` resolves successfully on 4xx/5xx; only the network layer failing rejects.
A query function must check `response.ok` and throw, or HTTP failures become invisible
(confirmed against TanStack Query semantics: an error registers only when the function
throws/rejects — returning an error object never surfaces).

**WRONG:**

```js
const res = await fetch(url);
const data = await res.json();   // 500 response sails through as "success"
```

**RIGHT:**

```js
const res = await fetch(url);
if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
}
const data = await res.json();
```

### (b2) True network rejection

The rejection `fetch` DOES produce: DNS failure, offline, CORS, aborted connection.
Caught by the standard pattern (a) around the `await`. Note the AbortError exception
(section (e)) — cancellation surfaces on this path too.

```js
try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
} catch (e) {
    if (e.name === 'AbortError') return;               // deliberate cancellation
    logger.error('Api', 'network request failed', e);   // real network failure OR thrown HTTP error
    throw e;
}
```

### (b3) GraphQL soft errors inside HTTP-200 — MUST become thrown errors

GraphQL execution errors arrive inside a 200 response (`res.errors` populated, `data`
partial or null). This is exactly the class Apollo separates from network errors, and the
class TanStack Query will silently ignore unless converted to a throw
(`research-2026-07.md` §1 item 4, confirmed). The conversion happens **at the API-funnel
layer** — once, for every caller — never ad-hoc in components.

The model is Tracker's `assertNoGraphQLErrors`
(`Axis/tracker/src/utils/mondayApi/assertGraphQL.js`): called immediately after the funnel
on write paths, it throws a typed API error when `res.errors` exists, does **not** log
(the funnel already recorded the canonical soft-error record), and propagates the funnel's
stamped logged-id onto the thrown error so the caller's catch is deduped by log-once.

**WRONG — trusting a 200:**

```js
const res = await safeApi(monday, 'createEvent', mutation, { variables });
return res.data.create_item.id;   // res.errors set → TypeError or false success toast
```

**RIGHT:**

```js
const res = await safeApi(monday, 'createEvent', mutation, { variables });
assertNoGraphQLErrors(res, { functionName: 'createEvent', query: mutation, variables });
return res.data.create_item.id;
```

Rules for the assertion helper: throw a typed error carrying `response`, the request, an
`errorCode`, and `functionName`; no logging inside it; inherit the funnel's correlation id.

---

## (c) Render errors — error boundaries

Error boundaries catch ONLY render-phase throws of the tree below them — not event
handlers, not async callbacks, not rejected promises (`research-2026-07.md` §2, confirmed).
So: a boundary above the whole tree (and per-lazy-tree boundaries), plus a funnel to route
non-render errors INTO the boundary when a fallback screen is the right UX.

**WRONG — no boundary, or a boundary that shows a fallback without logging:**

```jsx
<App />   // any render throw white-screens the iframe — critical gap
```

**RIGHT — react-error-boundary with the onError logging hook:**

```jsx
import { ErrorBoundary } from 'react-error-boundary';

<ErrorBoundary
    FallbackComponent={ErrorFallback}   // Hebrew fallback UI, e.g. "משהו השתבש — נסו לרענן"
    onError={(error, info) => {
        logger.error('ErrorBoundary', 'render error caught', error, {
            componentStack: info.componentStack,
        });
    }}
>
    <App />
</ErrorBoundary>
```

**Funneling async/event-handler errors into the boundary** — when a failure should show
the fallback screen (not just a toast), use `useErrorBoundary().showBoundary(err)`
(`research-2026-07.md` §2, confirmed):

```jsx
import { useErrorBoundary } from 'react-error-boundary';

function SaveButton() {
    const { showBoundary } = useErrorBoundary();
    const onClick = async () => {
        try {
            await saveAll();
        } catch (e) {
            showBoundary(e);   // rendered fallback; onError above does the logging
        }
    };
    return <button onClick={onClick}>שמירה</button>;
}
```

Distinguish chunk-load failures (dynamic `import()` rejections) from real render errors in
the fallback — a chunk failure gets a "reload" action, not a bug screen.

---

## (d) React 19 root options (React 18 fallback: global handlers only)

React 19 `createRoot` accepts `onUncaughtError` / `onCaughtError` (and the pre-19
`onRecoverableError`) — the official hooks to route render-error reporting into the logging
pipeline without patching `console.error` (`research-2026-07.md` §2; workflow verdict
corrected by hand against the createRoot reference). React 19 also de-duplicated boundary
logging: one caught error now produces a single console entry, so no dedup logic should
assume the old triple-fire behavior (confirmed).

**RIGHT — React 19 entry:**

```jsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root'), {
    onUncaughtError: (error, info) => {
        logger.error('ReactRoot', 'uncaught render error (no boundary)', error, {
            componentStack: info.componentStack,
        });
    },
    onCaughtError: (error, info) => {
        // Boundary already handles display; this is the logging tap.
        logger.error('ReactRoot', 'render error caught by boundary', error, {
            componentStack: info.componentStack,
        });
    },
}).render(<Root />);
```

These complement — never replace — `window.onerror` + `unhandledrejection` (the global
handler role), which still catch all non-React errors.

**React 18 fallback:** no root hooks exist. Coverage = error boundary `onError` (for
caught render errors) + the global handler (for everything uncaught). Do not patch
`console.error` to intercept React's reports.

---

## (e) Race conditions

Two sanctioned patterns; pick per situation. The failure mode being prevented: stale
`setState` after unmount, and out-of-order responses overwriting fresh data
(`research-2026-07.md` §1 item 3).

**WRONG — effect with no cancellation or staleness guard:**

```jsx
useEffect(() => {
    fetchEvents(range).then(setEvents);   // unmount or range change → stale write
}, [range]);
```

**RIGHT — pattern 1: AbortController (when the async API accepts a signal):**

```jsx
useEffect(() => {
    const controller = new AbortController();
    (async () => {
        try {
            const events = await fetchEvents(range, { signal: controller.signal });
            setEvents(events);
        } catch (e) {
            if (e.name === 'AbortError') return;   // the ONLY allowed silent path
            logger.error('Calendar', 'failed to load events', e);
        }
    })();
    return () => controller.abort();
}, [range]);
```

**RIGHT — pattern 2: fetch-id / cancelled-flag (when nothing accepts a signal, e.g. SDK
calls):**

```jsx
const fetchIdRef = useRef(0);

useEffect(() => {
    const fetchId = ++fetchIdRef.current;
    let cancelled = false;
    (async () => {
        try {
            const events = await fetchEvents(range);
            if (cancelled || fetchId !== fetchIdRef.current) return;   // stale response — drop
            setEvents(events);
        } catch (e) {
            if (cancelled) return;
            logger.error('Calendar', 'failed to load events', e);
        }
    })();
    return () => { cancelled = true; };
}, [range]);
```

Dropping a stale RESPONSE is not a silent swallow — no error occurred. Dropping a stale
ERROR without logging is allowed only for `AbortError`.

---

## (f) Event handlers calling async work

Error boundaries do not catch event-handler errors (confirmed — see (c)). Every `onClick`/
`onSubmit`/`onChange` that starts async work owns its own catch, and since the user
initiated the action, the failure MUST be displayed (standard.md §5).

**WRONG — floating promise from a handler:**

```jsx
<button onClick={() => saveEvent(draft)}>שמירה</button>
// rejection → unhandledrejection at best; user sees nothing, retries, duplicates data
```

**RIGHT:**

```jsx
const handleSave = async () => {
    try {
        await saveEvent(draft);
        showSuccess('הדיווח נשמר');
    } catch (error) {
        showErrorWithDetails(error, { functionName: 'handleSave' });
        // log-only facade — the UI error sink turns the record into the toast (see (i))
    }
};
<button onClick={handleSave}>שמירה</button>
```

Lint note: `promise/catch-or-return` catches un-terminated `.then()` chains, but a bare
async call with no `.then`/`await` is statically invisible in plain JS — the global
handler is the runtime net for it, and audits check for it manually
(`research-2026-07.md` §4, documented hole).

---

## (g) JSON.parse / storage access guards

Every `JSON.parse` and every storage read is a fallible external-data parse (category 3).
Wrap it, log it, and fall back explicitly.

**WRONG:**

```js
const settings = JSON.parse(res.data.value);           // throws on null/garbage
const cached = JSON.parse(localStorage.getItem(key));   // throws on null
```

**RIGHT:**

```js
function safeParseJson(raw, moduleName, fallback = null) {
    if (raw === null || raw === undefined) return fallback;
    try {
        return JSON.parse(raw);
    } catch (error) {
        logger.warn(moduleName, 'failed to parse stored JSON — using fallback', error, {
            rawPreview: String(raw).slice(0, 120),
        });
        return fallback;
    }
}

const settings = safeParseJson(res.data.value, 'Settings', DEFAULT_SETTINGS);
```

Storage access itself (quota, privacy mode, SDK storage timeouts) gets the same treatment:
`try/catch → logger.warn/error → explicit fallback`. Corrupt-cache reads may fall back at
`warn` level; corrupt SETTINGS on a write path are `error` (data-mutating — critical per
the severity model).

---

## (h) Date/number parsing — NaN / Invalid Date guards before writes

`new Date()`, `parseFloat`, `parseInt` never throw — they return `Invalid Date` / `NaN`,
which then propagate silently into API writes and corrupt board data. Guard the VALUE, not
with try/catch.

**WRONG:**

```js
const hours = parseFloat(input);
await updateItemColumnValues(itemId, { [durationColumnId]: hours });   // NaN → bad write
const date = new Date(userInput);
formatForMonday(date);   // Invalid Date → garbage column value
```

**RIGHT:**

```js
const hours = parseFloat(input);
if (Number.isNaN(hours)) {
    logger.warn('Duration', 'non-numeric duration input rejected', null, { input });
    showError('ערך שעות לא תקין');   // user-initiated → display required
    return;
}

const date = new Date(userInput);
if (Number.isNaN(date.getTime())) {
    logger.warn('Dates', 'invalid date input rejected', null, { userInput });
    showError('תאריך לא תקין');
    return;
}
await updateItemColumnValues(itemId, { ... });
```

Rule of thumb: any parsed date/number that flows into a write (API mutation, storage save)
must pass a `Number.isNaN` guard first. A rejected input on a user action is a validation
message, not a thrown error.

---

## (i) The display contract — one error = one record = one toast

The full pipeline contract (standard.md §6). Ownership of the canonical record:

| Error class | Canonical record owner (logs) | Display |
|---|---|---|
| API error | the API funnel (has query + raw response) | caller's catch calls the display facade — which does NOT re-log (`__loggedId` set) |
| Uncaught / floating promise | the global handler | UI error sink picks up the ERROR record → one toast |
| Render throw | the error boundary (`onError`) | fallback UI |
| Bare validation/render error reaching the facade first | the display facade logs it (no upstream owner) | UI error sink → one toast |

**WRONG — the classic double (log + display side by side):**

```js
} catch (error) {
    logger.error('Calendar', 'create failed', error);          // duplicate record
    showErrorWithDetails(error, { functionName: 'create' });   // → duplicate toast
}
```

**RIGHT:**

```js
} catch (error) {
    // The facade is log-once aware: logs only if !error.__loggedId,
    // and the UI error sink converts exactly one ERROR record into exactly one toast.
    showErrorWithDetails(error, { functionName: 'create' });
}
```

Mechanics that make this hold (they live in the templates and in the Tracker
reference implementation — mechanic 3's soft-error assertion is Tracker-only
(`Axis/tracker/src/utils/mondayApi/assertGraphQL.js`), and so is the log-once-aware
display facade `showErrorWithDetails` (`Axis/tracker/src/utils/errorHandler.js`);
both are adapted per app from Tracker, not copied from `templates/`):

1. The earliest owner stamps `correlationId` on the `Error` instance.
2. The logger's `emit` marks `error.__loggedId` on first pass; repeat passes of the same
   instance are flagged `duplicate` and skipped by sinks (industry-validated: dedup is
   default-on behavior in mainstream error SDKs — `research-2026-07.md` §3).
3. Convert-and-rethrow layers (like the soft-error assertion, (b3)) log nothing and carry
   the stamped id forward.
4. The UI error sink subscribes to the logger and displays; it never logs. Early-init
   errors replay from the logger's ring buffer on mount (capped).

Every catch must therefore do exactly ONE of: call the logger, rethrow, or call the display
facade. The only silent path is `if (e.name === 'AbortError') return;`.
