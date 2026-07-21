import React, { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from '@mapps/error-kit/react';
import { errorKitLogger } from '../../utils/errorReporting';

/**
 * Error-display components + a lazy-chunk boundary, all backed by the shared
 * @mapps/error-kit ErrorBoundary (which logs render-time throws + componentStack through the
 * app logger → Axiom). Styled to match the app's existing ErrorScreen (danger circle + Twyst
 * button treatment) so a caught crash never shows a raw white screen.
 */

const DangerIcon: React.FC = () => (
  <div className="w-16 h-16 bg-danger-soft rounded-full flex items-center justify-center">
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-danger-strong)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  </div>
);

/**
 * Full-screen fallback for the ROOT boundary — a render crash anywhere in the tree lands
 * here instead of a blank iframe. Text is inline Hebrew (the boundary renders ABOVE i18n /
 * every provider, so `t()` is not guaranteed to be available).
 */
export const RootErrorFallback: React.FC = () => (
  <div className="w-full h-screen flex items-center justify-center bg-bg-app" dir="rtl">
    <div className="flex flex-col items-center gap-4 text-center px-6">
      <DangerIcon />
      <h2 className="text-xl font-bold text-text-primary">אירעה שגיאה בלתי צפויה</h2>
      <p className="text-text-muted max-w-md">האפליקציה נתקלה בבעיה. רענון הדף יטען אותה מחדש.</p>
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition-colors"
      >
        רענון
      </button>
    </div>
  </div>
);

/**
 * Compact fallback for a failed lazy() chunk load — a dynamic import can fail after a
 * redeploy invalidates a hashed chunk, or on a flaky network. Prompts a reload rather than
 * blanking the surface the modal/dialog was meant to fill.
 */
export const ChunkErrorFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center gap-3 p-8 text-center" dir="rtl">
    <DangerIcon />
    <p className="text-text-muted max-w-xs">טעינת הרכיב נכשלה. יש לרענן את הדף ולנסות שוב.</p>
    <button
      onClick={() => window.location.reload()}
      className="px-5 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition-colors"
    >
      רענון
    </button>
  </div>
);

/**
 * Wraps a lazy()-loaded subtree in an ErrorBoundary (so a chunk-load failure shows
 * ChunkErrorFallback instead of crashing the whole app) AND a Suspense (loading fallback).
 * Use around every lazy() mount site.
 */
export const LazyBoundary: React.FC<{ children: ReactNode; suspenseFallback?: ReactNode }> = ({
  children,
  suspenseFallback = null,
}) => (
  <ErrorBoundary logger={errorKitLogger} fallback={<ChunkErrorFallback />}>
    <Suspense fallback={suspenseFallback}>{children}</Suspense>
  </ErrorBoundary>
);

export default LazyBoundary;
