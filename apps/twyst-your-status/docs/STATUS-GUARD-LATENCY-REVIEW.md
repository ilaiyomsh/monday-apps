# Status-Guard Time-to-Revert — Deep Architecture Review

**Date:** 2026-08-06 · **Scope:** `apps/twyst-your-status` server, webhook → revert path
**Mode:** audit only — no code was changed. Implementation happens in a follow-up session after the owner picks a direction.
**Metric under review:** wall-clock from webhook receipt to the revert mutation landing (`change_column_value`). Post-revert work (notify, bypass log) matters only insofar as it holds the per-item lane.

---

## 1. Verdict on the prior diagnosis

**Bottom line: the qualitative diagnosis is right, the arithmetic is wrong, and the plan is the right *shape* but the wrong *order*.** The path does not need restructuring — the serial chain is structurally forced by real dependencies (see §3). What the prior analysis missed is that the dominant amplifier is not the app's retry loop; it is the **apps-sdk's Vault authentication ladder**, which the retry loop re-pays in full on every attempt, and which has **no timeout anywhere**.

### What it got right (verified in code)

- **7–9 serial network round-trips before the revert** — confirmed exactly (see §2 for the derived list). The order, backends, and conditionality in the prior table are correct, with one addition (the token-refresh sub-path, below).
- **Zero caching exists.** The coalescing in [secure-storage-resilient.js:73-85](apps/twyst-your-status/server/src/helpers/secure-storage-resilient.js) merges only reads *overlapping in time* for the *same key*, cleared in `.finally`. On the webhook path the three Vault reads are serial and (usually) two distinct keys — nothing coalesces. Confirmed deliberate (test-locked: "releases the coalescing slot after settle").
- **The reader == primary duplicate read is real.** When the account reader pointer resolves to the primary owner (the common single-owner case — *every* fixture in `handleStatusChangeEvent.test.js` has reader == primary), `getOwnerToken` at [handleStatusChangeEvent.js:136](apps/twyst-your-status/server/src/guard/handleStatusChangeEvent.js#L136) re-reads the exact Vault key `getReaderToken` already resolved at line 101. Serial, so the coalescing window never covers it.
- **Retry formula.** `retries = 3` total attempts, sleeps `200ms, 400ms` between them ([secure-storage-resilient.js:44-71](apps/twyst-your-status/server/src/helpers/secure-storage-resilient.js#L44)). A fully-failing call costs `3T + 0.6s` where T is one failed attempt. Correct as stated.

### What it got wrong

1. **The `N × (3T + 0.6s) ≈ 12s` arithmetic is internally inconsistent.** A Vault call that exhausts all 3 attempts **throws**, the throw propagates out of `process()`, and the per-item lane's catch logs `status-change handling failed` — **the delivery is abandoned and the revert never happens** (the 202 was already sent, so monday will not redeliver). You cannot have four fully-failing Vault calls *and* an observed revert at 12 s. If the revert landed, every Vault call on the path eventually succeeded, so each call's worst case is `2·T_fail + 0.6s + T_success`, and only the **three pre-revert** calls count.
2. **N = 4 counts the bypass get/set, which are post-revert.** The prior table itself marks them "no (post-revert)" and then the arithmetic includes them. For time-to-revert, N ≤ 3 (pointer, reader record, primary record) — or effectively 2 distinct keys in the common reader == primary case.
3. **It missed the actual amplifier: the SDK's Vault auth ladder.** Read from the vendored source (`@mondaycom/apps-sdk` 0.1.4, `secure-storage.js`): every `get`/`set` first runs `authenticate()`. On a cold instance (or Vault-token TTL < 30 min) that is **three-plus extra HTTPS hops before the KV op**: GoogleAuth credential work + a `signJwt` call to `iamcredentials.googleapis.com`, then `POST /v1/auth/gcp/login`, then `GET /v1/auth/token/lookup-self`. The production failure signature — `invalid json response body … /auth/gcp/login` — is thrown from *inside* `getToken` when the Vault server returns an HTML page: **the failing unit is the login ladder, not the KV read**. Crucially, on failure `this.connectionData` is never assigned, so **each retry attempt re-pays the entire ladder from scratch** (including the external `signJwt` HTTPS call). One flaky call is therefore far more expensive than "3 KV reads": T_fail is a multi-hop sequence, plausibly 1–2 s each.
4. **It missed the mirror-image damper.** Once *one* op authenticates, the Vault client token is cached **instance-wide** on `this.connectionData` (re-login only when TTL < 0.5 h). So after the first success, every subsequent Vault op — including the other two pre-revert reads and the post-revert bypass ops — is a **single** KV round-trip. The "every call independently pays the full penalty" model is wrong in both directions: the first call pays *more* than modeled, the rest pay *less*.
5. **There is no timeout anywhere on the path.** The SDK's `fetchWrapper` is `node-fetch` with no timeout option; the app's own GraphQL funnel and OAuth client use bare `fetch` with no `AbortController`. A single hanging Vault (or GraphQL) attempt is unbounded. This alone can explain any observed number, 12 s included, without any retry arithmetic.
6. **It missed the token-refresh sub-path.** When an access token is inside the 5-minute refresh cushion ([stores.js:41,71-133](apps/twyst-your-status/server/src/services/stores.js#L41)), `resolveFresh` adds, serially and pre-revert: a Vault **re-read** + an **OAuth POST** to `auth.monday.com` + a Vault **set** to persist the rotated pair. Up to +3 round-trips per stale owner, single-flighted per key. With ~1 h access tokens this fires on roughly one webhook per owner per hour — a periodic latency spike the diagnosis never mentions.
7. **The 12 s trace is unverified — and currently unverifiable.** Axiom (`app-errors`, 14-day window, 9,950 rows for this app) contains **zero** rows matching vault/secure-storage/HTML-body signatures, **zero** rows with any populated duration field, and the `webhook received` / `status change BLOCKED` trace lines added in 3.15.2 ship to `code:logs` only, not to Axiom. The retry wrapper logs its attempts at `warn`, below the default ship level. So telemetry can neither confirm nor refute the 12 s decomposition. Absence of Vault rows is **not** evidence the failures stopped — it is evidence the pipeline doesn't ship them.

### What follows from the corrections

The most defensible account of the observed 12 s (stated as **hypothesis, not fact**): the delivery hit an instance whose Vault client token was cold or expired; the *first* Vault call (the pointer read) burned one or two full auth-ladder failures (~1.5–2.5 s each, or worse if an attempt hung — no timeout) plus backoff before succeeding on a later attempt; possibly a second call did the same before the instance-wide token settled; an OAuth refresh may have added its own hop; the remaining ~1.5–2.5 s is the normal serial rules + GraphQL chain. That reaches 12 s comfortably. But without per-step timing (proposal 0 below), this cannot be proven — and neither could the prior diagnosis's version.

---

## 2. The derived critical path (from code, not from the prior table)

Serialization context: deliveries for the same `board:item:column` queue on an in-process lane ([handleStatusChangeEvent.js:255-269](apps/twyst-your-status/server/src/guard/handleStatusChangeEvent.js#L255)); the lane holds through notify + bypass append. The 202 ack fires before any of this ([guard-routes.js:67](apps/twyst-your-status/server/src/routes/guard-routes.js#L67)).

| # | Call | Backend | Condition | Blocks revert |
|---|---|---|---|---|
| 1 | reader pointer read (`:token:default`) | Vault | always | yes |
| 2 | reader owner-record read (`:token:<uid>`) | Vault | pointer has `userId` (skipped for legacy copy record) | yes |
| 2a–2c | refresh: re-read + OAuth POST + persist set | Vault ×2 + OAuth | reader token inside 5-min cushion | yes |
| 3 | `getRules` (`twystStatus:<board>:<col>`) | **monday Storage** (not Vault; no retry wrapper, no timeout) | reader resolved | yes |
| 4 | primary owner-record read | Vault | `primaryOwnerId !== null`; **same key as #2 when reader == primary** | yes |
| 4a–4c | refresh sub-path for the primary | Vault ×2 + OAuth | primary token stale (impossible when reader == primary — #2 refreshed it) | yes |
| 5 | `getColumnLabels` | GraphQL | always | yes |
| 6 | `getUserTeamIds` | GraphQL | any rule names teams | yes |
| 7 | `getItemGuardContext` | GraphQL | target rule has people/required columns | yes |
| — | `evaluate()` | pure, 0 RT | — | — |
| 8 | `getCurrentStatusLabelId` (stale-cell re-read) | GraphQL | verdict revertable ∧ `autoRevert` ∧ primary token present | yes |
| 9 | **`revertStatus`** | GraphQL | cell still holds the illegal value | **the revert** |
| 10 | `notifyUser` | GraphQL | revert happened | no (holds lane) |
| 11–12 | bypass log get + set | Vault | always for blocked verdicts | no (holds lane) |

Counts: **minimum 7** serial round-trips to the revert (no teams, no people/required, fresh tokens), **maximum 9** plus up to 3 refresh hops. Every step through #9 is strictly serial today.

Ballpark healthy-warm-instance cost (150–300 ms per hop): **1.5–2.5 s time-to-revert — today's best case.** The 12 s case is the cold/flaky-Vault tail, not the steady state.

One more structural fact the prior analysis skipped: the SDK's `authenticate()` has **no single-flight** — concurrent Vault ops on a cold instance each run the full ladder independently. The app's coalescing only masks this for same-key overlapping gets.

---

## 3. Should the path be restructured? — No. Here is the dependency proof, and the options I rejected.

The serial spine is forced by three design invariants that are all correct:

- **Rules live in monday Storage** (written client-side by the picker via `monday.storage`), and Storage is authenticated by a *user* token → rules cannot be read before a token is resolved.
- **`primaryOwnerId` comes out of the rules blob** → the primary-owner token cannot be resolved before rules.
- **All board reads and the revert need `boardReadToken`** (primary ?? reader, for OAuth board-visibility and attribution reasons documented at [handleStatusChangeEvent.js:128-138](apps/twyst-your-status/server/src/guard/handleStatusChangeEvent.js#L128)) → GraphQL cannot start before the token chain.
- **The stale-cell re-read must stay after `evaluate` and immediately before the revert** — moving it earlier widens the rapid-change race it exists to close.

So the minimal serial depth with *no caching* is: token → rules → token → GraphQL-group → re-read → revert. Nothing to reorder. What caching changes is how many of those legs cost a network hop. **The right architecture is the current one, plus memory over the legs that are re-derivable — plus paying the Vault auth ladder off the hot path.**

### Rejected restructures (and why)

- **Optimistic revert (evaluate on cached/partial data, revert fast, reconcile later).** Rejected on principle and on mechanics. Principle: the guard is deliberately fail-open; the worst outcome it can produce is reverting a *legal* change, written as the primary owner. Acting on stale rules makes that outcome likelier for a latency win. Mechanics: the revert *requires* the primary owner's token, so token resolution cannot be skipped anyway; the only skippable inputs are rules/labels/context — and those decide *whether* to revert at all. "Optimistic" collapses into "TTL-cache the rules," which is proposal 4, not a restructure.
- **Speculative GraphQL with the reader token, in parallel with primary-token resolution.** In the common reader == primary case the token cache (proposal 1) makes primary resolution free, so the overlap wins nothing; in the reader ≠ primary case it needs a visibility-failure fallback re-fetch. Complexity without payoff once caching lands.
- **Storage-layout change: denormalize the *access* token (never the refresh token) into the reader pointer** — `:token:default` = `{userId, token, expiresAt}`. This is the one layout change the rotation model permits (the refresh token stays single-copy), and it is the only option that also helps a *cold instance* with a *healthy* Vault (1 Vault read instead of 2). But it spreads a new invariant across every writer (`setOwnerToken`, `doRefresh` must conditionally double-write), and its win over proposal 1 + warm-up is ~1 Vault RT on cold instances only. Not worth the coupling now; keep in the back pocket.
- **Queue/worker or ack-later redesign.** The 202-then-`setImmediate` shape and the per-item lane are correct and test-locked; nothing about the latency problem implicates them.
- **Replacing the SDK SecureStorage client.** The auth ladder and missing timeout are SDK-internal (`apps-sdk` 0.1.4). Vendoring a fixed client is possible but is a platform-drift liability; the timeout wrapper (proposal 5) and warm-up (proposal 0b) capture most of the value from outside.

### Is a per-instance memory cache even durable on monday-code? (verified, with sources)

monday-code is Cloud Run: up to **10 instances/region × 3 regions**, 512 MiB / 1 vCPU, up to 80 concurrent requests per instance, scale-to-zero when idle (sources: developer.monday.com quotas-and-limits + get-started pages; monday's dev-relations blog confirms scale-to-zero; no min-instances or affinity setting is exposed anywhere in the Developer Center docs). Consequences:

- A warm-instance cache has a **real but partial** hit rate: steady traffic keeps instances warm, but webhook bursts can fan out across instances, and cold starts / crash-restarts wipe it. It must be a pure optimization over a correct miss path — which is exactly what proposal 1 is.
- **Background timers are unreliable** — Cloud Run throttles CPU between requests, so a periodic keep-warm `setInterval` cannot be counted on. Boot-time warm-up *can* (it runs during startup). This kills the "periodic re-warm" variant and endorses the boot variant.
- Nothing prevents *another* instance from flipping a record to `reauth_required` while this instance holds a cached access token. The cache's staleness bound is the token's own `expiresAt` — the same bound the bearer-token model already accepts everywhere else (a revoked-but-unexpired token in memory can't be recalled from Vault either).

### A pre-existing hazard surfaced by this audit (not the latency bug, but report-worthy)

The single-flight refresh lane is **per process**. With up to 30 instances, two instances can concurrently refresh the same owner: the loser presents an already-rotated single-use refresh token, gets `invalid_grant`, and writes `status: 'reauth_required'` — potentially **clobbering the winner's freshly-persisted valid pair** (write-order race in [stores.js:97-110](apps/twyst-your-status/server/src/services/stores.js#L97)). The `doRefresh` re-read narrows but does not close this. It is also an alternative explanation for any intermittent "account not activated" skips. Out of scope here; flagged in Open Questions.

---

## 4. Recommended plan — sequenced, with expected deltas, risk, and proof strategy

The prior recommendation was "#2 then #1". **Mine is: 0 → 0b → 1(+3) → 5 → 2 → 4 → 6, plus two scoped-in hardening items (7, 8). All steps below are owner-approved (decisions 2026-08-06, recorded in §5).** Reasoning: #2's claimed "high impact" is overstated — in the minimal case (no team rules, no people/required columns) only `getColumnLabels` fires, so `Promise.all` saves *zero*; it helps only rule-heavy columns, by one round-trip time. Meanwhile nothing in the prior plan addressed the cold-container Vault ladder — which is where the actual incident lives.

| Step | What | Expected delta | Risk | Proof |
|---|---|---|---|---|
| **0** | **Per-step timing on the guard path** — wrap each awaited step in `process()` with a monotonic timer; emit ONE summary log line per blocked event (`tokens=…ms rules=…ms gql=…ms revert=…ms total=…ms`). **Owner decision 2026-08-06: approved, `code:logs` only — do NOT wire it to Axiom** (no new event kind). The guardrail exception is thus narrowly scoped: one log line, local logs only. | none (enables everything) | ~zero | unit: summary line present with all step keys; manual: one live blocked change shows a decomposition |
| **0b** | **Boot-time Vault warm-up** — after wiring, fire one throwaway `secureStorage.get('warmup')`, fire-and-forget with logged failure. Pre-pays the GCP + login ladder during container start instead of under the first webhook; the flaky-login retries burn *before* a user is waiting. Periodic re-warm is deliberately **not** proposed (Cloud Run CPU-throttles idle instances; timers are unreliable). | cold-instance first webhook: −(1–5 s) in the flaky-Vault scenario; 0 elsewhere | low (one extra Vault read per boot) | unit: boot triggers exactly one warm-up get, failure logged not thrown; live: cold-deploy then immediate webhook, compare step-0 timings |
| **1 (+3)** | **In-memory access-token cache in `createTokenStore`** — new layer inside [stores.js](apps/twyst-your-status/server/src/services/stores.js), *not* touching the coalescing wrapper. Cache `{token, expiresAt}` keyed `accountId:userId`, plus `accountId → readerUserId` pointer memo. Populate on `resolveFresh`/`setOwnerToken` success; honor `expiresAt − REFRESH_CUSHION_MS` on read; evict on `reauth_required` flag and on refresh failure; **never store `refreshToken`**. This *subsumes proposal 3*: reader == primary dedupe falls out of the shared key, with `getOwnerToken` still invoked — which matters because the handler-level dedupe variant would break every AUTO-REVERT test (they assert `getOwnerToken` called exactly once; verified against the suite). | warm path: −2–3 Vault RTs (~0.3–0.9 s healthy; the whole retry-tail in degraded mode); refresh spike absorbed after first resolution | low-med: bounded staleness = token lifetime (existing bearer-model bound); multi-tenant isolation by `accountId` in the key | new tests: sequential second read is storage-free; expiry evicts; `reauth_required` evicts; two accounts never share entries; refresh-rotation still single-flight. No existing test contradicts (verified: no test performs sequential repeat reads on one store) |
| **5** | **Per-attempt timeout on Vault gets** in the resilient wrapper — `AbortController`/race at ~2.5 s per attempt, **gets only**; sets keep no (or a generous ≥10 s) timeout because timing out the refresh-persist set risks orphaning a just-rotated refresh token (the OAuth call succeeded, the old token is burned; losing the persist ⇒ later `invalid_grant` ⇒ false `reauth_required`). The timeout error must be classified transient (message matching `isTransientStorageError`) so the locked retry semantics still apply. `retries=3` untouched (locked); backoff untouched. | caps the unbounded-hang tail; worst pre-revert Vault wait per call ≈ 2×2.5 s + 0.6 s + success | med: chosen constant must exceed honest cold-ladder latency or it *creates* failures — set from step-0 data, not guessed | existing suite already passes (asserts call counts, injects fake sleep — verified); new tests: hanging get aborts at the cap, is retried, and set is exempt |
| **2** | **Parallelize the gated GraphQL subset** — `Promise.all` over only the calls the lazy-fetch gating already decided to make (labels always; teams/context conditionally). The gating itself is test-locked ("skips getUserTeamIds and getItemGuardContext entirely when no rule demands…") — a naive unconditional `Promise.all` **fails that test**; the gated form passes (no test asserts relative order). | −0 to −2 RT-times (~0–0.6 s), only on rule-heavy columns | low | existing gating test stays green; new test: with teams+context demanded, all fire concurrently (in-flight overlap assertion) |
| **4** | **Rules TTL cache (30–60 s) in `rulesStore`**, keyed by `board:column` under the account. **Owner decision 2026-08-06: approved at 30–60 s.** Staleness accepted: a tightened rule can miss violations for ≤ TTL (fail-open direction — it never *wrongly reverts*, only *wrongly allows*). Note rules ride monday **Storage**, not Vault — this step is irrelevant to the Vault-failure scenario; it is a steady-state −1 RT. | −~0.1–0.3 s warm path | low-med (bounded miss window) | new tests: repeat read within TTL is storage-free, expiry refetches; no existing test performs repeat reads (verified) |
| **6** | **Release the per-item lane after the revert** (fire-and-forget notify + bypass append, both already fail-soft; bypass has its own per-column write lane). **Owner decision 2026-08-06: approved for this implementation round.** This deliberately changes locked behavior — `handleStatusChangeEvent.test.js:611-667` holds event 1 inside `bypassLog.append` and asserts event 2 makes no progress; the test must be amended via the sanctioned `amend-intent` path in the same PR, never weakened silently. | next-delivery start: −2 RTs after a revert; 0 for the first delivery | low-med + test-lock cost | amended lane test: event 2 may start after event 1's revert but bypass appends stay ordered per column |
| **7** | **Bounded in-process redelivery** — when a delivery dies on a *transient* storage error after the 202 ack, retry `process()` once after a short delay (single retry, still inside the per-item lane so ordering holds; a second failure stays log-only). **Owner decision 2026-08-06: scoped in.** Closes the lost-revert hole: today such a delivery is gone forever (monday will not redeliver a 202). | reliability, not latency: turns "revert lost" into "revert late" | low (one retry, transient-classified errors only) | new tests: transient failure → exactly one redelivery attempt → success reverts; non-transient → no retry; second failure → logged, no loop |
| **8** | **Cross-instance refresh-race mitigation** (see §3 hazard) — before flagging `reauth_required` on `invalid_grant`, re-read the record and compare `refreshedAt`/`token` against the pre-refresh snapshot: if another writer already persisted a newer pair, adopt it instead of flagging. **Owner decision 2026-08-06: include in this latency round.** | prevents false `reauth_required` + valid-pair clobber under scale-out | med (touches the refresh path; must not weaken single-use rotation handling) | new tests: loser-of-race adopts the winner's persisted pair; genuine dead grant still flags `reauth_required`; existing rotation tests stay green |

**Expected end state (steps 0–2):** warm healthy path = rules + GraphQL-group + re-read + revert ≈ **4 serial RTs ≈ 0.6–1.2 s** (from 1.5–2.5 s); with step 4 ≈ 0.5–1 s. Degraded-Vault path: warm-up + cache + timeout cap the tail at roughly one bounded retry cycle on one call instead of an unbounded multi-call cascade — from "12 s or lost entirely" to **~3–6 s worst, sub-second warm**. **Theoretical floor** given the invariants (re-read after evaluate, revert after re-read, fresh verdict data): 2 GraphQL RTs ≈ **0.3–0.6 s**; reaching it requires also caching labels (same staleness class as rules) — possible later, same sign-off class as step 4.

---

## 5. Owner decisions (2026-08-06 — all six open questions resolved)

1. **Step 0 timing instrumentation: APPROVED, `code:logs` only.** The guardrail exception is one per-event summary line in local logs; nothing new ships to Axiom.
2. **Step 4 rules TTL cache: APPROVED at 30–60 s.** Bounded fail-open staleness accepted. (Labels caching — the same staleness class — was *not* asked or approved; raise separately if chasing the §4 floor.)
3. **Step 6 lane release: APPROVED for the upcoming implementation round**, including amending the locked lane test via `amend-intent` in the same PR.
4. **Bounded in-process redelivery: SCOPED IN** (step 7) — one retry of a delivery that died on a transient storage error.
5. **Cross-instance refresh race: INCLUDED in this latency round** (step 8) — mitigate by re-read-and-compare before flagging `reauth_required`.
6. **12 s trace provenance: CONFIRMED — `code:logs` timestamps.** Until step 0 lands, the follow-up validates its improvements against the same source (`webhook received` → revert log lines).

---

## 6. ADDENDUM — Live measurements & two P0 bugs (2026-08-06, same day, follow-up session)

After the decisions above were recorded, the owner requested independent live measurements
(board `18423875018`, column `color_mm5nwms4`, hidden label "בעבודה" = id 0, app version
16639151 live, `mapps code:logs` console+HTTP streamed in parallel). The measurements
**overturned parts of §1–§4's model** and surfaced two production bugs more severe than the
latency itself. Board state was restored (both test items back at "לא רלוונטי") and the
revert storm described below was extinguished before the session ended.

### 6.1 Measured time-to-revert (webhook-driven, production live)

| Run | Transition | Traffic | Time-to-revert (mutation→cell flipped back) | Server decomposition (receipt→verdict→revert) |
|---|---|---|---|---|
| 1 | 3→0 | none | **41.3 s** | 31.9 s → +8.8 s |
| 2 | 3→0 | none | **38.7 s** | ~34 s → +4 s |
| 4 | 3→1 | keep-alive 2 req/s (200 OK ×720 verified) | **41.9 s** | 38.3 s → +3.0 s |

The original complaint's ~12 s was a *good* day. Webhook delivery itself (mutation→receipt)
is ~2.8 s (monday-side). HTTP ack stays 4–15 ms.

**Revised latency verdict:** every outbound network call from the container takes **~4–5 s,
uniformly across all backends** (Vault, monday Storage, GraphQL — ~6 pre-verdict calls ≈ 32 s,
2 revert-leg calls ≈ 3–9 s). Zero retry warnings fired during the measured runs, so §1's
retry-amplification is NOT what produced these times, and one live Vault auth-ladder failure
WAS caught at 10:54:35 (`invalid json response body … /auth/gcp/login`, attempt 1/3 —
first live telemetry confirmation of the failure mode). The **CPU-throttling hypothesis was
probed and weakened**: sustained 2 req/s keep-alive traffic to the container changed nothing
(41.9 s vs 41.3/38.7 baseline). Caveat: Cloud Run may have routed the pings to a different
instance than the one holding the lane, so the refutation has a hole; the step-0 per-step
timing (approved) plus an in-container connection-timing probe is what will finally
discriminate (suspects: per-call connection setup — undici/node-fetch pools idling out
between the slow calls, possible IPv6/Happy-Eyeballs stalls, monday-code egress path).

### 6.2 P0 BUG — server evaluator sees ZERO labels: the guard blocks EVERYTHING

Observed live: `BLOCKED (not-offered)` for **3→1 and 0→3**, both explicitly permitted by the
rules blob (label 1's allowlist includes the actor; rule 0's `nextLabelIds` includes 3), and
3→1 is visibly offered by the client picker (owner's screenshot). **Reproduced
deterministically offline** with the exact live inputs:

- Server ([monday-api.js:23-27](../server/src/services/monday-api.js)) fetches **`settings_str`**,
  where `labels` is a **map** `{"0":"בעבודה", …}`.
- Client ([graphqlQueries.js](../../src/services/graphqlQueries.js) + [OnClickDialog.jsx:129](../../src/components/OnClickDialog/OnClickDialog.jsx))
  fetches the typed **`settings`** field, where `labels` is an **array** of `{id, index, …}`.
- Both feed `normalizeStatusLabels` ([statusPolicy.js:86](../../src/domain/statusPolicy.js)),
  which handles ONLY the array shape → server gets `labels = []` → `buildAvailableLabels`
  options = ∅ → **every transition on the column is "not-offered"**.

Local repro (exact live `settings_str` + exact rules blob from `mapps storage:export`):
`normalizeStatusLabels → []`; verdicts 3→1, 0→3, 3→0 all `not-offered` — matching production
exactly. **Consequence: with auto-revert on, the guard reverts every change on the column,
legal or not.** Fail-open is structurally violated (an empty labels read fails CLOSED).

**Fix direction (follow-up):** change the server's `GET_COLUMN_LABELS` to select `settings`
(same field, same normalizer as the client — restoring the one-source-of-truth doctrine), or
teach `normalizeStatusLabels` the map shape. The `services.test.js` fixtures locked the wrong
wire shape (array inside `settings_str`) — correcting them is a sanctioned `amend-intent`.
Also add a fail-open guard: empty labels ⇒ log + skip, never evaluate to blocked.

### 6.3 P0 BUG — echo-guard TTL race: the guard fights itself (observed ~25-minute revert storm)

Observed live, repeatedly: the revert's own echo webhook reaches the echo check **after** the
60 s `REVERT_ECHO_TTL_MS` has expired (processing latency 40 s–4 min under lane queuing), so
the echo is treated as a genuine owner change → blocked (everything is blocked per §6.2) →
**the guard reverts its own revert**, re-writing the illegal value, spawning another echo —
items oscillated 0↔3 for ~25 minutes, spamming the primary owner with notifications and
flooding the bypass log. The storm ends only when a quiet-enough window lets one echo be
consumed within TTL. A third-value write breaks the chain via the stale-cell re-read guard
(check-then-write, so it can still race a queued revert — observed once).

**Fix direction (follow-up):** (a) move the echo check to the TOP of `process()` before any
I/O — store `actorId` in the `pendingReverts` marker at revert time so the check needs no
rules read; (b) raise the TTL well above worst-case processing (minutes, not 60 s); (c) §6.2's
fix removes the storm's fuel (echo transitions get correctly allowed), but (a)+(b) are still
required — the echo path must not depend on verdict correctness.

### 6.4 Consequences for the §4 plan

Priorities are re-ordered: **correctness before latency.** New step 0a (before everything):
fix §6.2 (settings shape) + §6.3 (echo guard) — without them, faster processing merely makes
the guard block legal changes faster. The latency plan itself stands, but §6.1 shifts the
expected wins: caching removes calls, yet each remaining call still costs ~4–5 s until the
per-call mechanism is identified (step-0 timing + connection-level probe). The theoretical
floor in §4 (2 GraphQL RTs) is ~8–10 s at today's per-call cost — fixing per-call latency is
now the highest-leverage latency item, above all six original proposals.

### 6.5 Owner feature request (2026-08-06, approved for follow-up)

**Settings-export button:** a debug control in the settings screen exporting the column's full
rules JSON. Until it ships, the working CLI path (used in this session):
`mapps storage:search -a 11775054 -c <accountId> -t "twystStatus:<board>:<column>"` and
`mapps storage:export -a 11775054 -c <accountId>` (exports all keys to a JSON file).

### 6.6 Session side-effects (for the record)

The measurement campaign itself sent multiple revert notifications to the acting user and
appended storm/test entries to the bypass log of `18423875018:color_mm5nwms4` (they carry
`reverted: true/false` and today's timestamps). Both test items were verified back at their
original label ("לא רלוונטי") at session end; the storm was confirmed extinguished
(echo consumed within TTL at 11:05:40, no further verdicts through 11:07:42).

---

## Appendix: evidence base

- Direct reads: `handleStatusChangeEvent.js`, `stores.js`, `secure-storage-resilient.js`, `monday-api.js`, `monday-oauth-client.js`, `guard-routes.js`, `evaluateStatusChange.js`, `index.js`, and the vendored `@mondaycom/apps-sdk@0.1.4` sources (`secure-storage.js`, `fetch-wrapper.js`, `gcp.js`).
- Test-lock inventory: full `server/tests/` sweep; no file is red/green-state-locked by test-guard, but the behavioral locks cited above are verbatim from the suite.
- Telemetry: Axiom `app-errors`, `app == 'twyst-your-status'`, 14 days, 9,950 rows — zero vault-signature rows, zero populated duration fields; guard trace lines confirmed not wired to ship.
- Platform: developer.monday.com (quotas-and-limits, get-started, manage-monday-code) + monday dev-relations blog for the Cloud Run model; in-repo incident comments (2026-08-05 cold-draft Vault failure) for cold-start reality.
- 3.15.2 provenance: commits `a8b11ca2` (observability), `6931dc37` (resilient SecureStorage), CHANGELOG entries confirming the retry/coalescing scope.
