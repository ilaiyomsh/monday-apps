# Verifying a deploy on the LIVE board — the only definition of "done"

A CDN hash-diff (ship.sh step 7) proves the bundle shipped. It does NOT prove
the feature renders or behaves inside the monday iframe. Multiple incidents:
"verified" hash-matched deploys were immediately screenshotted broken by the
user. So: **hash-diff is necessary but not sufficient — "done" may only be
reported after driving the exact changed flow live.**

## Procedure (claude-in-chrome)

1. Load the browser tools (ToolSearch `select:` the claude-in-chrome set) and
   confirm a connected browser.
2. **Fresh tab per check.** Open the target board URL in a NEW tab
   (`tabs_create_mcp` + `navigate`). Do not reuse a tab that has navigated:
   iframe clicks silently stop registering after in-tab navigation, and tab
   groups go stale between turns. One check = one fresh tab. Close it after.
3. Navigate to the exact board/view/item the change affects — not the app in
   general, the **changed flow**: the specific button, column, dialog, or
   render path that this deploy modified.
4. Drive the flow: click/type exactly what a user would. If the app gates on
   SDK context, the live board is the only place it fully runs — that is why
   you are here.
5. Capture evidence, both of:
   - a **screenshot** of the changed UI state (after the interaction, not the
     landing state);
   - **read_console_messages** — zero new errors from the app's bundle during
     the flow. A GraphQL validation error in the console means NOT done, even
     if the UI looks right.
6. Mobile-looking-stale reports: deploy:force reuses the version id + CDN URL,
   so the monday mobile webview may serve a cached bundle while desktop is
   fresh. Verify on desktop web first; do not chase mobile cache as a deploy
   failure.

If a click seems to do nothing inside the iframe: assume the fresh-tab rule was
violated. Close the tab, open a new one, retry once before debugging the app.

## API-equivalence fallback (browser unavailable)

When claude-in-chrome is not connected, permissions are denied mid-task, or the
flow is headless (webhooks, schedulers, integrations):

1. Identify the API-visible effect of the changed flow (an item created, a
   column value written, a storage key set, a webhook response).
2. Trigger it as close to real as possible (e.g. call the deployed endpoint,
   or perform the triggering mutation via
   `.claude/skills/mapps/mapps-api.sh` — probes only in
   TEST_WORKSPACE_ID=16291824, scratch objects prefixed `WZ-`, deleted after).
3. Read the effect back with a minimal query (`limit: 1`) and compare against
   the expected new behavior — the assertion must distinguish new behavior
   from old (otherwise it proves nothing about this deploy).
4. Check `mapps code:logs -i <APP_VERSION_ID> -s live -t console` (and `-t http`
   for 4xx/5xx) during the trigger window.
5. Report the verification as API-level, and say what was NOT verified (visual
   rendering) — the user decides if a manual look is needed.

## What is never acceptable

- Reporting done from build success, green tests, or typecheck alone.
- Reporting done from the hash-diff alone.
- "Verified by inspection" because the dev server / tests could not run
  (missing node_modules in a worktree — fix the environment instead;
  run `scripts/preflight.sh`).
- Verifying a DIFFERENT flow than the one the change touched.
