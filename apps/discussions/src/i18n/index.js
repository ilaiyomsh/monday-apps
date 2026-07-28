import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he/translation.json';
import en from './locales/en/translation.json';
import logger from '../utils/logger.js';

/**
 * i18n infrastructure for the discussions app.
 *
 * - Hebrew-first (`he`); `en` is a scaffold for a future soft launch.
 * - resolveLanguage chains: settings.languageOverride →
 *   monday.context.user.currentLanguage → default 'he'.
 *
 * Init failures route through `logger` (ERROR) so they ship to the Axiom
 * error sink like every other failure — never a bare console.error.
 */

export const SUPPORTED_LANGUAGES = ['he', 'en'];

i18next
  .use(initReactI18next)
  .init({
    resources: {
      he: { translation: he },
      en: { translation: en },
    },
    lng: 'he',
    fallbackLng: ['he'],
    interpolation: { escapeValue: false }, // React handles escaping
    returnEmptyString: false,
  })
  .catch((error) => {
    logger.error('i18n', 'i18next initialization failed', error);
  });

/**
 * Language resolution chain.
 * @param {object} settings   customSettings (optional languageOverride)
 * @param {object} mondayContext  monday SDK context (user.currentLanguage)
 * @returns {'he' | 'en'}
 */
export function resolveLanguage(settings, mondayContext) {
  const override = settings?.languageOverride;
  if (override) {
    if (!SUPPORTED_LANGUAGES.includes(override)) {
      throw new Error(`Unsupported language override: "${override}"`);
    }
    return override;
  }
  const fromContext = mondayContext?.user?.currentLanguage;
  if (fromContext && SUPPORTED_LANGUAGES.includes(fromContext)) {
    return fromContext;
  }
  return 'he';
}

export const t = i18next.t.bind(i18next);

export default i18next;
