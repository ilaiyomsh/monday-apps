Here is Claude's plan:                                                                                                                                 ↑
  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
   Scaling the Calendar Sync App: Decouple the Webhook with the monday Queue                                                                              ↑

   Context                                                                                                                                                ↑

   The app syncs Google Calendar → monday boards. Every Google push hits POST /webhook/calendar, and the handler runs the entire sync synchronously before↑returning 200 (webhook-config.js:271). This is the core scale problem. Combined with monday code's hard runtime limits (80 concurrent requests/instance, max 10 instances, 300s timeout, and a daily execution-minute budget — ~450 min for a private app's first 100 seats), the current design will fail under↑load in three ways:
                                                                                                                                                          ↑
   1. Concurrency saturation / execution-minute bleed. Each push holds an HTTP slot for the whole sync. A burst of pushes (many users, or one busy calendar) can exhaust all 80 slots per instance and burn execution minutes, since concurrent requests accumulate budget in parallel.                            ↑
   2. No resilience to monday API throttling. mondayQuery (monday-api.js:11) has no retry/backoff. At scale, COMPLEXITY_BUDGET_EXHAUSTED, maxConcurrencyExceeded, IP_RATE_LIMIT_EXCEEDED, and API_TEMPORARILY_BLOCKED become routine — today each just throws, drops the event, and waits for the↑next push.
   3. Cross-instance duplicate creates. The per-config mutex (inflightSyncs Map, webhook-config.js:57) is in-memory and per-instance. With up to 10 instances, two pushes for the same configId can land on different instances and race the delta token + link-column existence check → duplicate rows.
                                                                                                                                                          ↑
   Outcome: the webhook ACKs Google instantly and enqueues a job; a dedicated /mndy-queue worker runs the sync with the Queue's built-in durable retry (10 attempts over a 10-minute ack window); monday API calls back off and retry on throttling. This directly removes problems 1–3.                          ↑

   Decision                                                                                                                                               ↑

   Adopt the monday code Queue (@mondaycom/apps-sdk Queue.publishMessage + validateMessageSecret). The Queue class only exists in SDK 3.x; the app is pinn↑d to 0.1.4, so this requires a major SDK upgrade. We also add backoff/retry to mondayQuery.
                                                                                                                                                          ↑
   Work
                                                                                                                                                          ↑
   Phase A — SDK upgrade (0.1.4 → 3.3.2) [prerequisite, highest risk]
                                                                                                                                                          ↑
   The only SDK surfaces the app uses are SecureStorage (sync-config-storage.js:17,74) and Logger (verify in services/logger.js). The Queue lives in the same package, so the upgrade is unavoidable.                                                                                                           ↑

   - Bump @mondaycom/apps-sdk to ^3.3.2 in package.json, reinstall.                                                                                       ↑
   - Breaking change to fix — SecureStorage value shape. In 0.1.4, get(key) returns { value: <string> } and the code does JSON.parse(result.value) (sync-config-storage.js:84). In 3.x, get<T>(key) returns the stored value directly (Promise<T | null>), and set<T>(key, value) accepts a JsonValue. Pic↑ one convention and apply it consistently:
     - Recommended: keep storing JSON strings (set(key, JSON.stringify(x))) and read them back as a string — drop the .value unwrap, so line 84 becomes JSON.parse(result). Minimal blast radius; the on-disk format is unchanged for existing stored data only if 3.x returns exactly what was set (verify with a round-trip test against a real instance before relying on it — see Verification).                                                                    ↑
     - The not found/404 handling at sync-config-storage.js:86 stays.
   - Keep the LocalStorage shim (storage/local-storage.js) byte-compatible with whichever convention is chosen. Today it returns { value: <string> } (local-storage.js:7,40). If the wrapper drops .value, the shim's get must return the raw string too — update both together so USE_LOCAL_STORAGE=true dev/tests still pass.                                                                                                                                  ↑
   - Audit other 3.x breaking changes: Logger constructor signature and any Storage/Environment usage. Grep node_modules/@mondaycom/apps-sdk/dist/types after install and reconcile.                                                                                                                           ↑

   Phase B — Queue producer (webhook ACKs fast, enqueues)                                                                                                 ↑

   - New module src/services/queue.js: lazy singleton wrapping new Queue() from the SDK, plus a dev/local guard (the SDK ships QueueDev for local; gate on↑USE_LOCAL_STORAGE/NODE_ENV so local runs don't require real pub/sub — fall back to invoking the sync inline as today).
   - Rework webhook-config.js#webhookConfigHandler (webhook-config.js:257):                                                                               ↑
     a. Keep the handshake short-circuit (isHandshake, :261).
     b. Read x-goog-channel-token = configId, emit webhook_received, then await queue.publishMessage(JSON.stringify({ configId, provider: 'google' })).   ↑
     c. Return 200 immediately. Do not call runWebhookSync here.
   - Mirror the same enqueue in the Microsoft webhook (routes/webhook-microsoft.js) so both providers share the worker.                                   ↑

   Phase C — Queue consumer (/mndy-queue worker)                                                                                                          ↑

   - New router src/routes/queue.js, mounted in src/index.js alongside the other routers (index.js:54-64). Follows the same "monday-initiated, self-identified path" pattern as scheduler.js (/mndy-cronjob/renew-channel, scheduler.js:52), with one addition:
     - Authenticate with queue.validateMessageSecret(req.query.<secret>) (the SDK's mechanism) before processing; reject otherwise.                       ↑
     - Parse { configId } from the body, then call the existing runWebhookSync({ configId }) from webhook-config.js:242 (already exported, already classifies/persists errors and notifies the owner). No new sync logic.                                                                                 ↑
     - Return 200 on success so monday acks the message; on a thrown/transient failure return non-200 so the Queue redelivers (up to 10 total attempts). Be careful: runWebhookSyncImpl already swallows most errors and returns { ok, reason } — decide which reasons warrant a retry (e.g. transient monday throttle) vs. a terminal ack (e.g. unknown_config, policy_missing) and map them to 200 vs. 5xx accordingly.
   - Keep the in-memory inflightSyncs mutex (webhook-config.js:57,242) — with the Queue, redeliveries and overlapping messages for one configId still benefit from in-process serialization, and the Queue's ordering reduces (not eliminates) cross-instance races.
                                                                                                                                                          ↑
   Phase D — monday API backoff/retry
                                                                                                                                                          ↑
   - Add a retry wrapper inside mondayQuery (monday-api.js:11). Reuse the existing backoff shape from sync-config-storage.js#withRetry (:39-63: exponential BASE_DELAY_MS * 2^attempt + jitter, MAX_RETRIES) rather than inventing a new one.                                                                      ↑
     - Retry only on throttle/transient codes: COMPLEXITY_BUDGET_EXHAUSTED, maxConcurrencyExceeded, IP_RATE_LIMIT_EXCEEDED, API_TEMPORARILY_BLOCKED, and HTTP 429/5xx. Honor monday's retry_in_seconds (extensions.error_data) as the delay when present — cap it so a single call can't blow the 10-minute queu↑ ack window.
     - Do not retry deterministic errors (InvalidColumnIdException, ColumnValueException, NOT_AUTHENTICATED, etc.) — those already drive status transition↑ and the column-strip retry in sync-engine.js:253.
   - This lives below applyEvent, so backfill (services/backfill.js, sequential per-event applyEvent loop) and force-sync benefit automatically.          ↑

   Out of scope (note for later)                                                                                                                          ↑

   - Batching the up-to-4 sequential monday calls per upsert (sync-engine.js:278-313) and gating concurrent backfills — real wins but separate from the webhook/queue change. Leave as a documented follow-up.
                                                                                                                                                          ↑
   Files
                                                                                                                                                          ↑
   - package.json — SDK bump.
   - src/storage/sync-config-storage.js, src/storage/local-storage.js — value-shape fix (Phase A).                                                        ↑
   - src/services/queue.js (new) — Queue singleton + dev fallback.
   - src/routes/webhook-config.js — producer rework; keep runWebhookSync export + mutex.                                                                  ↑
   - src/routes/webhook-microsoft.js — mirror enqueue.
   - src/routes/queue.js (new), src/index.js — consumer route + mount.                                                                                    ↑
   - src/services/monday-api.js — backoff in mondayQuery.
   - CLAUDE.md — document the new queue flow + /mndy-queue contract once shipped.                                                                         ↑

   Verification                                                                                                                                           ↑

   1. Storage round-trip (Phase A gate). With the upgraded SDK against a real monday code instance (or USE_LOCAL_STORAGE=true first), set then get a config_* and policy_* entry; confirm the parsed object matches and existing stored rows still read. npm run typecheck clean.
   2. Local dev path. npm run dev with the dev/local queue fallback: trigger a Google push (or POST /api/configs/:id/force-sync) and confirm the sync still runs and the row appears on the board.
 3. Producer latency. Hit POST /webhook/calendar with a valid x-goog-channel-token; confirm it returns 200 in milliseconds (no sync inline) and a webhook_received + enqueue log appears.
 4. Consumer. Confirm monday delivers to /mndy-queue, validateMessageSecret passes, runWebhookSync executes, and sync_done logs. Force a transient failure and confirm redelivery; force a terminal unknown_config and confirm it acks (no infinite redelivery).
 5. Backoff. Simulate a COMPLEXITY_BUDGET_EXHAUSTED/429 from mondayQuery (mock fetch) and confirm it retries with backoff then succeeds, and that a deterministic error does not retry.
   6. Deploy. mapps code:push -a 11119011, then mapps code:logs to watch a real push flow end-to-end. Verify the Queue is registered for the app version in e Developer Center.

   review


I've verified the plan against the actual code. Every claim checks out:

- webhook-config.js:271–272 — yes, await runWebhookSync runs the full sync, then returns 200. Synchronous, as the plan says.
- monday-api.js:11–45 — mondayQuery has no retry: on response.errors it just throws. Confirmed.
- webhook-config.js:243 — inflightSyncs is an in-process Map, per-instance. Confirmed.
- package.json — SDK pinned to ^0.1.4, installed 0.1.4. Confirmed.
- sync-config-storage.js:84 — JSON.parse(result.value) unwrap, and withRetry backoff at lines 39–63. Confirmed.

Verdict

This is a plan, not an implementation — line 1 literally reads "Here is Claude's plan". None of it is built yet (SDK still 0.1.4, no src/services/queue.js, no src/routes/queue.js, mondayQuery still has no retry). So "does it solve the problems?" splits into two questions:

1. Does the plan correctly diagnose the problems? Yes. The three problems are real and accurately located in the code:
- Problem 1 (concurrency/execution-minute bleed): real — the handler holds the HTTP slot for the entire sync.
- Problem 2 (no throttle resilience): real — mondayQuery throws on the first COMPLEXITY_BUDGET_EXHAUSTED/429 and drops the event.
- Problem 3 (cross-instance duplicate creates): real — inflightSyncs is in-memory, so two instances can race.

2. Would the proposed solution actually solve them? Mostly yes, with one honest caveat the plan itself flags:

┌──────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│     Problem      │                                                             Solved?                                                              │
├──────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1 — concurrency  │ ✅ Fully. ACK-fast + enqueue moves the work to the /mndy-queue worker; the webhook slot frees in milliseconds.                   │
│ saturation       │                                                                                                                                  │
├──────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 2 — throttle     │ ✅ Fully. Backoff/retry in mondayQuery (Phase D) + the Queue's durable 10-attempt redelivery.                                    │
│ resilience       │                                                                                                                                  │
├──────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 3 — duplicate    │ ⚠️ Reduced, not eliminated. The plan is candid about this (line 47: "the Queue's ordering reduces (not eliminates)               │
│ creates          │ cross-instance races"). The in-memory mutex still doesn't span instances; the Queue makes a race less likely but doesn't add a   │
│                  │ cross-instance lock. A true fix would need distributed locking or an idempotency guard on the create path.                       │
└──────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Risks the plan correctly front-loads

- Phase A (SDK 0.1.4 → 3.x) is the real risk, not the queue wiring. The { value: <string> } unwrap at line 84 breaks in 3.x, and it touches every stored config/policy read. The plan correctly gates this behind a storage round-trip test (Verification step 1) before anything else — that's the right call.
- It correctly keeps runWebhookSync and the mutex rather than rewriting sync logic, and correctly notes the 200-vs-5xx mapping (terminal unknown_config must ack, transient throttle must redeliver) — getting that backwards would cause infinite redelivery loops.

Bottom line

The plan is accurate, well-scoped, and would solve problems 1 and 2 cleanly and meaningfully mitigate problem 3. It is not yet implemented — it's a design doc. The one thing I'd want stated more sharply: problem 3 is only reduced, so if exact-once item creation is a hard requirement, that needs a follow-up (idempotency key on the link-column create) rather than being considered "done" by this plan.

result: The doc is an unimplemented plan; its diagnosis is accurate against the code, and it would fully solve problems 1–2 but only reduce (not eliminate) the cross-instance duplicate-create race — which the plan itself acknowledges.

Want me to turn this into the actual implementation, starting with the Phase A SDK-upgrade gate?
