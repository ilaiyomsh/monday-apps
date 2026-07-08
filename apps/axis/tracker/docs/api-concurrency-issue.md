# API Concurrency Limit Issue (429)

## Error
```
Concurrency limit exceeded for the field
status_code: 429, retry_in_seconds: 15
entity: boards → items_page
```

## What's happening

On calendar mount, multiple hooks fire `items_page` queries simultaneously:
- `useMondayEvents.loadEvents`
- `useProjects` → `fetchActiveAssignments`
- `useFilterOptions` → reporters fetch
- Possibly `useMonthlyHours`, `useBoardOwner`

Monday.com enforces a per-field concurrency limit on `boards.items_page`. When 2+ requests are in-flight at the same time, the later ones get rejected with 429.

## Impact
- `fetchActiveAssignments` fails → projects dropdown empty
- No retry → user must refresh

## Root cause
No request serialization or retry logic. All hooks independently fire API calls on mount without coordinating.

## Possible fixes
1. **Request queue** — serialize API calls through a shared queue so only 1-2 `items_page` calls are in-flight at a time
2. **Retry with backoff** — on 429, wait `retry_in_seconds` (15s) and retry
3. **Stagger startup** — prioritize calendar events first, then load projects/filters after
4. **Combine queries** — batch multiple board reads into a single GraphQL query where possible

## Pre-existing
This is not related to the dashboard feature. Stack traces point to `useProjects.js` and `fetchActiveAssignments` during calendar startup.
