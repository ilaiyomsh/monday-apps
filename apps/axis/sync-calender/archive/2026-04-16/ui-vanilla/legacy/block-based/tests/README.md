# Tests — sync-calender

**➡️ The full guide is in [`TESTING.md`](./TESTING.md)** (architecture, scenario catalog, life-cycle walkthrough, troubleshooting, how to add a new scenario).

## TL;DR

Prerequisites: populate `.env` with `MONDAY_SIGNING_SECRET`, `MONDAY_API_TOKEN`, and (for Tier 1 only) a recent `TEST_CHANNEL_ID`. See [`TESTING.md §2`](./TESTING.md#2-prerequisites) for the full list.

```bash
# Single scenario
node tests/run.js action/create-event
node tests/run.js e2e/self-organized-create

# Whole tier
node tests/run.js all action       # ~60s, hits deployed server
node tests/run.js all e2e          # ~4–6 min, local app + mock Google

# Everything
node tests/run.js all

# Manual cleanup of test-* items
node -e "import('./tests/lib/cleanup.js').then(m=>m.deleteItemsByPrefix().then(console.log))"
```

## Layout

```
tests/
├── TESTING.md               # full guide — read this
├── README.md                # this file
├── run.js                   # CLI dispatcher
├── lib/
│   ├── config.js            # .env → test config
│   ├── jwt-helper.js        # signs action JWTs
│   ├── monday-query.js      # direct GraphQL helpers (verification)
│   ├── assert.js            # tiny assertion tracker
│   ├── results-log.js       # append-only run logger (two files)
│   ├── http.js              # fetch + polling helpers
│   ├── cleanup.js           # storage + manual board cleanup
│   ├── action-helper.js     # Tier 1 helpers (invokeAction, waitForItem…)
│   ├── event-builder.js     # Google Calendar event factories
│   ├── local-harness.js     # spawn/stop local app + mock subprocesses
│   ├── e2e-setup.js         # one-shot Tier 2 harness
│   └── e2e-helper.js        # Tier 2 polling helpers
├── mock-google/
│   └── server.js            # mock Google Calendar + oauth2 + monday relay
├── scenarios/
│   ├── m1-localstorage-contract.js
│   ├── m2-mock-google-smoke.js
│   ├── m3-mock-relay-smoke.js
│   ├── m4-harness-smoke.js
│   ├── action/              # Tier 1 (9 scenarios)
│   └── e2e/                 # Tier 2 (13 core + 12 edge cases)
│       └── edge/
├── results.log              # append-only human-readable history (git-ignored)
└── results.jsonl            # append-only machine-readable history (git-ignored)
```

## What's covered

- **CRUD on monday** — create, update (title / date / description / location / multi), delete.
- **RSVP lifecycle** — invited-no-response (skip), invited-then-accept (create at accept), accept-then-decline (delete), accept-then-cancel-event (delete), self-organized (create).
- **Batching** — multiple events in one webhook, same eventId twice in one batch.
- **Edge cases** — all-day events, DST boundary, Unicode (Hebrew + emoji), empty title (falls back to "(no title)"), long title (256-char limit), UTC midnight, multi-day, sync-token expired (410), empty webhook, pagination, duplicate in batch, event already deleted.

Current status: **~34 scenarios, ~124 assertions, all green**. See [`TESTING.md §5`](./TESTING.md#5-scenario-catalog) for every scenario's purpose.
