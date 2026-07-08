import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he/translation.json';
import en from './locales/en/translation.json';

void i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en },
  },
  lng: 'he',
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

export default i18n;
