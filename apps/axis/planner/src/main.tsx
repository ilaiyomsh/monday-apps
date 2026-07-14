import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "@vibe/core/tokens";
import './index.css'
import './i18n';
import App from './App.tsx'

// Initialize logger (exposes window.AppLogger)
import './utils/Logger'
import { versionLabel } from './utils/versionLabel'

console.info('[planner] ' + versionLabel)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
