# Monday.com App Loading Flow

## Problem

When a Monday.com app loads inside an iframe, several things can go wrong:

1. **SDK race condition** — `monday.storage` calls can fail or return empty if the SDK isn't fully initialized yet
2. **Infinite spinner** — if any SDK call hangs, the user is stuck with no way out
3. **Silent crashes** — corrupted storage JSON, malformed context responses, or network timeouts crash the app with no error UI
4. **Unnecessary API calls** — admin users don't need board ownership checks, but the app was calling `getBoardOwners` for everyone
5. **Retry hacks** — a 2-second delay + duplicate `monday.get('context')` readiness check was used to work around the race condition

## Solution: Sequential Loading with Timeouts

### Key Insight

The SDK race condition exists because `monday.storage` and `monday.get('context')` were called in parallel. If `monday.get('context')` succeeds, the SDK is proven ready — so loading context first **guarantees** storage will work, eliminating the need for retries entirely.

### Architecture

```
App mounts
  │
  ├─ MondayContextProvider (single instance, shared by all consumers)
  │
  ├─ Phase 1: monday.get('context') [10s timeout]
  │    → Validates ctx.user exists
  │    → If admin: skip getBoardOwners (unnecessary)
  │    → If non-admin: getBoardOwners [5s timeout]
  │    → Sets context + permissions
  │
  ├─ LOADING GATE: spinner until context is ready
  │
  ├─ Phase 2: SettingsProvider mounts (SDK guaranteed ready)
  │    → storage.getItem [5s timeout]
  │    → Single attempt, no retry needed
  │    → JSON.parse wrapped in try/catch
  │    → Empty response = new install (immediate, no delay)
  │
  ├─ ERROR? → Hebrew error screen with retry button
  │
  └─ Phase 3: Normal app (ActiveProjects → GanttProvider)
```

### Component Hierarchy

```
App
  └─ MondayContextProvider          ← runs useMondayContext once
       └─ AppContent
            ├─ IF contextLoading → spinner
            ├─ IF contextError → error UI + retry
            └─ ELSE → SettingsProvider  ← mounts only when SDK is ready
                 └─ ActiveProjectsProvider
                      └─ ConfiguredContent
                           ├─ IF settingsLoading → spinner
                           ├─ IF settingsError → error UI + retry
                           └─ ELSE → GanttProvider (app ready)
```

## Implementation

### Files

| File | Role |
|------|------|
| `src/utils/sdkUtils.ts` | `withTimeout()` utility — races a promise against a deadline |
| `src/hooks/useMondayContext.ts` | Fetches context + calculates permissions (internal hook) |
| `src/contexts/MondayContext.tsx` | Provider + `useMondayContext()` consumer hook |
| `src/hooks/useMondaySettings.ts` | Loads/saves settings from Monday instance storage |
| `src/contexts/SettingsContext.tsx` | Provider exposing settings + `refresh()` |
| `src/App.tsx` | Orchestrates sequential loading with error boundaries |

### withTimeout Utility

```ts
// src/utils/sdkUtils.ts
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}
```

Usage:
```ts
const response = await withTimeout(monday.get('context'), 10_000, 'monday.get(context)');
const settings = await withTimeout(storage.getItem(key), 5_000, 'storage.getItem');
```

### Context Provider Pattern

The context hook runs **once** at the provider level. All components share the same instance — no duplicate API calls:

```tsx
// src/contexts/MondayContext.tsx
export const MondayContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const value = useMondayContextInternal(); // runs once
  return <MondayCtx.Provider value={value}>{children}</MondayCtx.Provider>;
};

export const useMondayContext = () => {
  const ctx = useContext(MondayCtx);
  if (!ctx) throw new Error('useMondayContext must be used within MondayContextProvider');
  return ctx;
};
```

### Admin Optimization

Admins always have full permissions — no need to query board owners:

```ts
if (user.isAdmin) {
  return {
    canEditSettings: !user.isViewOnly,
    canViewData: !user.isGuest,
    canModifyAllocations: !user.isViewOnly && !user.isGuest,
    isBoardOwner: false,
  };
}
// Only non-admins reach getBoardOwners
```

### Settings — No Retry Needed

Before (with race condition workaround):
```
Attempt 1 → empty → wait 2s → monday.get('context') readiness check → Attempt 2
```

After (SDK guaranteed ready):
```
Single attempt → value found → done
Single attempt → empty → treat as new install immediately
```

### Error UI

Both context and settings errors show a Hebrew error screen with a retry button:

```tsx
const ErrorScreen = ({ message, onRetry }) => (
  <div>
    <h2>שגיאה בטעינת האפליקציה</h2>
    <p>{message}</p>
    <button onClick={onRetry}>נסה שוב</button>
  </div>
);
```

## Production Logging

All loading steps are logged with `[LOAD_FLOW]` prefix and `performance.now()` timing:

```
[LOAD_FLOW] ========== APP LOAD START ==========
[LOAD_FLOW] [1/5] Fetching monday context (10s timeout)...
[LOAD_FLOW] [1/5] Context received in 1ms — user: 48274917, board: 184016..., admin: true
[LOAD_FLOW] [2/5] Calculating permissions...
[LOAD_FLOW] [2/5] User is admin — skipping getBoardOwners
[LOAD_FLOW] [2/5] Context phase DONE in 1ms
[LOAD_FLOW] Context ready — mounting SettingsProvider (SDK guaranteed ready)
[LOAD_FLOW] [3/5] Loading settings from storage (5s timeout)...
[LOAD_FLOW] [3/5] Storage responded in 244ms
[LOAD_FLOW] [3/5] Settings found, version: 8d816
[LOAD_FLOW] [3/5] Settings parsed OK — 34 fields, configured: allocBoard=true, empBoard=true
[LOAD_FLOW] [3/5] Settings phase DONE in 245ms
[LOAD_FLOW] [4/5] Settings ready — isConfigured: true
[LOAD_FLOW] [5/5] Mounting GanttProvider — app fully loaded
```

Filter in Monday logs: `mapps code:logs -i <APP_ID> -s live -t console -r "LOAD_FLOW"`

## Timeout Reference

| Operation | Timeout | Why |
|-----------|---------|-----|
| `monday.get('context')` | 10s | First SDK call, may need iframe handshake |
| `getBoardOwners` | 5s | GraphQL API call, only for non-admins |
| `storage.getItem` | 5s | Instance storage, SDK already proven ready |

## What Was Removed

- 2-second retry delay in settings loading
- Duplicate `monday.get('context')` SDK readiness check
- `monday.listen('context')` listener (unnecessary)
- Duplicate `useMondayContext()` hook instances (now shared via provider)
