import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/feedback/ErrorBoundary';
import { versionLabel } from './lib/versionLabel';
import logger from './lib/logger';
import monday from './services/monday';
import { setupGlobalErrorHandlers } from './utils/globalErrorHandler';
import { attachAxiomSink, setAxiomContext, isAxiomSinkActive } from './utils/axiomErrorSink';
import '@vibe/core/tokens';
import './styles/index.css';

// Dev/mock harness — self-guarded; only installs when VITE_MOCK=1.
// Must be imported BEFORE any code that calls fetch('/api/...') so the
// interceptor is already in place by the time React effects fire.
import './_mock/install';

// Global error nets FIRST — installed before render so uncaught errors and
// unhandled rejections that fire during boot are captured by the logger.
setupGlobalErrorHandlers(logger);

// Axiom remote sink — registered synchronously BEFORE createRoot().render so the
// ring buffer at this instant holds only import-time records (no double-ship).
// Structurally inert (no-op) unless the activation gate passes: a production build
// with VITE_AXIOM_DATASET + VITE_AXIOM_TOKEN + VITE_AXIOM_APP baked in (dev / tunnel /
// tests never ship). App version rides the build-time __APP_VERSION__ constant.
attachAxiomSink(logger, {
  app: import.meta.env.VITE_AXIOM_APP ?? '',
  dataset: import.meta.env.VITE_AXIOM_DATASET,
  token: import.meta.env.VITE_AXIOM_TOKEN,
  appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
  environment: import.meta.env.VITE_AXIOM_ENV ?? 'production',
});

// Merge the monday account/user identity into every future Axiom envelope, so a shipped
// render/API error carries acc/usr (identity enrichment — error-axiom standard). Gated on
// the live sink so it never costs an API round-trip in dev / tunnel / tests.
if (isAxiomSinkActive()) {
  monday
    .get('context')
    .then((res: unknown) => {
      const data = (res as { data?: { account_id?: string | number; user_id?: string | number } }).data;
      setAxiomContext({ accountId: data?.account_id, userId: data?.user_id });
    })
    .catch((err: unknown) => {
      logger.error('admin', 'axiom_context_failed', err);
    });
}

console.info('[sync-calender-admin] ' + versionLabel);

if (!document.body.classList.contains('light-app-theme')
 && !document.body.classList.contains('dark-app-theme')
 && !document.body.classList.contains('black-app-theme')
 && !document.body.classList.contains('hacker-theme-app-theme')) {
  document.body.classList.add('light-app-theme');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
