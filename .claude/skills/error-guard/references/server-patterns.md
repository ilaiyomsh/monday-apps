# Server-side error patterns — Express on monday-code (integration apps)

The server ruler. Client patterns (`catch-patterns.md`) still apply to any React
admin SPA the app serves; THIS page covers the Node/Express process. Templates:
`templates/server/` (logger, axiomServerSink, asyncHandler, errorMiddleware,
processGuards). The integration-scaffold pre-wires all of them.

## The server error-source categories

Every one of these gets a catch mechanism BEFORE the task is done:

1. **Async route handlers** — Express 4 does NOT catch rejected promises. Unwrapped,
   a rejection hangs the request AND becomes an unhandledRejection (fatal by policy).
2. **Sync throws in handlers** — Express catches these natively → error middleware.
3. **Webhook endpoints** — special response contract (see below).
4. **Scheduler/cron/queue jobs** — no request context; top-level catch per run.
5. **Outbound calls** (monday API, Google, fetch) — timeouts + the three network
   classes from `catch-patterns.md` (HTTP status ≠ rejection; GraphQL soft-200).
6. **Storage/SecureStorage access** — parse guards + rate-limit awareness.
7. **Process level** — uncaughtException / unhandledRejection: the last net.

## Pattern per category

### (1) Async handlers — wrap EVERY one

```js
// WRONG — Express 4 never sees the rejection; request hangs, process net fires
router.post('/action', async (req, res) => {
  const data = await doWork(req.body);       // rejection escapes
  res.json(data);
});

// RIGHT — asyncHandler forwards the rejection to next(err) → error middleware
import { asyncHandler } from '../services/asyncHandler.js';
router.post('/action', asyncHandler(async (req, res) => {
  const data = await doWork(req.body);
  res.json(data);
}));
```

Rule of thumb: `grep -n "async (req" src/` — every hit must be inside
`asyncHandler(...)`. The audit checks this.

### (2)+(1) Terminal error middleware — exactly ONE, registered LAST

`templates/server/errorMiddleware.js`. Logs once (log-once marks the Error, so a
deeper catch that already logged doesn't double-ship), responds safe JSON
(`{error, correlationId}` — NEVER `err.message`/`err.stack` to the client), honors
intentional `err.status`, guards `headersSent`.

Handlers that want a specific status THROW with one:
```js
const err = new Error('config not found');
err.status = 404;
throw err;                                    // middleware renders {error, correlationId}, 404
```

### (3) Webhooks (monday + external providers)

- **Challenge echo first:** monday webhook verification POSTs `{challenge}` — echo
  it back 200 before any auth/processing.
- **Signature failure is WARN, not ERROR** — it's routine noise (retries, scanners),
  respond 401, `logger.warn('signature_invalid', 'webhook', ...)`. ERROR is reserved
  for flow failures needing attention.
- **Respond 200 FAST, queue heavy work.** Providers mark endpoints unhealthy on
  slow/5xx responses (Google kills push channels on 5xx). Pattern: validate →
  respond 200 → process async with its own top-level catch. A processing failure
  after the 200 is logged + persisted as status, never re-thrown into the dead
  request context.

### (4) Scheduler / cron / queue jobs

Every job run gets a top-level catch that logs and swallows-with-log (the run is
the unit of failure; one bad config must not kill the loop over the rest):
```js
for (const config of configs) {
  try {
    await renewOne(config);
  } catch (error) {
    logger.error('renew_failed', 'scheduler', { error, cfg: config.configId });
    // classify + persist status here — see sync-calender's sync-status.js for the model
  }
}
```

### (5) Outbound calls

- Always a timeout (`AbortSignal.timeout(ms)` on fetch / SDK options) — a hung
  upstream must not hold a request open indefinitely.
- `fetch` does not reject on HTTP status: check `response.ok`.
- monday GraphQL soft errors in HTTP-200: throw at the API funnel — same rule as
  client (`catch-patterns.md` (b3)); shapes are `monday-api`'s domain.

### (6) Storage

`JSON.parse` on storage reads gets a guard; SecureStorage rate limits (7 req/s,
1 write/s/key) surface as errors — catch, log with the key, decide retry-vs-fail
explicitly.

### (7) Process nets — `templates/server/processGuards.js`

Log once → flush remote sinks (2s ceiling) → **exit** (platform restarts the
container). Never continue after uncaughtException/unhandledRejection — unknown
state produces false-success failures. SIGTERM/SIGINT: flush + graceful close.
Install at the TOP of the entry, before anything else can throw.

## Logging — server logger contract

`templates/server/logger.js`. Same choke-point contract as the client (emit,
log-once via `__loggedId`/`correlationId`, `addSink`, `setBeforeSend`), different
call signature — **`logger.error(message, tag, context)`** (hub convention: `tag` =
category, `message` = stable event id, context carries `error`). Levels:
LOG_LEVEL env, default INFO; WARN/ERROR always reach sinks.

**Verified quirk (sync-calender, production):** the `@mondaycom/apps-sdk` Logger
(Pino) silently DROPS `warn` and `debug`. Decision: **wrap, not replace** — the
template routes info/error through the monday Logger when the package is installed
(keeps `mapps code:logs` labeling) and warn/debug through bare console inside the
logger file. Plain-Node apps without apps-sdk degrade to console-only automatically.

Remote shipping: `templates/server/axiomServerSink.js` → the shared `app-errors`
dataset (`remote-monitoring.md`). Server tokens live in monday-code env vars (not
exposed — no client-side caveats apply).

## ESLint kit — Node adaptation

Same 4 rules as the client kit (`eslint-rules.md`), with the Node override set:

- `no-console`: ON everywhere except `logger.js` and sink files (the server logger
  OWNS console/stdout — application code never calls console directly; that's what
  makes "log" auditable).
- `catch-must-log` selector: identical, with the server remediation vocabulary —
  every catch calls `logger.*`, rethrows, or (in middleware) forwards `next(err)`.
  `next(err)` counts as a rethrow (it reaches the terminal middleware, which logs).
- `promise/catch-or-return`: unchanged; `asyncHandler(...)`-wrapped handlers satisfy
  it structurally.
- No TS on the server by convention (scaffold servers are plain ESM JS) — the
  bare-orphan-async-call hole (FN-1) applies; the unhandledRejection net is the
  runtime catch, and it is FATAL here (unlike the client) — which makes the hole
  loud in the first test run instead of silent.

Kit JSON: `templates/eslint-error-rules.json` works as-is; add the file-level
overrides for `src/services/logger.js` + `**/axiomServerSink.js` +
`**/processGuards.js` (console breadcrumbs on the exit path).

## Definition of done (server mode A)

- [ ] Every async handler/middleware is `asyncHandler`-wrapped (grep proves it)
- [ ] Exactly one terminal error middleware, registered after all routes
- [ ] Process guards installed first in the entry; exit-not-continue semantics
- [ ] Webhooks: challenge echo, WARN on bad signature, 200-fast + queued work
- [ ] Every catch logs / rethrows / `next(err)` — AbortError-only silence rule holds
- [ ] Client rules unchanged for any served SPA (this page adds, it doesn't replace)
