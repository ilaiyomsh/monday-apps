import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@mapps/error-kit/react'
import "@vibe/core/tokens";
import './index.css'
import './i18n';
import App from './App.tsx'

// Initialize logger (exposes window.AppLogger)
import './utils/Logger'
// Install global error handlers (uncaught errors + unhandled rejections + resource failures)
// and attach the Axiom remote sink synchronously BEFORE first render — the ring-buffer replay
// captures only import-time records with no async gap. Both funnel through the shared
// @mapps/error-kit browser layer; the sink is inert unless the PROD gate + VITE_AXIOM_* env
// are baked into the bundle (a structural no-op in dev/vitest).
import { initErrorReporting, errorKitLogger } from './utils/errorReporting'
import { RootErrorFallback } from './components/ui/LazyBoundary'
import { versionLabel } from './utils/versionLabel'

initErrorReporting()

console.info('[planner] ' + versionLabel)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Root boundary ABOVE all providers — a render-time throw anywhere shows a fallback
        (and ships with componentStack) instead of a blank iframe. */}
    <ErrorBoundary logger={errorKitLogger} fallback={<RootErrorFallback />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
