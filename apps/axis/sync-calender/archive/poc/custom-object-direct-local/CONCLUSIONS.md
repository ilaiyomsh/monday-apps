# POC Conclusions — Custom Object Direct Sync

**POC ran:** 2026-04-16
**Verdict:** ✅ Architecture validated end-to-end. Proceed to real product.

## What this POC proved

| Claim being tested | Result |
|---|---|
| Google Calendar → monday sync works **without** monday's Credentials feature | ✅ — Our server ran the full OAuth flow (consent, code exchange, access_token + refresh_token storage, on-demand refresh) against our own GCP OAuth client. Google Credentials feature was never touched. |
| Monday GraphQL writes work **without** automation triggers/actions | ✅ — Direct calls to `https://api.monday.com/v2` with a user-scoped token, bypassing `shortLivedToken` and the recipe runtime. |
| Admin "instance policy" and user "connection row" scale as separate entities | ✅ — `instance_policy_<objectId>` shared across all rows; `sync_config_<configId>` per-user. Policy mutations don't touch connection rows and vice versa. |
| `(accountId, objectId, userId)` triplet is a workable scope | ✅ — Storage indexed three ways (by objectId for the table, by userId for "my rows", by accountId for admin view). Lazy row creation on first GET worked. |
| `syncToken`-based "watch new" semantics match the intended UX | ✅ — After capturing an initial syncToken representing "now", subsequent sync pulls returned only newly created/modified events. No history backfill. |
| Decision matrix: create / update / delete, keyed by Link column lookup | ✅ — New event → `create_item`; cancelled event → `findItemByLink` → `delete_item`. Lookup-by-URL scales without per-event storage. |
| `peopleColumnId` auto-assignment to row owner | ✅ — Every created item had the row's `userId` in the People column. |
| Full column mapping: literal values + sourced from event fields | ✅ — Date columns mapped to `startDate`/`endDate`, text to `description`, name to `eventName`, link to `htmlLink`, people to row owner. |

## What was deliberately **not** validated (out of POC scope)

- `monday.get('sessionToken')` verification — we used custom `x-account-id` / `x-user-id` / `x-user-role` headers for local identity. Real product must swap this for JWT verification with `MONDAY_CLIENT_SECRET`.
- monday OAuth per-user flow — stubbed in code but never exercised. We used `MONDAY_FALLBACK_ACCESS_TOKEN` (a personal API token) as a shortcut. Real product will invoke the OAuth flow for each user.
- Lifecycle webhooks (`AppFeatureObject:create|delete`) — the `/lifecycle/custom-object` endpoint was never wired. Real product must verify signing-secret JWTs and auto-provision/teardown `instance_policy` + configs.
- Real Google push — no `calendar.watch()` was registered; sync was triggered manually via `POST /api/configs/:configId/force-sync`. Real product needs watch channel + `/webhook/google` receiving push notifications + daily renewal cron.
- SecureStorage — we used file-backed storage with a write lock (`storage.js`). The interface is compatible with `@mondaycom/apps-sdk` SecureStorage; real product swaps backend, keeps shape.
- Multi-user — only one user (`71077014`) was exercised. Works logically by design but not proven live.
- Policy change on an active instance — didn't test changing `boardId` while rows were syncing.
- iframe rendering inside monday — we used a local HTML UI served by Express. Real product will serve a React/Vite bundle from `/admin/*` and render inside the Custom Object iframe.
- CSP / security headers — none set. Real product needs `frame-ancestors https://*.monday.com` etc.

## Key learnings (non-obvious)

1. **monday Date column does not accept ISO datetime strings.** `2024-09-12T10:30:00+03:00` returns a 200 HTTP with an error embedded: `ColumnValueException: invalid value`. Correct shape is `{"date": "YYYY-MM-DD", "time": "HH:MM:SS"}` — UTC. The v3 path got away with ISO because monday's Item Values middleware did the conversion. Direct GraphQL does not. **We must convert in our code.** (See `sync.js:toMondayDate`.)

2. **`nextSyncToken` is only emitted on the LAST page.** A single-page `events.list(timeMin=now)` call that has more results returns `nextPageToken` but **no** `nextSyncToken`. You must paginate through all pages to capture the token. The first version of `listGoogleEvents` had no pagination → `googleSyncToken` stayed `null` forever → every `force-sync` refetched history → silent-feeling failure mode.

3. **`singleEvents: true` is mandatory.** With the default (`false`), recurring events come back as single "master" entries; individual instances (that the user actually sees on their calendar) never flow through. Each sync would see only the master metadata. Switching to `true` expands recurring events into real per-occurrence items.

4. **`timeMin = now` is essential for "watch-new" semantics.** Without it, the initial `events.list` pulls events back to the start of the calendar — for our test user, 2091 events and counting. Even when discarded (initial syncToken capture), this is expensive. With `timeMin = now`, the initial fetch returns only future events, still paginated, but much smaller.

5. **`dotenv` does not override existing environment variables.** If the shell has `PORT=""` (empty but defined), `.env`'s `PORT=8090` is silently ignored and Node falls back to the defaulting chain. Always start from a clean shell OR explicitly call `dotenv.config({ override: true })`.

6. **Silent typo in `.env`:** `PORT=090` → `Number("090") = 90` (leading zero doesn't mean octal here, but it's still not 8090). Server listened on the wrong port; tunnel couldn't proxy. Five minutes of debugging for a one-character bug.

