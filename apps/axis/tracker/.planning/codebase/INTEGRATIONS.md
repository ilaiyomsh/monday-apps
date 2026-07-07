# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**Monday.com:**
- Monday.com GraphQL API - Core integration for board item CRUD and queries
  - SDK/Client: `monday-sdk-js` (v0.5.5)
  - Entry point: `App.jsx` instantiates `mondaySdk()` → `monday` singleton passed to hooks/context
  - API wrapper: `src/utils/mondayApi.js` - All queries/mutations execute via `monday.api(query, { variables })`
  - Authentication: Built-in to Monday iframe context (no explicit token needed)
  - Rate limiting: Not explicitly handled; Monday API has standard quotas

**Israel Holidays & Calendar:**
- Hebcal Hebrew Calendar API (@hebcal/core)
  - Used for calculating Israeli holidays
  - Location: `src/utils/holidayUtils.js` uses `HebrewCalendar` class
  - Purpose: Display Jewish holidays on work calendar (חגים)
  - No external API calls; local computation

## Data Storage

**Databases:**
- No traditional database used. All data persists via Monday.com boards:
  - Report board: Contains timed/all-day events with columns for date, duration, project, task, stage, notes
  - Projects board: Connected board for project selection
  - Tasks board: Connected board for task selection (optional)

**Persistent Settings:**
- Monday.com App Storage: `src/contexts/SettingsContext.jsx`
  - Mechanism: `monday.storage.instance.getItem('customSettings')` / `setItem()`
  - Data: User app configuration (board IDs, column IDs, structure mode, feature toggles)
  - Location: Monday's iframe storage (scoped to app instance)

**File Storage:**
- Not used. No file uploads/downloads in codebase.

**Caching:**
- In-memory React component state via `useState`
- No persistent cache layer (Redis, etc.)
- Events cached in `useMondayEvents` hook during active week navigation

## Authentication & Identity

**Auth Provider:**
- None explicit. Inherits from Monday.com iframe context
- `monday.get('context')` in `App.jsx` retrieves current user context
- All API calls authenticated via Monday SDK (auto-injects Monday session token)

**User Identity:**
- `fetchCurrentUser()` in `src/utils/mondayApi.js` - Retrieves logged-in user ID/name
- Used to filter events to current reporter and determine structure permissions

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Rollbar, etc.)
- Custom error wrapper: `src/utils/mondayApi.js` defines `MondayApiError` class
- Error details logged via custom `src/utils/logger.js`

**Logs:**
- Custom logger in `src/utils/logger.js` with levels:
  - `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`
  - `logger.api()`, `logger.apiResponse()`, `logger.apiError()` for API tracing
  - `logger.functionStart()`, `logger.functionEnd()` for execution flow
  - Production: Only ERROR level shown
  - Debug mode: Enabled via `window.enableDebugLogs()` in console
  - Output: Browser console (no centralized logging service)

**Error Handling:**
- Global error handler in `src/utils/globalErrorHandler.js`
- Error boundary component: `src/components/ErrorBoundary/ErrorBoundary.jsx`
- Error modal: `src/components/ErrorDetailsModal/ErrorDetailsModal.jsx` shows detailed error info
- Toast notifications: `src/hooks/useToast.js` for error/warning/success messages

## CI/CD & Deployment

**Hosting:**
- Monday.com (iframe-based app inside board view)
- Built artifacts deployed via Monday mapps CLI

**CI Pipeline:**
- None detected (no GitHub Actions, GitLab CI, etc.)
- Manual deployment: `pnpm deploy` runs build + push locally

**Deployment Process:**
- Local: `vite build` → outputs to `build/` directory
- Push: `mapps code:push --client-side -d "build"`
- Monday app identifier in `.env`: `ZIP` URL and `TUNNEL_SUBDOMAIN`

## Environment Configuration

**Required env vars:**
- `PORT` - Dev server port (default 8301)
- `TUNNEL_SUBDOMAIN` - Monday tunnel identifier (e.g., "board-view-10684862")
- `ZIP` - Monday CDN URL for app bundle
- `BROWSER` - Set to "none" to prevent auto-opening browser

**Secrets location:**
- `.env` file (not committed to git; see `.gitignore`)
- Monday SDK auth: Implicit in iframe context (no explicit secrets needed)

**Runtime Configuration:**
- Monday storage for app settings (column IDs, board IDs, feature toggles)
- Settings validation in `src/components/SettingsDialog/useSettingsValidation.js`

## Webhooks & Callbacks

**Incoming:**
- None detected. App only polls/queries Monday API on user action (not webhook-driven).

**Outgoing:**
- None detected. App does not send webhooks to external services.

**Real-time Updates:**
- Not implemented. Calendar refreshes on:
  - Week navigation
  - Manual event CRUD operations
  - Settings changes (triggers full board reload)

## Monday.com Column Type Mapping

The app maps settings to Monday board column types as follows:

| Setting Key | Column Type | Purpose |
|------------|-------------|---------|
| `dateColumnId` | date | Event date + time |
| `durationColumnId` | numbers | Hours (timed) or days (all-day) |
| `projectColumnId` | board_relation | Link to projects board |
| `taskColumnId` | board_relation | Link to tasks board (optional) |
| `reporterColumnId` | people | User who reported |
| `eventTypeStatusColumnId` | status | Event type: שעתי/לא לחיוב/חופשה/מחלה/מילואים |
| `nonBillableStatusColumnId` | status | Non-billable sub-types |
| `stageColumnId` | status | Stage/classification (optional) |
| `notesColumnId` | text | Free-text notes (optional) |

All column IDs are configurable via SettingsDialog to match customer board schemas.

## API Patterns & Limitations

**GraphQL Queries:**
- All API calls use Monday GraphQL (not REST)
- Pagination: `items_page` with cursor-based pagination (100 items per page)
- Batch operations: Not used; single mutations per CRUD operation
- Variables: Passed as second argument to `monday.api(query, { variables })`

**Common Query Pattern:**
```javascript
const response = await monday.api(query, { variables });
// Response structure: { data: { ... }, errors: [{ message, extensions: { code } }] }
```

**Error Handling:**
- Monday API errors wrapped in `MondayApiError` with full request/response context
- Errors include: API response, query, variables, function name, duration
- Clients use `catch` blocks to show user-friendly Hebrew error messages via toast

---

*Integration audit: 2026-01-25*
