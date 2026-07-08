/**
 * Entry point template — React 18 (no root error options).
 *
 * Difference from the React 19 template: React 18's createRoot has NO
 * onUncaughtError / onCaughtError options — those are React 19 additions. So on
 * React 18 there is no root-level hook to route render errors into the logger.
 * The two remaining layers carry the whole load and are therefore mandatory
 * (not optional) on 18:
 *   1. setupGlobalErrorHandlers() — window.onerror + unhandledrejection + resource
 *      errors. Installed BEFORE createRoot so early throws are captured.
 *   2. <AppErrorBoundary scope="root"> ABOVE all providers — its onError is the
 *      ONLY place render throws get logged on React 18, and it renders the
 *      user-facing fallback (chunk-load vs render).
 *
 * Async / event-handler errors are covered by layer 1 (global handlers) and by
 * routing catches through useAppErrorFunnel().showBoundary — identical to 19.
 *
 * When you upgrade to React 19, pass { onUncaughtError, onCaughtError } to
 * createRoot (see entry-react19.jsx) to also capture render errors at the root.
 *
 * Peer dep: `pnpm add react-error-boundary`.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { setupGlobalErrorHandlers } from './utils/globalErrorHandler';
import { AppErrorBoundary } from './components/ErrorBoundary/AppErrorBoundary';
// import App from './App';
// import { SettingsProvider } from './contexts/SettingsContext';
// ...other providers

// 1. Global handlers FIRST — before any React render can throw.
setupGlobalErrorHandlers();

const container = document.getElementById('root');

// 2. React 18 createRoot takes no error options — the boundary + global handlers
//    are the entire safety net.
const root = createRoot(container);

// 3. Root boundary ABOVE all providers (its onError logs every render throw).
root.render(
    <AppErrorBoundary scope="root">
        {/* --- providers go here (SettingsProvider, MondayContextProvider, ...) --- */}
        {/* --- <App /> goes here --- */}
    </AppErrorBoundary>
);
