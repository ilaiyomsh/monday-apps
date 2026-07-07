# Custom Object Direct Sync POC (Local)

Runnable scaffold that validates the Custom Object architecture for calendar sync:

- ADMIN-managed shared policy (`boardId`, `linkColumnId`, `peopleColumnId`, `columnMapping`)
- USER-managed Google connection row
- Direct Google Calendar API + monday GraphQL writes (no automation runtime, no Credentials feature)

**Status: validated 2026-04-16.** See [`CONCLUSIONS.md`](./CONCLUSIONS.md) for findings.

## Folder layout

```
custom-object-direct-local/
├── CONCLUSIONS.md           findings from the experiment (read this)
├── README.md                this file
├── .env.example             sanitized template — copy to .env
├── server/                  Express app
├── ui/                      static admin UI (served at /admin)
├── scripts/                 one-off helpers
└── snapshot/                storage state at end of successful POC
```

## How to run

```bash
# 1. copy env template and fill credentials
cp poc/custom-object-direct-local/.env.example poc/custom-object-direct-local/.env
# edit: MONDAY_SIGNING_SECRET, MONDAY_CLIENT_SECRET,
#       GOOGLE_OAUTH_CLIENT_ID / SECRET,
#       MONDAY_FALLBACK_ACCESS_TOKEN (personal token — POC shortcut)
#       APP_BASE_URL (only needed if using tunnel for watch push)

# 2. start server (from project root)
node poc/custom-object-direct-local/server/index.js
# → POC server listening on http://localhost:8090

# 3. (optional) expose via tunnel for Google push later
mapps tunnel:create -p 8090 -a 11119011

# 4. open the UI in a browser
open http://localhost:8090/admin
```

## Identity model in this POC

To keep the POC runnable locally without full `sessionToken` verification, identity is passed via headers:

- `x-account-id`
- `x-user-id`
- `x-user-role` (`admin` or `user`)

In production, replace this with verified `sessionToken` JWT (`MONDAY_CLIENT_SECRET`). Middleware stub lives in `server/index.js::identityFromHeaders`.

## Test flow

1. **Set policy** — in UI, set `Role = admin`, fill Board + columns + Column Mapping JSON, click Save Policy.
2. **Switch to user** — `Role = user`, click Load Rows. One row should appear with `status: pending_connections`.
3. **Connect Google** — click Connect Google. Consent in Google, return to UI. Status should flip to `active`.
4. **(Optional) Arm syncToken** — `node scripts/capture-sync-token.mjs <configId>` pulls the paginated current calendar, discards events, stores `googleSyncToken` representing "now". Subsequent Force Sync returns only deltas.
5. **Test** — create a new event in Google Calendar, click Force Sync → item appears on the board.
6. **Delete** — cancel the event in calendar, Force Sync → item deleted from the board.

## Scripts

### `scripts/capture-sync-token.mjs`

Arms an existing config with a fresh `googleSyncToken` without writing any events to monday. Use this after the initial Google OAuth if you want "watch new events" semantics (no history backfill).

```bash
node poc/custom-object-direct-local/scripts/capture-sync-token.mjs <configId>
```

### `scripts/monday-write-test.mjs`

End-to-end smoke test of every monday GraphQL write path the sync engine uses (create / find by link / update / rename / delete). Creates a test item, exercises each path, deletes it cleanly. Leaves the board unchanged.

```bash
node poc/custom-object-direct-local/scripts/monday-write-test.mjs
```

## POC boundaries (read `CONCLUSIONS.md` for full list)

Deliberately **not** covered in this POC:

- Real Google push (no `calendar.watch()` registration)
- `monday.get('sessionToken')` JWT verification (header-based identity instead)
- monday OAuth per user (`MONDAY_FALLBACK_ACCESS_TOKEN` shortcut)
- `AppFeatureObject:*` lifecycle webhooks
- `@mondaycom/apps-sdk` SecureStorage (file storage instead)
- React UI (vanilla HTML/JS)
- Webhook signature validation
- CSP / iframe security headers

These are all Phase A / B / C work in `docs/12-custom-object-work-plan.md`.
