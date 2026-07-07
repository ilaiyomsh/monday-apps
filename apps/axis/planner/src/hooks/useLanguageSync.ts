import { useEffect, useState } from 'react';
import i18n, { resolveLanguage, isSupportedLanguage } from '../i18n';
import { useMondayContext } from '../contexts/MondayContext';
import { useSettings } from '../contexts/SettingsContext';
import { logger } from '../utils/Logger';

/**
 * Syncs i18next's active language with `settings.languageOverride` and
 * `mondayContext.user.currentLanguage`. The hook is a no-op once both inputs
 * are stable; it only triggers `i18n.changeLanguage` when the resolved target
 * differs from the current `i18n.language`.
 *
 * Returns `{ isResolved }`: false on first render before the resolved target
 * has been pinned (or while `changeLanguage` is in flight); true once the
 * active language matches the resolved target. Callers can gate first-paint
 * UI on this to prevent a flash of the default Hebrew bundle for English
 * users.
 *
 * Call this from a component that lives inside SettingsProvider +
 * MondayContextProvider — `App` is the natural place.
 */
export const useLanguageSync = (): { isResolved: boolean } => {
  const { context } = useMondayContext();
  const { settings } = useSettings();
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    const override = settings?.languageOverride ?? null;

    let target: 'he' | 'en';
    try {
      target = resolveLanguage({
        override,
        contextLanguage: context?.user?.currentLanguage ?? null,
      });
    } catch (err) {
      // `resolveLanguage` throws on a malformed override. Don't crash the app —
      // log it and fall back to Hebrew so the surface stays usable. The user can
      // then go fix their settings.
      logger.warn('[i18n] languageOverride malformed; falling back to he', {
        override,
        error: err instanceof Error ? err.message : String(err),
      });
      target = 'he';
    }

    // Defensive: changeLanguage is async + not idempotent (it fires events even
    // for the same value). Skip when there's nothing to do.
    if (!isSupportedLanguage(target)) {
      setIsResolved(true);
      return;
    }
    if (i18n.language === target) {
      setIsResolved(true);
      return;
    }

    const source = override ? 'override' : 'context';
    logger.info('[i18n] Language changing', {
      from: i18n.language,
      to: target,
      source,
    });
    i18n
      .changeLanguage(target)
      .then(() => setIsResolved(true))
      .catch((err) => {
        logger.warn('[i18n] changeLanguage failed', err instanceof Error ? err.message : String(err));
        setIsResolved(true); // unblock UI anyway — fall back to whatever's mounted
      });
  }, [settings?.languageOverride, context?.user?.currentLanguage]);

  return { isResolved };
};
