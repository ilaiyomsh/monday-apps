/**
 * i18n — DELIBERATELY NARROW SCOPE (same decision as apps/discussions).
 *
 * This app is Hebrew-first BY DESIGN. The i18n scaffold serves ONLY the
 * error / toast / boundary layer, so those strings stay translatable for a
 * future English rollout. Every other UI string is written as inline Hebrew,
 * on purpose — do NOT "helpfully" migrate inline strings to t().
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import logger from '../utils/logger';
import he from './locales/he/translation.json';
import en from './locales/en/translation.json';

export const SUPPORTED_LANGUAGES = ['he', 'en'];

i18next
  .use(initReactI18next)
  .init({
    resources: { he: { translation: he }, en: { translation: en } },
    lng: 'he',
    fallbackLng: ['he'],
    interpolation: { escapeValue: false }, // React already escapes
    returnEmptyString: false,
  })
  // eslint-disable-next-line promise/catch-or-return
  .catch((error) => {
    // Route through the single funnel like everything else. Note the consequence
    // of landing here: the error layer's OWN strings are what failed to load, so
    // any t() in a toast/boundary will fall back to its key.
    logger.error('i18n', 'i18next_init_failed', error);
  });

/**
 * Resolve the active language: an explicit app setting wins, then the monday
 * user's language, then Hebrew.
 */
export function resolveLanguage(settings, mondayContext) {
  const override = settings?.languageOverride;
  if (override && SUPPORTED_LANGUAGES.includes(override)) return override;
  const fromContext = mondayContext?.user?.currentLanguage;
  if (fromContext && SUPPORTED_LANGUAGES.includes(fromContext)) return fromContext;
  return 'he';
}

export const t = i18next.t.bind(i18next);
export default i18next;
