import React from 'react';
import { createRoot } from 'react-dom/client';
import '@vibe/core/tokens';
import './styles.css';
import { App } from './App';

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

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('admin view render error', error, info.componentStack);
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
