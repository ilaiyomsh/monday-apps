---
name: integration-scaffold
description: Generate a complete Monday.com integration app skeleton for workflows — triggers, actions, custom fields, async actions, credentials
argument-hint: [app-name]
allowed-tools: Read, Write, Glob, Bash
---

# Monday.com Integration App Scaffold Generator

Generate production-ready Monday.com **integration apps** for the **workflows** platform. Creates a plugin-based monorepo with auto-discovery of trigger and action blocks.

## App Name: $ARGUMENTS

## What Gets Generated

A pnpm monorepo with:
- **Express.js server** on port 8080 — JWT auth, request logging, error handling
- **Auto-loader** — Discovers tools and blocks at startup from `tools/*/blocks/*`
- **Shared package** — Middlewares, services (logger, monday-api, trigger-service), helpers
- **Triggers router** — `POST /monday/subscribe` + `/monday/unsubscribe`
- **Actions router** — `POST /monday/execute_action/:blockName`
- **Fields router** — `POST /monday/fields/:blockName/:fieldName`
- **Example tool** with one trigger block and one action block
- **Trigger service** — `fireTrigger()` for webhook invocation, `sendActionCallback()` for async actions
- **Subscription store** — In-memory storage for trigger subscriptions
- **error-guard wiring (server variant), compliant from birth** — logger choke-point (log-once, `addSink`), `asyncHandler` for async routes, terminal `errorMiddleware`, `installProcessGuards` (log → flush → exit), optional Axiom error sink (inert until `AXIOM_*` env vars are set — see `error-guard/references/remote-monitoring.md`), the 4-rule ESLint kit in the root `package.json`, and an `.error-guard` marker (the mapps ship gate runs a blocking audit). Server patterns ruler: `error-guard/references/server-patterns.md`.

## Project Structure

```
app-name/
├── package.json              # Monorepo root with pnpm workspace scripts + ESLint error-rules kit
├── pnpm-workspace.yaml       # packages/*, server, tools/*
├── .env.example              # MONDAY_SIGNING_SECRET, MONDAY_APP_ID, PORT (+ optional AXIOM_*)
├── .error-guard              # Marker: ship gate runs a blocking error-guard audit
├── .gitignore
├── server/
│   ├── package.json
│   └── src/
│       ├── app.js            # Express entry (port 8080)
│       ├── constants/index.js
│       └── routes/
│           ├── index.js      # Main router + health check
│           ├── auto-loader.js # Plugin discovery
│           ├── actions.js    # Action routing
│           ├── triggers.js   # Subscribe/unsubscribe routing
│           └── fields.js     # Custom field routing
├── packages/shared/
│   ├── package.json
│   └── src/
│       ├── index.js          # Barrel exports
│       ├── middlewares/
│       │   ├── index.js
│       │   ├── authentication.js  # JWT verification
│       │   ├── request-logger.js
│       │   └── error-middleware.js # Terminal Express error handler (logs once, safe JSON)
│       ├── services/
│       │   ├── logger/index.js    # error-guard server logger (choke-point, log-once, addSink)
│       │   ├── axiom-sink.js      # Optional remote error shipping (AXIOM_* env gate)
│       │   ├── process-guards.js  # uncaughtException/unhandledRejection/SIGTERM nets
│       │   ├── monday-api.js      # GraphQL client + column formatters
│       │   └── trigger-service.js # fireTrigger() + sendActionCallback()
│       └── helpers/
│           ├── async-handler.js   # Express 4 async route wrapper (mandatory on async handlers)
│           ├── secret-store.js
│           ├── field-extractors.js
│           └── subscription-store.js
└── tools/
    └── example-integration/
        ├── package.json
        ├── tool.config.js
        └── blocks/
            ├── example-trigger/   # Trigger block
            │   ├── block.config.js
            │   ├── index.js
            │   ├── trigger.js     # subscribe/unsubscribe handlers
            │   └── fields.js
            └── example-action/    # Action block
                ├── block.config.js
                ├── index.js
                ├── action.js      # executeAction handler
                └── fields.js
```

## Implementation Instructions

When the user invokes `/integration-scaffold [app-name]`:

1. **Determine target directory**:
   - If `app-name` is provided, create under current directory
   - If already in a project directory (has package.json), use current directory
   - Otherwise ask for a name

