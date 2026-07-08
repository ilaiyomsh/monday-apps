import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SupportedLanguage } from '../i18n';
import { LOCALE_TABLE, type LocaleInfo } from '../utils/locale-table';

export type { LocaleInfo } from '../utils/locale-table';

/**
 * Returns locale-aware metadata for the active i18n language. The hook reads
 * `i18n.language` so it re-runs whenever `i18n.changeLanguage(...)` is called —
 * downstream `useMemo`s only need this hook in their deps to stay in sync.
 */
export const useLocale = (): LocaleInfo => {
  const { i18n } = useTranslation();
  // Accept BCP-47 region tags ('en-US', 'en-GB') and case variants — Monday's
  // context.user.currentLanguage occasionally emits them.
  const lang: SupportedLanguage =
    typeof i18n.language === 'string' && i18n.language.toLowerCase().startsWith('en')
      ? 'en'
      : 'he';
  return useMemo(() => LOCALE_TABLE[lang], [lang]);
};
