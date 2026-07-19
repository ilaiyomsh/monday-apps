import React from 'react';
import { createRoot } from 'react-dom/client';
import '@vibe/core/tokens';
import './styles.css';
import { App } from './App';
import logger from './utils/logger';
import { attachAxiomSink } from './utils/axiomErrorSink';

// Axiom logging v2: register the remote sink synchronously BEFORE createRoot().render —
// the ring buffer at this instant holds only import-time records (no double-ship). Inert
// (no-op) unless the VITE_AXIOM_* activation gate passed in a production build.
attachAxiomSink();

// Vibe tripwire (see sync-calender CLAUDE.md): components render unstyled
// without a body app-theme class — set it synchronously before createRoot.
if (!/(^|\s)(light|dark|black|hacker-theme)-app-theme(\s|$)/.test(document.body.className)) {
  document.body.classList.add('light-app-theme');
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Stable English event id as the message (ships as-is); the Error rides record.error
    // (scrubbed to err_msg by the sink). React's componentStack stays console-only.
    logger.error('admin', 'render_error', error);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="dc-page">
          <div className="dc-error">
            שגיאה בטעינת מסך ההגדרות. רעננו את העמוד; אם זה חוזר — פנו לתמיכה.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Boot health (D5): one-shot after the root mounts. INFO/alwaysShip → dedups at the
// transport; inert until the Axiom sink is active. version/sha are build-time constants.
logger.health('boot', { version: __APP_VERSION__, sha: __BUILD_SHA__.slice(0, 7) });
