import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Wraps react-i18next's `t()` and returns a stable reference per language,
 * so it can be listed in useEffect/useCallback/useMemo dependency arrays
 * without triggering exhaustive-deps churn. Identity changes only when the
 * language changes (which re-renders consumers anyway).
 *
 * Usage: `const t = useStableT();` instead of `const { t } = useTranslation();`
 */
export function useStableT() {
  const { t } = useTranslation();
  return useCallback((...args) => t(...args), [t]);
}