2. **Generate all files** using templates from `./templates/`

3. **Replace placeholders** in all files:
   - `__APP_NAME__` → app name (kebab-case, e.g. `report-reminder`)
   - `__APP_NAME_PASCAL__` → PascalCase (e.g. `ReportReminder`)
   - `__PACKAGE_SCOPE__` → npm scope (e.g. `@report-reminder`)

4. **Run `pnpm install`** in the generated directory

5. **Remind user to**:
   - Copy `.env.example` to `.env` and fill in `MONDAY_SIGNING_SECRET` + `MONDAY_APP_ID`
   - Replace `APP_ID` in `server/package.json` scripts
   - Create the app in Monday Developer Center
   - Add automation block features (trigger and/or action)
   - Configure block URLs pointing to the server endpoints
   - (Optional, for production monitoring) set `AXIOM_TOKEN` / `AXIOM_DATASET=app-errors` /
     `AXIOM_APP_NAME` via `mapps code:env` — the user pastes the token themselves
     (see `error-guard/references/remote-monitoring.md`)

6. **Error-handling rules for generated code** (error-guard, server variant):
   - Every NEW async route handler must be wrapped in `asyncHandler(...)` — Express 4
     does not catch rejected promises.
   - Every catch: `logger.*` / `throw` / `next(err)` — never silent.
   - Application code never calls `console.*` — the logger owns stdout.
   - Full ruler: `.claude/skills/error-guard/references/server-patterns.md`.

## Block Types

### Trigger Block

Starts a workflow when an external event occurs.

**Required exports from `index.js`:**
```javascript
export { subscribeTrigger, unsubscribeTrigger } from './trigger.js';
export { fieldHandlers } from './fields.js';
export const metadata = { name, type: 'trigger', inputFields, outputFields };
```

**Endpoints (configured in Developer Center):**
- Subscribe URL: `{baseUrl}/monday/subscribe/{blockName}`
- Unsubscribe URL: `{baseUrl}/monday/unsubscribe/{blockName}`

**Subscribe flow:**
1. Monday POSTs `{ payload: { webhookUrl, subscriptionId, inputFields, recipeId } }`
2. App stores `webhookUrl` using subscription store
3. App returns `{ webhookId: subscriptionId }`

**Fire trigger (from your code):**
```javascript
import { fireTrigger, getSubscription } from '@{scope}/shared';
const sub = getSubscription(subscriptionId);
await fireTrigger(sub.webhookUrl, { field1: 'value', field2: 123 });
```

**Unsubscribe flow:**
1. Monday POSTs `{ payload: { webhookId } }`
2. App deletes subscription from store
3. App returns `200 OK`

### Action Block

Executes logic when a workflow runs.

**Required exports from `index.js`:**
```javascript
export { executeAction } from './action.js';
export { fieldHandlers } from './fields.js';
export const metadata = { name, type: 'action', inputFields, outputFields };
```

**Endpoint (configured in Developer Center):**
- Execution URL: `{baseUrl}/monday/execute_action/{blockName}`

**Execution flow:**
1. Monday POSTs `{ payload: { inputFields, blockMetadata, recipeId } }`
2. App processes the action using `req.session.shortLivedToken` for API calls
3. Returns `{ outputFields: { ... } }` on success
4. Returns `{ severityCode, notificationErrorTitle, notificationErrorDescription }` on error

### Async Action Block

For long-running operations. Same as action but returns immediately and calls back.

**Execution flow:**
1. Monday POSTs with `callbackUrl` in `runtimeMetadata`
2. App returns `200` immediately (acknowledgment)
3. App processes async
4. App calls `sendActionCallback(callbackUrl, true, { outputFields })` on success
5. Or `sendActionCallback(callbackUrl, false, { severityCode, ... })` on failure

### Custom Fields

Remote option handlers for dropdown fields in the Developer Center.

**Endpoint:** `{baseUrl}/monday/fields/{blockName}/{fieldName}` or `{baseUrl}/monday/{fieldName}`

**Handler returns:** `[{ title: "Display Name", value: "unique_id" }, ...]`

**Dependency data** (when field depends on another field):
```javascript
const boardId = req.body?.payload?.dependencyData?.boardId?.value
  || req.body?.payload?.inputFields?.boardId?.value;
```

