import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he/translation.json';
import en from './locales/en/translation.json';

export const SUPPORTED_LANGUAGES = ['he', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const isSupportedLanguage = (v: unknown): v is SupportedLanguage =>
  typeof v === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(v);

export interface ResolveLanguageInputs {
  /**
   * Explicit user override stored in PlannerSettings.languageOverride.
   * `null` / `undefined` means "auto" (fall back to Monday context).
   * Throws on any non-supported, non-null value — silent fallback would mask
   * settings-storage corruption.
   */
  override?: SupportedLanguage | null;
  /** Monday `context.user.currentLanguage`. Anything other than 'he'/'en' falls back to 'he'. */
  contextLanguage?: string | null;
}

/**
 * Decide which language to use. Order: override → context → 'he' fallback.
 * Throws on a malformed override value (e.g. settings file written by a future
 * version with a value we don't understand) so callers can decide whether to
 * surface the bug or recover.
 */
export const resolveLanguage = ({ override, contextLanguage }: ResolveLanguageInputs): SupportedLanguage => {
  if (override !== undefined && override !== null) {
    if (!isSupportedLanguage(override)) {
      throw new Error(`[i18n] resolveLanguage: unsupported override "${override}"`);
    }
    return override;
  }
  if (isSupportedLanguage(contextLanguage)) return contextLanguage;
  return 'he';
};

// Dormant init — Hebrew only, English bundle present but unused until extraction
// adds keys. `returnEmptyString: false` so a missing key falls back to its key
// (helps spotting unset translations during development).
void i18n.use(initReactI18next).init({
  lng: 'he',
  fallbackLng: ['he'],
  resources: {
    he: { translation: he },
    en: { translation: en },
  },
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  // Default ns is 'translation' — matches resources structure above.
});

export default i18n;
