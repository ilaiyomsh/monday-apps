# Legacy: Block-based architecture (v3)

Retired on **2026-04-20**. The app now ships only the Custom Object admin UI path. This folder preserves the v3 monday.com automation-block implementation (Trigger + Action recipe) in case we ever revive it.

Nothing in this folder is imported by `src/`. Do not re-introduce these imports without also re-wiring routes in `src/index.js` and the Developer Center manifest.

## Layout (mirrors `src/` at the time of retirement)

```
legacy/block-based/
├── routes/
│   ├── triggers.js         # POST /triggers/subscribe, /triggers/unsubscribe
│   ├── actions.js          # POST /actions/sync-events
│   ├── auth.js             # POST /auth/google-identifier (Credentials feature)
│   ├── webhook.js.full     # pre-retirement /webhook/calendar (v3 + admin branch)
│   └── scheduler.js.full   # pre-retirement cron (v3 + admin renewal loops)
├── services/
│   └── monday-triggers.js  # fireTrigger() signing + POST to webhookUrl
├── middlewares/
│   └── authentication.js   # JWT verification for block routes
├── storage/
│   └── subscription-storage.js  # subscription_, trigger_cache_, all_active_subscriptions
├── tests/                  # Tier-1 action-direct + Tier-2 full E2E harness
└── docs/
    ├── architecture_v2.md
    ├── architecture_v3.md
    ├── 09-routing-fields-ux-research.md
    ├── 10-routing-refactor-plan.md
    ├── test-session-findings-2026-04-15.md
    └── e2e-test-plan.md
```

## Shared code that was NOT moved

These files still live in `src/` because the admin path depends on them — even though they originated in the v3 design:

- `src/services/google-calendar.js`, `google-oauth.js`, `monday-api.js`, `watch-channel.js`, `logger.js`
- `src/helpers/environment.js`
- `src/storage/local-storage.js`
- `src/routes/webhook.js` and `src/routes/scheduler.js` — slimmed down to the admin branch only. Full pre-retirement versions are preserved here as `*.full`.

## Reviving the block path

If you ever need it back:

1. `git mv legacy/block-based/routes/{triggers,actions,auth}.js src/routes/`
2. `git mv legacy/block-based/{services,middlewares,storage}/*.js` into `src/` counterparts
3. Replace `src/routes/webhook.js` and `src/routes/scheduler.js` with the `.full` copies (merge with current admin-only versions first)
4. Re-add mounts to `src/index.js`
5. Re-create the Trigger + Action blocks and Credentials feature in the Developer Center (see `docs/04-monday-auth.md` and the slugs in the retired `CLAUDE.md` history)