7. **OAuth callback goes to a fresh tab** (the UI did `window.open(authUrl)`). Main tab doesn't know the callback fired; user must manually click Load Rows to see updated state. Real product should use `postMessage` from callback → opener to trigger auto-refresh, or redirect within the iframe flow.

8. **OAuth state entries accumulate in storage** without TTL sweeping. Stale `google_oauth_state_*` entries collected after every retry. Lazy cleanup on `consumeOauthState` OR a scheduled sweep is needed.

9. **monday personal API tokens are perfect for POC shortcut.** Drop one in env var, skip the monday OAuth flow entirely. But they erase the per-user identity distinction (all writes look like "me"), so they are strictly dev-only.

10. **Google's `apps-tunnel.monday.app` URL rotates.** Each `mapps tunnel:create` produces a new hash segment. If your OAuth redirect URIs or `APP_BASE_URL` are pinned to a specific tunnel, plan for reconfiguration. For pure OAuth testing, `http://localhost:8090` is the stable option.

## Architectural decisions confirmed

The POC validates the architectural direction in `docs/12-custom-object-work-plan.md`. The separation of concerns holds up under actual load:

- **Scope triplet `(accountId, objectId, userId)`** — enables multi-instance, multi-user, multi-account cleanly. No storage migration needed when new Custom Object instances are added.
- **Instance policy vs. user connection split** — simplifies both data model and authorization. Admin touches `/api/policy`, users touch `/api/configs/:id`. No cross-contamination.
- **Server-owned Google OAuth** — full control over refresh cadence, token storage, error handling. No opaque monday Credentials layer.
- **Link column as event identity** — `findItemByLink` scales to any board size without per-event storage. Proven by delete-on-cancellation lookup.
- **File storage with write lock** — the interface (`getConfig` / `setConfig` / `withLock`) maps 1:1 to `SecureStorage`. Swap is trivial.

## Things to do differently in the real product

1. **sessionToken JWT middleware** instead of header-based identity. Real product verifies every request with `MONDAY_CLIENT_SECRET`.
2. **React + Vite bundle** under `src/client/admin/` built to `public/admin/` and served statically by Express. Drop the vanilla HTML.
3. **Lifecycle webhook handler** — POC skipped. Real product auto-provisions `instance_policy_<objectId>` and `ownerUserId` on `AppFeatureObject:create`, tears down on `:delete`.
4. **Google Watch Channel registration** — `calendar.watch()` on config activation (when both tokens + policy are set). Channel ID = configId. Daily renewal scheduler iterates `all_active_configs`.
5. **Push webhook handler** — `/webhook/google` reads `x-goog-channel-token` → `configId`, runs the same sync logic automatically. No manual force-sync.
6. **monday OAuth per user** — ditch `MONDAY_FALLBACK_ACCESS_TOKEN`. Real product completes the monday OAuth flow for each row owner at connect time.
7. **SecureStorage backend** — swap `storage.js`'s file-backend for `@mondaycom/apps-sdk` SecureStorage. Same function signatures.
8. **Projection layer** (`toClientProjection`) centralized — no response ever contains `*Token` fields. Client sees booleans + email only.
9. **CSP headers** on all HTML responses: `frame-ancestors https://*.monday.com`, restricted `connect-src` / `script-src`.
10. **Logger scrubbing** — ensure `googleRefreshToken` / `googleAccessToken` / `mondayAccessToken` / secrets never enter any log line.
11. **Rate-limit on force-sync** endpoint — 1/min per configId to prevent abuse.
12. **OAuth state TTL sweep** — either lazy (delete if expired on consume) or scheduled.
13. **Structured error surface** — replace free-form Error messages with enum codes (`google_disconnected`, `board_missing`, `policy_not_configured`) so the UI can render specific recovery affordances.
14. **Decline-after-accept handling** (already documented elsewhere) — `self.responseStatus === 'declined'` + `status: confirmed` should still fire a delete.

## What to run next

Follow `docs/12-custom-object-work-plan.md` Phase A → B → C. Do not reuse POC code verbatim — the architectural insights transfer, but every module should be rewritten in TypeScript against the real SDKs (SecureStorage, JWT verification, lifecycle webhooks).

Specifically:
- **Phase A1** — repo reshape, monorepo layout
- **Phase A2** — TypeScript + Vite scaffolding
- **Phase A3** — register Custom Object feature + OAuth client in Developer Center
- **Phase A6** — lifecycle webhook handler (first real monday integration point)

Then Phase B (OAuth flows), Phase C (runtime + watch channel + /webhook/google).

## Files in this POC

```
custom-object-direct-local/
├── CONCLUSIONS.md           ← this file
├── README.md                ← how to run
├── .env.example             ← sanitized template
├── server/
│   ├── index.js             Express + routes + OAuth callbacks + /admin static
│   ├── storage.js           file-backed storage with write lock
│   ├── sync.js              event → columns mapping + decision matrix + sync loop
│   ├── google-client.js     OAuth exchange/refresh + paginated events.list
│   └── monday-client.js     GraphQL create / find / update / rename / delete
├── ui/
│   ├── index.html           admin policy form + user row list
│   └── app.js               vanilla JS — identity headers + API calls
├── scripts/
│   ├── capture-sync-token.mjs   arm a config with a fresh Google syncToken
│   └── monday-write-test.mjs    smoke-test all monday GraphQL write paths
└── snapshot/
    └── poc-storage-final.json   storage state at end of successful POC run
```
