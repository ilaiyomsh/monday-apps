# ניהול דיונים (discussions)

A monday.com **client-side** board/feature app, originally exported from the monday Vibe
builder (`10387085`) and since rebuilt to follow the `Axis/tracker` app's architecture:
a single unified `src/`, the official **@vibe/core** design system, **i18next**, a
production observability stack, and a `monday-sdk-js` API layer wrapped in `safeApi` /
`MondayApiError`.

## Run

```bash
npm install
npm run dev        # local dev server (Vite) at http://localhost:5180
npm run build      # production build -> build/
npm test           # vitest (watch)   /  npm run test:run for CI
```

### Local data
- **Inside monday**: seamless session auth — no token needed.
- **Local dev**: add a personal token to `.env.local` as `VITE_MONDAY_TOKEN=...` to fetch
  live data. Without it the UI renders but data calls fail (expected) and surface as toasts.

## Stack

| Area | Choice |
|------|--------|
| Framework | React 19 |
| Build | Vite 8 (rolldown) → `build/` |
| UI kit | `@vibe/core` v4 + `@vibe/icons` v4 (monday Design System) + CSS Modules |
| i18n | `i18next` + `react-i18next` (he-first; `en` scaffold) |
| monday API | `monday-sdk-js` via `utils/mondayApi` (`safeApi` + `MondayApiError`) |
| Charts / DnD | `recharts`, `@dnd-kit` |
| Tests | `vitest` + `@testing-library/react` + jsdom |

## Layout

```
src/
  index.jsx              # entry: @vibe/core/tokens -> index.css -> init -> i18n ->
                         #   setupGlobalErrorHandlers() -> <ErrorBoundary><providers/><App/>
  init.js                # window.global polyfill
  index.css              # base reset + body styling from @vibe tokens
  App.jsx + App.module.css
  components/            # one folder per component: Component.jsx + Component.module.css + index.js
                         #   incl. ErrorBoundary, ErrorDetailsModal, Toast, NetworkErrorScreen
  hooks/                 # useDiscussions/useTasks/useTopics + useToast + useUiErrorSink
  contexts/              # MondayContext, SettingsContext (settings-driven board/column mapping)
  constants/             # deptConfig
  utils/                 # logger, errorHandler, globalErrorHandler, lazyRetry
    mondayApi/           # client (safeApi + MondayApiError), assertGraphQL, monday-client,
                         #   BoardSDK, boards.config, board-config-store
  i18n/                  # i18next init + locales/{he,en}
  styles/theme-tokens.css# --status-* / --dept-* color tokens (used by inline styles)
  test-utils/, setupTests.js
```

Path aliases (`vite.config.js`): `@generated`→`src`, `@components`→`src/components`,
`@api`→`src/utils/mondayApi`.

## Observability

Every failure funnels through `logger.emit` and surfaces through one path (the UI sink → toast):
- `utils/mondayApi/client.js` `safeApi` logs/wraps every SDK call (`logger.api/apiResponse/apiError`,
  retry on transient errors, `MondayApiError` with full request context).
- `hooks/useUiErrorSink` turns every `ERROR` log record into a Hebrew toast with a "details" action
  (`ErrorDetailsModal` — Error / API / JSON tabs).
- `ErrorBoundary` (root) catches render crashes; `globalErrorHandler` catches `window.onerror` /
  `unhandledrejection`; `NetworkErrorScreen` for boot-time storage failures.

### Settings
`SettingsContext` loads a per-instance settings object from `monday.storage` (falling back to the
defaults in `utils/mondayApi/boards.config.js`) and publishes the board/column mapping into the SDK
store before the app renders. A minimal in-product editor (`components/SettingsModal`, opened via the
floating gear button) edits the per-board id + each alias→real-column mapping and saves via
`updateSettings`.

## monday app / CLI (`mapps`)

| | |
|---|---|
| App name | ניהול דיונים |
| **Deployable app id** | `11457413` |
| Vibe builder id | `10387085` (the `/vibe/app/...` URL — not the deployable id) |
| Hosting | **client-side** (served from monday CDN) |

```bash
npm run dev            # local dev (:5180)
npm run tunnel         # expose :5180 to monday for in-product testing
npm run build          # build -> build/
npm run deploy         # build + mapps code:push --client-side -d build  (to 11457413)
npm run deploy:force   # force push build/
npm run app:versions   # list app versions
```

> This app is static client-side, so `code:logs` / `code:status` (monday-code server apps) do not apply.

## Roadmap
- **Settings UI** — a minimal mapping editor (`SettingsModal`) ships now; a fuller version like
  tracker's `SettingsDialog`/`SettingsWizard`/validation could follow.
- **i18n extraction** — UI strings are currently inline Hebrew; extract into `i18n/locales/*` over time.
- **In-monday verification** — exercise the @vibe/core UI (table edit, popovers, drag, date pick,
  settings save) inside monday via `npm run tunnel`.
