import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGantt } from '../../hooks/useGantt';

/**
 * Non-blocking banner shown when fetchAllocations fails after apiQueue's
 * transient-error retries are exhausted. Sits above the Gantt header, lets the
 * user keep interacting with whatever data is on screen. Dismissable; reappears
 * when a new error arrives (tracked by error message identity).
 */
export const AllocationsErrorBanner: React.FC = () => {
  const { t } = useTranslation();
  const { allocationsError, allocationsErrorKind, refreshAllocations } = useGantt();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const lastErrorRef = useRef<string | null>(null);

  // Reset dismissal once the underlying error changes — a fresh failure should
  // re-surface the banner even if the user dismissed the previous one.
  useEffect(() => {
    if (allocationsError !== lastErrorRef.current) {
      lastErrorRef.current = allocationsError;
      if (allocationsError && allocationsError !== dismissedFor) {
        setDismissedFor(null);
      }
    }
  }, [allocationsError, dismissedFor]);

  if (allocationsErrorKind !== 'network') return null;
  if (allocationsError && allocationsError === dismissedFor) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await refreshAllocations();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2 bg-warning-soft border-b border-warning-border text-warning-text text-sm flex-shrink-0"
      dir="ltr"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="flex-1 truncate">{t('gantt.error.network.message')}</span>
      <button
        onClick={() => window.location.reload()}
        className="px-3 py-1 text-xs font-semibold rounded bg-warning text-text-primary hover:bg-warning-hover transition-colors"
      >
        {t('gantt.error.network.refresh')}
      </button>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="px-3 py-1 text-xs font-semibold rounded border border-warning-border text-warning-text hover:bg-warning-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {retrying ? t('common.loading') : t('gantt.error.network.retry')}
      </button>
      <button
        onClick={() => setDismissedFor(allocationsError)}
        aria-label={t('gantt.error.network.dismiss')}
        className="p-1 text-warning-text hover:opacity-70 transition-opacity"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};
