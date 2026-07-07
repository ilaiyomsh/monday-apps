import { useCallback, useState } from 'react';
import type { Logger } from '../logger';
import type { AppError } from '../types';

/**
 * Error handling hook (standard #6). `handleError` is the single surface point:
 * logs once (the logger dedups via __loggedId) and exposes the error for the UI.
 * The ESLint catch-block rule accepts a `handleError(...)` call as valid handling.
 */
export function useErrorHandler(logger: Logger) {
  const [error, setError] = useState<AppError | null>(null);

  const handleError = useCallback(
    (err: unknown, ctx?: { operation?: string }) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(ctx?.operation ?? 'app', message, err);
      setError({ message, details: err });
    },
    [logger],
  );

  const clearError = useCallback(() => setError(null), []);

  return { error, handleError, clearError };
}
