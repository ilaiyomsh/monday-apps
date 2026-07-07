---
name: add-to-status-hub
description: Set up logging for a monday.com app (or any Node.js app) — from a quick local console logger to full dual-transport Axiom observability wired into the multi-app status hub at github.com/ilaiyomsh/sync-calender-status (absorbs the retired `setup-logging` skill). Use when the user wants a logger, observability, a health dashboard, status page, or asks to "add to status hub" / "add to dashboard" / "תוסיף לdashboard" / "תוסיף תצפית" / "תוסיף לוגים".
argument-hint: [app-slug]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

# Add App to Status Hub

End-to-end logging setup for an app — from a throwaway local logger to the daily-refreshed dashboards at https://ilaiyomsh.github.io/sync-calender-status/.

## Decision tree — read this first

Ask (or infer from context) which of these the user actually needs before touching any files:

1. **Need a dashboard / observability / "why did this fail in prod" visibility?**
   → Go to **Path A: Axiom dual-transport** (the "Two parts" procedure below). This is the default for monday.com apps and anything already gaining users.
2. **Just want quick local console logging** (dev-loop only, no server-side aggregation, no dashboard)?
   → Go to **Path B: local console logger** — copy a template from `templates/local-logger/` (`browser-logger.ts` for Vite/SPA, `node-logger.ts` for Express/Node) and stop there. No Axiom, no hub registration.
3. **Already has a working logger and just needs a one-off production diagnostic** (a hard-to-reproduce bug, not a standing observability need)?
   → Skip both paths — go straight to **"Production diagnostics"** below and extend the existing logger instead of creating a new one.

Don't default to Path A for a throwaway internal script; don't default to Path B for anything that will run in production past a week — it will need Path A eventually and doing it twice wastes a session.

## Duplicate-logger check (always run first, both paths)

Before creating any logger file, check whether one already exists — never hand-roll a second logger next to an existing one:

```bash
grep -rliE 'class Logger|export.*logger' src/ --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null
find . -iname "Logger.ts" -o -iname "logger.ts" -o -iname "logger.js" 2>/dev/null | grep -v node_modules
grep -rl "@axiomhq/js\|AXIOM_TOKEN\|AXIOM_DATASET" src/ .env 2>/dev/null
```

