import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "@vibe/core/tokens";
import './index.css'
import './i18n';
import App from './App.tsx'

// Initialize logger (exposes window.AppLogger)
import './utils/Logger'
// Attach the Axiom remote sink synchronously BEFORE first render (replays import-time
// ERROR/WARN records, then registers for live fan-out). Inert unless the PROD activation
// gate + VITE_AXIOM_* env are baked into the bundle — a structural no-op in dev/vitest.
import { attachAxiomSink } from './utils/axiomErrorSink'
import { versionLabel } from './utils/versionLabel'

attachAxiomSink()

console.info('[planner] ' + versionLabel)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