## Adding a New Tool

1. Create folder under `tools/`:
```
tools/my-tool/
├── package.json          # { dependencies: { "@{scope}/shared": "workspace:*" } }
├── tool.config.js        # { name, displayName, description, version }
└── blocks/
    └── my-block/
        ├── block.config.js
        ├── index.js      # Exports executeAction or subscribeTrigger/unsubscribeTrigger
        ├── action.js     # OR trigger.js
        └── fields.js
```

2. Run `pnpm install` to link the workspace
3. Restart server — auto-loader picks it up automatically

## Error Response Format

All action errors should follow this format:
```javascript
{
  severityCode: 4000,      // 4000 = retry possible, 6000 = disable automation
  notificationErrorTitle: "User-facing title",
  notificationErrorDescription: "User-facing message",
  runtimeErrorDescription: "Technical details for logs"
}
```

## Developer Center Configuration

For each automation block feature:

| Setting | Trigger | Action |
|---------|---------|--------|
| Block type | Trigger | Action |
| Subscribe URL | `{baseUrl}/monday/subscribe/{blockName}` | — |
| Unsubscribe URL | `{baseUrl}/monday/unsubscribe/{blockName}` | — |
| Execution URL | — | `{baseUrl}/monday/execute_action/{blockName}` |
| Input fields | Configure in UI | Configure in UI |
| Output fields | Configure in UI | Configure in UI |
| Remote options URL | `{baseUrl}/monday/fields/{blockName}/{fieldName}` | Same |

## Environment Variables

```bash
MONDAY_SIGNING_SECRET=  # From Developer Center > OAuth & Permissions
MONDAY_APP_ID=          # Your app's numeric ID
PORT=8080               # Server port (default 8080)
DEBUG=false             # Set to 'true' for debug logging
```

## Shared Services Reference

### monday-api.js
- `createApiClient(token)` — GraphQL client with API v2025-10
- `getColumnType(apiClient, boardId, columnId)` — Get column type
- `formatValueForColumnType(columnType, value)` — Format value for 20+ column types
- `updateColumnValue(apiClient, boardId, itemId, columnId, value)` — Update column

### trigger-service.js
- `fireTrigger(webhookUrl, outputFields)` — Sign JWT and POST to Monday webhook
- `sendActionCallback(callbackUrl, success, data)` — Async action completion callback
- `signTriggerToken(appId, signingSecret)` — Create signed JWT for trigger invocation

### subscription-store.js
- `saveSubscription(id, data)` — Store trigger subscription
- `getSubscription(id)` — Retrieve subscription
- `deleteSubscription(id)` — Remove subscription
- `getAllSubscriptions()` — List all active subscriptions

### field-extractors.js
- `extractFieldValue(field)` — Normalize `{value: x}` → `x`
- `extractFieldValues(inputFields, fieldNames)` — Batch extraction

## Usage Examples

```bash
# Generate integration app in current directory
/integration-scaffold

# Generate with a specific name
/integration-scaffold my-integration

# Generate for a specific use case
/integration-scaffold crm-sync
```

## Template Files Location

Templates are in `./templates/`:
- `root/` — Root config files (package.json, pnpm-workspace.yaml, .env.example, .gitignore)
- `server/` — Express server files
- `shared/` — Shared package (middlewares, services, helpers)
- `tool/` — Example tool with trigger and action blocks

## Self-improvement — when the skill itself fails you

When a generated server/tool skeleton fails to boot, the auto-loader misses a block, or a monday workflow-block schema (trigger/action/field payload shape) drifts from what's documented here:
1. Treat the failure as data about the SKILL, not just an obstacle to the task — do not silently hand-patch the one generated app and move on.
2. Same-session recording is mandatory (standing rule): fix the offending file under `templates/` itself, and record the quirk — this skill has no `references/` yet, so add a dated note directly in this file (a "Known quirks" subsection) or start a `references/known-issues.md` if the list grows — with what was observed and the verified resolution.
3. If a real fix is out of scope right now, record a known-gap note (same place) with fix directions and surface it to the user.
4. Never weaken the error-response contract (`severityCode`/`notificationError*`) or silently accept a schema mismatch just to get unblocked — narrow only with proof monday's actual payload changed.
