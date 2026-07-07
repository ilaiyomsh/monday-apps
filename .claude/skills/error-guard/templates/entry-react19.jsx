/**
 * Entry point template — React 19 (createRoot with root error options).
 *
 * Ordering is load-bearing. Three layers cover the full error surface:
 *   1. setupGlobalErrorHandlers() — window.onerror + unhandledrejection + resource
 *      errors. Installed BEFORE createRoot so an error thrown during the very first
 *      render (or by module side-effects) is already captured.
 *   2. createRoot(container, { onUncaughtError, onCaughtError }) — the React 19
 *      root-level hooks. onUncaughtError fires for render errors NOT caught by any
 *      boundary; onCaughtError fires for render errors a boundary DID catch. Both
 *      route the React error + errorInfo (componentStack) into the logger without
 *      patching console.error.
 *   3. <AppErrorBoundary scope="root"> ABOVE all providers — the user-facing
 *      fallback screen for render throws (chunk-load vs render). It sits above the
 *      providers so a throw inside a provider still renders the fallback, not a
 *      blank screen.
 *
 * Async / event-handler errors are NOT render errors: they are covered by layer 1
 * (global handlers) and by routing catches through useAppErrorFunnel().showBoundary.
 *
 * Peer dep: `pnpm add react-error-boundary`.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import logger from './utils/logger';
import { setupGlobalErrorHandlers } from './utils/globalErrorHandler';
import { AppErrorBoundary } from './components/ErrorBoundary/AppErrorBoundary';
// import App from './App';
// import { SettingsProvider } from './contexts/SettingsContext';
// ...other providers

// 1. Global handlers FIRST — before any React render can throw.
setupGlobalErrorHandlers();

const container = document.getElementById('root');

// 2. Root with React 19 error options. errorInfo carries { componentStack }
//    (onCaughtError also carries the boundary that caught it).
const root = createRoot(container, {
    onUncaughtError: (error, errorInfo) => {
        logger.error('ReactRoot', 'Uncaught render error', error);
        logger.debug('ReactRoot', 'Uncaught component stack', {
            componentStack: errorInfo?.componentStack,
        });
    },
    onCaughtError: (error, errorInfo) => {
        // Module MUST be 'ErrorBoundary'-prefixed: in React 19 this hook fires
        // BEFORE react-error-boundary's onError, so this record is the canonical
        // (non-duplicate) one — the UI sink filters it by that prefix to keep
        // the one-error-one-surface contract (fallback screen, no extra toast).
        logger.error('ErrorBoundary:ReactRoot', 'Caught render error', error);
        logger.debug('ReactRoot', 'Caught component stack', {
            componentStack: errorInfo?.componentStack,
        });
    },
});

// 3. Root boundary ABOVE all providers.
root.render(
    <AppErrorBoundary scope="root">
        {/* --- providers go here (SettingsProvider, MondayContextProvider, ...) --- */}
        {/* --- <App /> goes here --- */}
    </AppErrorBoundary>
);
