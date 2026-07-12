# Dev harness — run the app OUTSIDE the monday iframe

This folder is copied verbatim into scaffolded apps as `src/dev-harness/`.
It stubs `monday-sdk-js` with realistic fixtures so:

- `pnpm dev:mock` renders the app in a plain browser tab — no tunnel, no
  deploy, no monday iframe. CSS/RTL/layout work costs seconds, not a
  build + force-deploy round-trip.
- `vitest` runs against the same realistic SDK shapes instead of hand-built
  mocks that drift from production (green tests + live GraphQL errors).

## Files

| File | Purpose |
|------|---------|
| `monday-sdk-stub.js` | Drop-in `monday-sdk-js` replacement: `get` / `listen` / `execute` / `api` / `storage` / `set*` with real response envelopes, plus a `harness` control object |
| `fixtures.js` | Context fixtures per feature type, account users, GraphQL response fixtures, theme list, role presets |

## Vite wiring (already in the scaffolded `vite.config.js`)

```js
import { fileURLToPath } from 'node:url';

const mockSdkPath = fileURLToPath(new URL('./src/dev-harness/monday-sdk-stub.js', import.meta.url));

export default defineConfig({
  resolve: {
    // pnpm dev:mock sets VITE_MONDAY_MOCK=1 → the whole app transparently
    // uses the stub. Unset (tunnel/prod builds) → the real SDK.
    alias: process.env.VITE_MONDAY_MOCK ? { 'monday-sdk-js': mockSdkPath } : {},
  },
  test: {
    // vitest ALWAYS uses the stub (tests must never hit the live API).
    alias: { 'monday-sdk-js': mockSdkPath },
    environment: 'jsdom',
  },
});
```

```jsonc
// package.json
"dev:mock": "VITE_MONDAY_MOCK=1 vite --port <DEV_PORT>"
```

## Choosing the context fixture

The stub boots with the `board_view` context. Set
`VITE_MONDAY_MOCK_CONTEXT=item_view|dashboard_widget|column_view_click|column_view_settings`
(env var, e.g. in the `dev:mock` script) to boot with a different feature-type
context — `column_view_settings` deliberately has **no `itemId`**, like
production.

## Controlling the harness from tests

```js
import mondaySdk, { harness } from 'monday-sdk-js'; // aliased to the stub in vitest

beforeEach(() => harness.reset());

test('settings survive the storage false-empty first read', async () => {
  harness.seedStorage('instance:my_settings_key', { configured: true });
  harness.failures.storageFalseEmptyFirstRead = true; // first read lies: success + null
  // ...mount the app / call the loader...
  // assert the app does NOT treat the instance as unconfigured.
});

test('shows an error toast on GraphQL failure', async () => {
  harness.failures.apiErrorNext = true; // next api() RESOLVES with { errors } — like live
  // ...
});
```

Harness surface:

- `harness.setTheme('light'|'dark'|'night'|'black')` — emits a context event.
- `harness.setUser('admin'|'member'|'viewer'|'guest')` — role flag variations.
- `harness.setContext(patch)` / `harness.setSettings(patch)` — emit to listeners.
- `harness.seedStorage(key, value)` — keys are scope-prefixed:
  `instance:<key>` / `global:<key>`.
- `harness.failures.*` — see the toggle list at the top of `monday-sdk-stub.js`.
- `harness.calls` — every `monday.execute(...)` recorded for assertions.
- `harness.apiHandlers.push({ match: 'my_mutation', data: {...} })` — add
  query-specific responses; unmatched queries return a loud GraphQL error
  telling you to add a fixture (never a silent empty success).

## Failure modes worth testing on purpose

1. **Storage false-empty first read** (`storageFalseEmptyFirstRead`) — the real
   monday.storage race: a configured instance transiently reads back
   `success:true, value:null`. Code that treats the first null as "new install"
   ships the onboarding wizard to configured users.
2. **GraphQL soft-error** (`apiErrorNext`) — `monday.api` resolves (does not
   reject) with `{ errors }`. A missed check here is a silent write failure
   that looks like success.
3. **Hard/network failure** (`apiRejectNext`) — the promise rejects.
4. **Theme variations** — render in all four themes; monday users do use dark.
5. **Role variations** — viewer/guest must not see owner-only affordances.
