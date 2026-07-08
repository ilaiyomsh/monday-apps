import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/feedback/ErrorBoundary';
import '@vibe/core/tokens';
import './styles/index.css';

// Dev/mock harness — self-guarded; only installs when VITE_MOCK=1.
// Must be imported BEFORE any code that calls fetch('/api/...') so the
// interceptor is already in place by the time React effects fire.
import './_mock/install';

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
