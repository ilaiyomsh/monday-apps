/**
 * Binds the pure date formatters (src/domain/dates) to the active i18n locale.
 * Components call useL10n() and use t / fmtDate / fmtRange / relDays directly.
 */
import { useTranslation } from 'react-i18next';
import { fmtDate, fmtDateLong, fmtRange, relDays, type MonthDayNames } from './dates';
import type { DayKey } from './types';

export function useL10n() {
  const { t } = useTranslation();

  const names: MonthDayNames = {
    months: t('months', { returnObjects: true }) as string[],
    monthsShort: t('monthsShort', { returnObjects: true }) as string[],
    days: t('days', { returnObjects: true }) as string[],
    daysShort: t('daysShort', { returnObjects: true }) as string[],
    inPrefix: t('common.datePrefix'),
    geresh: t('common.geresh'),
  };

  const relLabels = {
    today: t('rel.today'),
    tomorrow: t('rel.tomorrow'),
    yesterday: t('rel.yesterday'),
    inDays: (n: number) => t('rel.inDays', { count: n }),
    agoDays: (n: number) => t('rel.agoDays', { count: n }),
  };

  return {
    t,
    names,
    monthName: (m: number) => names.months[m],
    monthShort: (m: number) => names.monthsShort[m],
    dayName: (d: number) => names.days[d],
    dayShort: (d: number) => names.daysShort[d],
    fmtDate: (k: DayKey) => fmtDate(k, names),
    fmtDateLong: (k: DayKey) => fmtDateLong(k, names),
    fmtRange: (s: DayKey, e: DayKey) => fmtRange(s, e),
    relDays: (k: DayKey) => relDays(k, relLabels),
  };
}

export type L10n = ReturnType<typeof useL10n>;
