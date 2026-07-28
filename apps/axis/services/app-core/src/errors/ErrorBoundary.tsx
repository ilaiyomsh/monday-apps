/**
 * ErrorBoundary.tsx — FACADE SHIM.
 *
 * The render-error boundary now lives in `@mapps/error-kit` (packages/error-kit,
 * exported from `@mapps/error-kit/react`). This file is a thin re-export so the app-core
 * barrel and its consumers (day-off's `<ErrorBoundary logger={logger}>`) keep the same
 * path + props. Consumers inherit error-kit's fix 4: the componentStack now rides the
 * single ERROR record (context.componentStack) that already ships, instead of a separate
 * DEBUG record that never shipped — so it surfaces as `component_stack` in Axiom.
 */
export { ErrorBoundary } from '@mapps/error-kit/react';
