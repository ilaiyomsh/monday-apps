# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**Monday.com GraphQL API:**
- Service: monday-sdk-js (0.5.7)
- Client: `src/services/mondayService.ts`
- API Version: 2026-01
- Authentication: Built into monday-sdk-js (automatic iframe context)
- Query Types:
  - Fetch boards: `boards(limit: 500)` query
  - Fetch columns: `boards(ids:).columns` query
  - Fetch items: Full item data with column values
  - Fetch active projects: Items filtered by status column
  - Fetch workload items: Items by employee or role with date filters
  - Create items: `create_item` mutation
  - Update items: `update_item_values` mutation
  - Delete items: `delete_item` mutation
  - Update names: Item name mutations

**Monday.com AppSDK:**
- Service: @mondaycom/apps-sdk (3.2.1)
- Client: `src/hooks/useMondayContext.ts`
- Context retrieval: `monday.get('context')` returns board ID, instance ID, user info, theme
- User permissions: Admin, view-only, guest status detection

## Data Storage

**Primary Data Store:**
- Monday.com Boards - Three synchronized Monday boards:
  1. **Allocations Board** - Stores allocation records
     - Field mapping in `src/types/settings.types.ts` (PlannerSettings)
     - Columns: start date, end date, hours per day, total hours, project, employee, role
     - Access: `mondayService.fetchItems(settings.allocationsBoardId)`

  2. **Employees Board** - External board with employee master data
     - Columns: name, role, allocation percentage, cost, user ID
     - Read-only for allocation data
     - Access: `mondayService.fetchItems(settings.employeesBoardId)`

  3. **Projects Board** (optional) - External board for active projects
     - Columns: name, status
     - Used for filtering active projects
     - Access: `mondayService.fetchBoardsByIds(projectIds)`

**Settings Storage:**
- Monday Instance Storage: `monday.storage.instance`
- Key: `planner_app_settings` (defined in `src/hooks/useMondaySettings.ts`)
- Type: JSON stringified PlannerSettings object
- Scope: Per-board-instance, persistent across sessions
- Fallback: Mock data in development (localhost detection)

**File Storage:**
- Not detected - No file uploads or cloud storage integration

**Caching:**
- Not detected - Data loaded fresh on demand, no Redis/Memcached

## Authentication & Identity

**Auth Provider:**
- Monday.com Native (built into iframe)
- No OAuth or third-party auth

**User Identity:**
- Extracted from `monday.get('context')` response:
  - User ID
  - User name
  - Admin status
  - View-only flag
  - Guest flag
  - Current language
  - Board ownership determined via `getBoardOwners` API call

**Permission Model:**
- Defined in `src/hooks/useMondayContext.ts`
- canEditSettings: Admin OR board owner, NOT view-only
- canViewData: NOT guest
- canModifyAllocations: NOT view-only AND NOT guest
- isBoardOwner: Fetched from API or hardcoded for localhost (boardId 123456)

## Monitoring & Observability

**Error Tracking:**
- Not detected - No Sentry, DataDog, or similar

**Logs:**
- Browser console logs only
- API call logging: All `monday.api()` calls wrapped with console.log
- Location: `src/services/mondayService.ts`, `src/hooks/useMondayContext.ts`, `src/hooks/useMondaySettings.ts`

**Debugging:**
- Development detection: `window.location.hostname === 'localhost'` triggers mock data
- Mock boards: IDs starting with 'mock-' return sample data

## CI/CD & Deployment

**Hosting:**
- Monday.com apps platform
- Deployed via `mapps code:push` CLI

**Deployment Pipeline:**
- Scripts defined in `package.json`:
  - `pnpm deploy:build` - Vite build to dist/
  - `pnpm deploy:push` - Push dist/ to Monday.com (client-side only)
  - `pnpm deploy` - Combined build and push
- CLI: @mondaycom/apps-cli 4.10.5

**Development Server:**
- Vite dev server on port 8301
- Monday.com tunnel: `mapps tunnel:create -p 8301`
- Local development: `pnpm start` runs both concurrently
- Tunnel: Allows localhost app to be accessed via Monday.com iframe

**CI/CD Service:**
- Not detected - No GitHub Actions, CircleCI, or other CI/CD configuration

## Environment Configuration

**Required env vars:**
- None detected - All configuration through Monday Instance Storage
- Settings stored in `monday.storage.instance.setItem('planner_app_settings', JSON)`

**Settings Required for Operation:**
- Allocations board ID
- Employees board ID
- Column IDs for all required fields (dates, hours, employee, role, project)
- Work day hours (default 09:00-18:00)
- Effort display mode (default: hours_day)
- Work days array (default: Mon-Fri)

**Secrets location:**
- No API keys or secrets required
- Authentication implicit via Monday.com iframe context
- Development credentials: Hardcoded boardId 123456 and instanceId 789 for localhost

## Webhooks & Callbacks

**Incoming:**
- Not detected - No webhook endpoints in codebase

**Outgoing:**
- Not detected - No webhook dispatches to external services

**Monday.com Events:**
- No event subscriptions detected
- Data loading on-demand via API calls
- No real-time streaming (polling-based if needed)

## Data Transformation & Format

**GraphQL Queries:**
- All queries use GraphQL with variables
- Pagination: Uses `cursor`-based pagination for large datasets
- Items query supports filtering via `ItemsQueryRule` (column filters, operators)
- API responses structured as `{ data: ..., errors: [...] }`

**Data Transformers:**
- `src/utils/mondayTransformers.ts` - Converts Monday items to app entities
- Functions:
  - `transformMondayItemToAllocation()` - Item → Allocation
  - `transformMondayItemToEmployee()` - Item → Employee
  - `prepareAllocationMutationValues()` - Allocation → API column values
  - `transformToWorkloadItem()` - Item → Workload item for calculations

**Column Value Mapping:**
- Column types support: date, text, numbers, status, board_relation, people
- Settings store mapping: `{columnId: string}` for each field
- Transformers handle type conversion and extraction

## Related Files

**API Layer:**
- `src/services/mondayService.ts` - GraphQL API wrapper
- `src/services/allocationsApi.ts` - Business logic (CRUD operations)

**Hooks for Data:**
- `src/hooks/useAllocations.ts` - Allocation CRUD with optimistic updates
- `src/hooks/useMondayContext.ts` - Monday context and permissions
- `src/hooks/useMondaySettings.ts` - Settings persistence and defaults

**Contexts:**
- `src/contexts/SettingsContext.tsx` - Settings distribution
- `src/contexts/ActiveProjectsContext.tsx` - Active projects filtering

**Types:**
- `src/types/settings.types.ts` - PlannerSettings configuration structure
- `src/types/entities/` - Entity type definitions

---

*Integration audit: 2026-01-25*