- If a `Logger.ts`/`logger.ts`/`logger.js` already exists → read it first. If it already has Axiom wired in, you're on Path A already — go to "Register in the hub" (Step 5) instead of "Copy the logger" (Step 2). If it's a bare console logger, either leave it (Path B is satisfied) or upgrade it in place (don't create a second file next to it).
- If nothing exists → proceed with the path chosen above.

## Path B — local-only console logger (no dashboard)

Use this when Path A isn't warranted (see decision tree). Templates live in `templates/local-logger/`:

- **Browser/Vite/SPA** → `templates/local-logger/browser-logger.ts` → create as `src/utils/Logger.ts`
- **Node/Express** → `templates/local-logger/node-logger.ts` → create as `src/utils/logger.ts` (or `src/lib/logger.ts`)

Both give: DEBUG/INFO/WARN/ERROR levels, environment-aware defaults (prod=ERROR, dev=DEBUG), runtime control (`window.AppLogger.*` in browser, `LOG_LEVEL`/`LOG_ENABLED` env vars in Node), and a `createLabeled(component)` helper for per-module prefixes.

**Dual-target apps (Vite frontend + Express backend in one repo — the common monday.com app shape):** copy BOTH templates — `browser-logger.ts` into the client's `src/utils/Logger.ts` and `node-logger.ts` into the server's `src/utils/logger.ts` (or wherever the Express entry's utils live). Keep the log-level and label conventions ("Logging Standards" below) identical across both so a grep for `[ComponentName]` works the same on either side. Don't try to share one literal file between a Vite-bundled client and a Node server — the env-detection (`import.meta.env` vs `process.env`) differs; two small files beat one file with runtime branching.

After creating the logger, replace existing `console.*` calls:
```typescript
// Before
console.log('User logged in:', userId);
// After
import { logger } from './utils/Logger';
logger.info('[Auth] User logged in:', userId);
```

**Logging Standards** — format: `[ComponentName] Action: Details`.

| Level | Use For |
|-------|---------|
| ERROR | Exceptions, critical failures, API errors |
| WARN  | Non-critical issues, deprecations, recoverable failures |
| INFO  | High-level flow (app started, module loaded) |
| DEBUG | Development details, variable states, API responses |

**Verify:** run the app, confirm styled console output; test `window.AppLogger.setLevel('ERROR')` suppresses DEBUG/INFO/WARN; confirm no raw `console.*` calls remain (`grep -r "console\." src/ | grep -v Logger`). Stop here for Path B — no hub registration, no Axiom.

## Path A — Axiom dual-transport + status hub

Two parts, in order:

1. **App side** — drop in the standard dual-transport logger, install deps, configure env vars.
2. **Hub side** — register the app by adding `apps/<slug>/config.mjs` to the hub repo and pushing.

## Reference locations

- Canonical dual-transport logger (production-verified source): the sync-calender app's `src/services/logger.js` — `Axis/sync-calender/src/services/logger.js` relative to the project root; if that app isn't checked out on this machine, take the logger from the hub repo / GitHub instead (the `_axiom-dashboard-template/` directory this skill used to reference no longer exists — see `references/quirks.md`)
- Hub repo (local clone): `sync-calender-status/` under the project root; if not present, clone `ilaiyomsh/sync-calender-status` there first
- Hub repo (GitHub): `ilaiyomsh/sync-calender-status`
- Live URL: `https://ilaiyomsh.github.io/sync-calender-status/<slug>/`

## Required up-front questions

Use **AskUserQuestion** to gather only what isn't obvious from `$ARGUMENTS` or `pwd`:

1. **Slug** (if not in `$ARGUMENTS`): kebab-case, becomes the URL path. Default: current directory's name.
2. **Axiom dataset name**: usually `<slug>-prod`. Confirm.
3. **App platform** — affects which logger transports to keep:
   - `monday code` (default) — keep both `@mondaycom/apps-sdk` MondayLogger + Axiom
   - `node` / `express` — strip the MondayLogger import, leave Axiom + console
   - `browser` / `spa` — this skill's Path A (full INFO observability + per-app dataset) is still not for SPAs (the per-app ingest token in a client bundle buys a whole dataset's exposure for a firehose stream). BUT: **error-only remote monitoring for SPAs is solved and sanctioned** — the `error-guard` skill ships WARN/ERROR to the shared `app-errors` dataset with a deliberately-exposed, ingest-only shared token (user decision 2026-07-07; runbook: `error-guard/references/remote-monitoring.md`). If the user wants "errors visible in prod" → route them there. If they want the full dashboard for an SPA → recommend a `/api/log` backend proxy; do not proceed automatically.
4. **Display name & emoji** — used in the dashboard header (e.g. "My App" + "🚀"). Skip if obvious from the project's README/package.json.

Don't ask things you can figure out by reading files (e.g. package.json for monday vs node detection).

## Implementation steps

### Step 1 — verify the app dir

```bash
ls package.json src/ 2>/dev/null || echo "not in an app dir"
```

If no `package.json`, abort and ask user where the app lives.

### Step 2 — copy the logger

Source: `Axis/sync-calender/src/services/logger.js` (relative to the project root; see
"Reference locations" above if that app isn't checked out here) — the
production-verified dual-transport implementation (monday Logger + Axiom). Adapt
`APP_NAME` fallback and strip sync-calender-specific helpers if any were added since.

Target: `src/services/logger.js` (create dir if missing).

For **node/express** platform: after copying, remove these two lines:
```js
import { Logger as MondayLogger } from '@mondaycom/apps-sdk';
// …
const mondayLogger = new MondayLogger(APP_NAME);
```
…and remove the `mondayLogger.info/warn/error` calls (keep the Axiom + console transports). Use Read+Edit.

### Step 3 — install dependency

```bash
npm install @axiomhq/js
```

For monday platform, `@mondaycom/apps-sdk` is usually already present — check `package.json` before installing.

### Step 4 — env vars

For **monday code** apps, output these commands for the user to run (don't run them — they need the user's APP_ID and the Axiom ingest token):

```bash
mapps code:env -i <APP_ID> -m set -k AXIOM_TOKEN -v <ingest-token>
mapps code:env -i <APP_ID> -m set -k AXIOM_DATASET -v <slug>-prod
mapps code:env -i <APP_ID> -m set -k AXIOM_APP_NAME -v <slug>
```

For **node** apps, instruct user to add to `.env` / hosting platform env config.

**Do not attempt to read or write any Axiom token from disk** — even if asked. The classifier blocks it for safety. User pastes the token directly into `mapps code:env` or the GitHub secret form themselves.

### Step 5 — register in the hub

```bash
# Hub clone lives under the project root; clone it there if missing
HUB_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}/sync-calender-status"
[ -d "$HUB_DIR" ] || git clone https://github.com/ilaiyomsh/sync-calender-status "$HUB_DIR"
cd "$HUB_DIR"
mkdir -p apps/<slug>
```

Create `apps/<slug>/config.mjs`:
```js
export default {
  name: '<Human Name>',
  emoji: '<emoji>',
  dataset: '<slug>-prod',
  description: '<one-liner>',
  providers: ['google', 'microsoft'],  // omit or adjust if the app doesn't use providers
};
```

Then:
```bash
git add apps/<slug>/config.mjs
git -c commit.gpgsign=false commit -m "Add <slug> to hub"
git push
gh workflow run refresh.yml --repo ilaiyomsh/sync-calender-status
```

### Step 6 — verify

Watch the workflow:
```bash
RUN_ID=$(gh run list --repo ilaiyomsh/sync-calender-status --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch $RUN_ID --repo ilaiyomsh/sync-calender-status --exit-status --compact
```

If the first run fails because the app hasn't logged anything yet, that's fine — queries return zero rows but the dashboard still renders. Tell the user the dashboard will populate as soon as the app starts emitting `webhook_received` / `sync_done` / etc.

### Step 7 — report back

Final message to user must include:
- Live URL: `https://ilaiyomsh.github.io/sync-calender-status/<slug>/`
- The 3 env-var commands they still need to run (Step 4) if not done
- A reminder of which logger fields the dashboard expects (see "Logging conventions" below)

## Logging conventions the dashboard reads

These are non-negotiable — the shared queries in `scripts/queries.mjs` filter on these exact field names. If the app needs to log additional structured fields, add them freely but don't rename these:

| Field | Required for | Notes |
|---|---|---|
| `tag` | every log | category: `webhook`, `sync`, `oauth`, `policy`, `scheduler`, `configs`, `monday_api` |
| `message` | every log | event id: `webhook_received`, `sync_done`, `connected`, `policy_updated`, … |
| `level` | every log | `error` / `warn` / `info` / `debug` |
| `acc` | when known | account/tenant id |
| `usr` | when known | user id |
| `obj` | when known | object/instance id |
| `cfg` | when known | config id |
| `prv` | sync/webhook events | provider name |
| `created`/`updated`/`deleted`/`skipped`/`ms`/`total` | `sync_done` only | summary counts |

Show the user 2-3 example `logger.*` calls using these fields so the conventions stick.

## Production diagnostics (hard-to-reproduce prod bugs)

When a bug can't be reproduced locally (common for monday apps — see the iframe/postMessage local-run gap) and you need to instrument production to catch it live, **extend the app's existing logging service with a tagged diagnostic channel** instead of hand-rolling a one-off module. This generalizes the `[RELOAD-DIAG]` / `[VERSION_PROBE]` pattern that has repeatedly been built from scratch per-incident:

1. **Run the duplicate-logger check above first.** There is already a logger (Path A's Axiom logger or Path B's console logger) — add to it, don't create `diagnostic-logger.ts` or similar next to it.
2. **Pick one short, greppable tag** for this specific investigation, e.g. `[RELOAD-DIAG]` or `[VERSION_PROBE]` — uppercase, bracketed, unique enough that `grep` isolates only this incident's lines from normal traffic.
3. **Buffer in `sessionStorage`** (browser) so the trail survives reloads/navigations within the same tab session — the exact failure this pattern exists for is bugs that only surface across a reload:
   ```typescript
   const DIAG_KEY = 'diag_reload_trace';
   function diagLog(msg: string) {
     const line = `${new Date().toISOString()} ${msg}`;
     const buf = JSON.parse(sessionStorage.getItem(DIAG_KEY) || '[]');
     buf.push(line);
     sessionStorage.setItem(DIAG_KEY, JSON.stringify(buf.slice(-200))); // cap growth
     logger.debug('[RELOAD-DIAG]', msg); // also goes through the existing logger/transport
   }
   ```
4. **Give the user a paste-back path** — most of these bugs are diagnosed by a non-technical user pasting console output, not by the agent reproducing it directly. Tell them explicitly:
   - Open DevTools (F12) → Console tab.
   - Check **"Preserve log"** (so output survives the reload the bug happens across).
   - Reproduce the issue, then select-all and copy the console output (or run `copy(sessionStorage.getItem('diag_reload_trace'))` in the console to grab just the buffered trail).
   - Paste it back into the chat.
5. **Remove the diagnostic tag once the bug is fixed** — it's instrumentation for one investigation, not a permanent feature. Leaving stale `[RELOAD-DIAG]`-style tags in place is exactly the one-off-module sprawl this section exists to avoid.
6. If the app is already wired to Axiom (Path A), the diagnostic lines land there too — use **`axiom-sre`** to query them (filter on the tag) instead of relying solely on user-pasted console dumps once the app is instrumented.

## See also

- **`error-guard`** — owns the catch discipline up to and including the app's local logger sink (every error caught, logged, displayed); remote sinks start HERE — once error-guard has errors flowing into the local logger, this skill is what ships them to Axiom/the hub.
- **`axiom-sre`** — once logs are landing in Axiom (Path A), use that skill to query, triage, and root-cause what shows up — including the known monday.com error-signature crib (`UNAUTHORIZED_FIELD_OR_TYPE` / `FIELD_MINUTE_RATE_LIMIT_EXCEEDED`). This skill writes the logs; `axiom-sre` reads them. Together they're one instrumentation → investigation loop.

## When NOT to use Path A (Axiom dual-transport + hub)

- The app is **client-side only** (browser/SPA) with no backend — the ingest token would be exposed. Use **Path B** (local console logger) instead, or recommend a backend `/api/log` endpoint that proxies to Axiom if a dashboard is truly needed.
- The app uses **a different observability stack** (Datadog, Sentry, OTel collector). Path A is Axiom-specific.
- The user is asking to **modify the hub itself** (queries, template, design) — that's editing `sync-calender-status/scripts/` directly, not registering a new app.
- It's a throwaway script or dev-only tool that will never run unattended in production — Path B is enough; don't set up a dashboard for something with no one to page.

## Self-improvement — when the skill itself fails you

When this skill's guidance misfires — a logger template out of sync with `templates/local-logger/`, an Axiom wiring step (Step 3/4) that no longer matches current SDK/CLI behavior, or a hub registration step (Step 5-6) that breaks against the current `sync-calender-status` repo shape:

1. Treat it as a bug in this skill, not just an obstacle in the task — don't quietly hand-patch the app and move on.
2. Same-session recording is mandatory (project standing rule): fix the stale step/template here, or append the quirk — what broke, the verified fix — to a `references/quirks.md` page (create the `references/` folder if this skill doesn't have one yet).
3. Out of scope to fix right now? Leave a known-gap note with fix direction, and tell the user what's stale.
4. Never skip a step (e.g. the duplicate-logger check, or Step 6 verification) just to get unblocked — narrow it only once you've confirmed skipping it was safe.
