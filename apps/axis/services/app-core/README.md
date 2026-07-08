# @axis/app-core

Shared startup + infrastructure for Axis monday.com apps (standard **#17**). Extracted from the patterns in `tracker` and `Planner`. Every app imports this instead of re-implementing its bootstrap, contexts, logging, and error handling.

## What it provides
- **Startup** — `bootstrapApp()` / `polyfillGlobal()` (window.global polyfill → global error handlers → render).
- **MondayContext** — `MondayProvider` + `useMondayContext`: loads SDK context with a watchdog, derives `language`/`dir`/`locale`, `isMobile`, and **permissions** (admin / board-owner via an injected `getBoardOwners`).
- **Settings module** — `createSettings<T>()` factory → `{ SettingsProvider, useSettings }`. GLOBAL `monday.storage` keyed by `instanceId` (Axis convention, **not** instance storage), with retry/backoff, silent-reload guard, migrations, validation, and optimistic updates.
- **Settings dialog shell** — `SettingsDialogShell<T>`: generic tabbed dialog (draft-until-save, per-tab error dots, JSON export/import). i18n- and UI-lib-agnostic — the app supplies tab content, validation, and labels. See `SettingsTabDef<T>` / `SettingsTabRenderCtx<T>`.
- **Logging** — `createLogger()`: leveled, ring buffer, log-once dedup (`__loggedId`), pluggable sinks, `window.AppLogger` control, and an optional **Axiom** fetch transport (standard #5).
- **Error pipeline** — `ErrorBoundary`, `setupGlobalErrorHandlers`, `useErrorHandler` (Tracker model, standard #6).
- **API queue** — `createApiQueue()`: sequential mutations + bounded-concurrency reads with backoff retries (from Planner).

## Install
```jsonc
// app package.json — use link: (live symlink) for local dev, so edits to the
// package reflect immediately. file: copies into pnpm's store and would require
// `pnpm install` after every package edit.
"dependencies": { "@axis/app-core": "link:../Services/axis-app-core" }
```
Peer deps: `react >=19`, `react-dom >=19`, `monday-sdk-js >=0.5.7`. Consumed as TypeScript source (the app's bundler transpiles it).

## Wire-up
```ts
// core.ts — app singletons
import mondaySdk from 'monday-sdk-js';
import { polyfillGlobal, createLogger, createSettings } from '@axis/app-core';
import { DEFAULT_SETTINGS, type MySettings } from './types';

polyfillGlobal();
export const monday = mondaySdk();
export const logger = createLogger({ app: 'my-app', axiom: /* {dataset, token} | undefined */ });
export const { SettingsProvider, useSettings } = createSettings<MySettings>({
  storageKeyPrefix: 'customSettings_',
  defaults: DEFAULT_SETTINGS,
});
```
```tsx
// main.tsx
import './i18n';
import { bootstrapApp } from '@axis/app-core';
import { logger } from './core';
import App from './App';
bootstrapApp({ logger, children: <App /> });
```
```tsx
// App.tsx
import { ErrorBoundary, MondayProvider } from '@axis/app-core';
import { monday, logger, SettingsProvider } from './core';

<ErrorBoundary logger={logger}>
  <MondayProvider monday={monday} logger={logger} getBoardOwners={/* optional */}>
    <SettingsProvider monday={monday} logger={logger}>
      <AppContent />
    </SettingsProvider>
  </MondayProvider>
</ErrorBoundary>
```

## Settings dialog
```tsx
import { SettingsDialogShell, type SettingsTabRenderCtx } from '@axis/app-core';
import { useSettings } from './core';

<SettingsDialogShell<MySettings>
  isOpen={open} onClose={close} title={t('settings.title')}
  settings={settings} onSave={(next) => updateSettings(next)}
  validate={(d): Record<string,string> => (d.boardId ? {} : { boardId: 'app.notConfigured' })}
  labels={{ save: t('common.save'), cancel: t('common.cancel') }}
  allowExportImport
  tabs={[{
    id: 'general', label: t('settings.tabs.general'), fields: ['boardId'],
    render: ({ draft, setField, errors }: SettingsTabRenderCtx<MySettings>) => (/* fields */),
  }]}
/>
```

## Standard storage decision
Settings live in **global `monday.storage`** under `${storageKeyPrefix}${instanceId}`, where `instanceId = context.instanceId || boardId || 'default'`. This is the confirmed Axis convention. Planner (currently `monday.storage.instance` + a fixed key) migrates to this with a one-time read of the old key.

## Consumers
- **Day-off** — wired end-to-end (startup, MondayContext, settings, logger, error pipeline, dialog shell). See `apps/Axis/Day-off/src/core.ts`.
- **Tracker** — consumes the **storage primitives only** (`resolveInstanceId`, `withTimeout`, `ATTEMPT_TIMEOUT_MS` in `SettingsContext`). Tracker's logger, error pipeline, MondayContext, and bootstrap stay local **by design** — an audit + adversarial review found their record/listener shapes are test-locked (≈855 tests) and this package cannot reproduce them without behavior change. Wired via a Vite alias to the TS source + `resolve.dedupe: ['react','react-dom']`. See `apps/Axis/tracker/CLAUDE.md` §8 “@axis/app-core consumption”.
- **Planner** — not yet migrated (requires the `monday.storage.instance` → global storage-key migration).

### Migrating a mature app onto this package
Tracker is the reference: delegate only the pieces that are **byte-identical** to what the app already does (plain non-React helpers are safest — no dual-React risk). For anything with consumer/test coupling, either keep it local or first enrich this package to an **exact superset**, then re-run the app's full test suite as the gate. Never swap an infra module whose return-shape/record-shape a test asserts.
