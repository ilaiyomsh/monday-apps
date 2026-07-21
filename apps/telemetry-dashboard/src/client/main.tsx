import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { ThemeProvider } from './lib/theme';
import logger from './utils/logger';
import { attachAxiomSink } from './utils/axiomErrorSink';
import { setupGlobalErrorHandlers } from './utils/globalErrorHandler';

// Error-guard client wiring. Both run synchronously BEFORE createRoot().render:
// - global handlers catch uncaught errors / unhandled rejections (App.tsx's void load
//   floats a promise; a total fetch keeps it safe, but this is the runtime net if that
//   invariant ever breaks) and resource-load failures, funnelling them into the logger.
// - the Axiom sink is registered while the ring buffer holds only import-time records
//   (no double-ship). Inert (no-op) unless the VITE_AXIOM_* gate passed in a prod build.
setupGlobalErrorHandlers(logger);
attachAxiomSink();

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Ships: stable English event id as the message, the Error rides record.error
    // (scrubbed to err_msg + first stack frame by the sink). React's componentStack is
    // free-form and stays local (DEBUG — never shipped).
    logger.error('dashboard', 'render_error', error);
    logger.debug('dashboard', 'render_error_component_stack', { componentStack: info.componentStack });
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="notice">The dashboard failed to render. Refresh the page; if it persists, check the console.</div>
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
    <ThemeProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
