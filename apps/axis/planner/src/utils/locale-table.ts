import { type Locale } from 'date-fns';
import { he as heLocale, enUS as enLocale } from 'date-fns/locale';
import type { SupportedLanguage } from '../i18n';

export interface LocaleInfo {
  language: SupportedLanguage;
  isRtl: boolean;
  isLtr: boolean;
  /**
   * `<html dir>` value. Increment 10: en flips to `'ltr'`. Anything reading
   * `dir` from this hook becomes direction-aware automatically.
   */
  dir: 'rtl' | 'ltr';
  /** BCP-47 tag fed to `Intl.NumberFormat`, `Intl.DateTimeFormat`, `localeCompare`. */
  dateLocale: string;
  /** date-fns Locale instance for `format(..., { locale })`. */
  dateFnsLocale: Locale;
  /** Short culture tag — handy for analytics or feature flags. */
  culture: 'he' | 'en';
}

export const LOCALE_TABLE: Record<SupportedLanguage, LocaleInfo> = {
  he: {
    language: 'he',
    isRtl: true,
    isLtr: false,
    dir: 'rtl',
    dateLocale: 'he-IL',
    dateFnsLocale: heLocale,
    culture: 'he',
  },
  en: {
    language: 'en',
    isRtl: false,
    isLtr: true,
    // Increment 10: English flips to LTR. Components reading `dir` get this
    // automatically; CSS rules that assumed RTL (`right: 0` etc.) were
    // converted to logical properties or gated by `:root[dir="rtl"]`. The
    // Gantt timeline (`VirtualRowList`) intentionally stays LTR in both
    // directions — see the comment there for why.
    dir: 'ltr',
    dateLocale: 'en-US',
    dateFnsLocale: enLocale,
    culture: 'en',
  },
};
