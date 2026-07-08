import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../../../i18n';
import he from '../../../i18n/locales/he/translation.json';
import en from '../../../i18n/locales/en/translation.json';

const get = (bundle: unknown, path: string): string => {
  let cur: unknown = bundle;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === 'string' ? cur : '';
};

describe('FilterDropdown — bilingual key lookups', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  const keys = [
    'filter.button',
    'filter.timeframe.label',
    'filter.timeframe.endingThisWeek',
    'filter.timeframe.endingThisMonth',
    'filter.utilization.label',
    'filter.utilization.red',
    'filter.utilization.yellow',
    'filter.utilization.blue',
    'filter.utilization.green',
    'filter.hidePast',
    'filter.clear',
  ];

  it('every key resolves to a non-empty string in Hebrew', () => {
    for (const k of keys) {
      expect(get(he, k), `missing he value for ${k}`).not.toBe('');
    }
  });

  it('every key resolves to a non-empty English string distinct from Hebrew', async () => {
    for (const k of keys) {
      const enVal = get(en, k);
      const heVal = get(he, k);
      expect(enVal, `missing en value for ${k}`).not.toBe('');
      // Common shared values can match (e.g. icons), but for these labels Hebrew/English must differ.
      expect(enVal, `en should differ from he for ${k}`).not.toBe(heVal);
    }
  });

  it('switching language changes i18n.language', async () => {
    expect(i18n.language).toBe('he');
    await i18n.changeLanguage('en');
    expect(i18n.language).toBe('en');
    expect(i18n.t('filter.button')).toBe(get(en, 'filter.button'));
  });
});
