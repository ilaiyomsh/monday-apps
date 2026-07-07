import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import i18n, { resolveLanguage } from '../../../i18n';

const setEnv = (value: string | undefined) => {
  vi.stubEnv('VITE_ENABLE_LANGUAGE_PICKER', value as string);
};

/**
 * The language picker is a small JSX block inside a 1k+-line settings dialog
 * with very heavy provider deps. Rather than render the entire tree, we test
 * the contract pieces independently:
 *   - the feature flag (covered in featureFlags.test.ts)
 *   - the resolver picking the override value
 *   - the interaction with i18n.changeLanguage when the override flips
 *
 * The full render path is exercised by the manual QA pass in the rollout doc
 * once the flag is enabled in `.env`.
 */

describe('LanguagePicker — flag + resolver + i18n', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await i18n.changeLanguage('he');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('flag default OFF: feature is hidden in production', async () => {
    setEnv(undefined);
    const { isLanguagePickerEnabled } = await import('../../../utils/featureFlags');
    expect(isLanguagePickerEnabled()).toBe(false);
  });

  it('flag ON: feature is exposed', async () => {
    setEnv('true');
    const { isLanguagePickerEnabled } = await import('../../../utils/featureFlags');
    expect(isLanguagePickerEnabled()).toBe(true);
  });

  it('selecting "auto" (null) resolves to Monday context language', () => {
    expect(resolveLanguage({ override: null, contextLanguage: 'en' })).toBe('en');
    expect(resolveLanguage({ override: null, contextLanguage: 'he' })).toBe('he');
  });

  it('selecting "English" overrides context.he', () => {
    expect(resolveLanguage({ override: 'en', contextLanguage: 'he' })).toBe('en');
  });

  it('selecting "עברית" overrides context.en', () => {
    expect(resolveLanguage({ override: 'he', contextLanguage: 'en' })).toBe('he');
  });

  it('changing override → i18n.changeLanguage flips lookups within 1 tick', async () => {
    expect(i18n.t('common.cancel')).toBe('ביטול');
    await i18n.changeLanguage('en');
    expect(i18n.t('common.cancel')).toBe('Cancel');
    await i18n.changeLanguage('he');
    expect(i18n.t('common.cancel')).toBe('ביטול');
  });
});
