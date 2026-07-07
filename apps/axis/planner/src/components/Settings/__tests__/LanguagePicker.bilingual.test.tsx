import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../../../i18n';
import { LOCALE_TABLE } from '../../../utils/locale-table';

/**
 * Increment 10 contract: picking English flips both the translation AND the
 * layout direction. The Hebrew bundle continues to render RTL.
 */

describe('LanguagePicker — soft launch (Increment 9, RTL kept)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('selecting English flips i18n.language to "en"', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.language).toBe('en');
  });

  it('English translations are reachable via t()', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('common.cancel')).toBe('Cancel');
    expect(i18n.t('settings.dialog.title')).toBe('Settings');
    expect(i18n.t('gantt.toolbar.today')).toBe('Today');
  });

  it('LOCALE_TABLE.en.dir is "ltr" after Increment 10', () => {
    expect(LOCALE_TABLE.en.dir).toBe('ltr');
    expect(LOCALE_TABLE.he.dir).toBe('rtl');
  });

  it('Hebrew → English → Hebrew restores Hebrew lookups (no leak)', async () => {
    expect(i18n.t('common.cancel')).toBe('ביטול');
    await i18n.changeLanguage('en');
    expect(i18n.t('common.cancel')).toBe('Cancel');
    await i18n.changeLanguage('he');
    expect(i18n.t('common.cancel')).toBe('ביטול');
  });

  it('the picker option keys exist in both bundles', () => {
    // Soft-launch's rtlNote is no longer rendered after Increment 10 (LTR for
    // English makes the disclaimer moot). The keys stay in the bundle for
    // safe rollback to Increment 9.
    expect(i18n.t('settings.languagePicker.auto', { lng: 'he' })).toBeTruthy();
    expect(i18n.t('settings.languagePicker.auto', { lng: 'en' })).toBeTruthy();
    expect(i18n.t('settings.languagePicker.he', { lng: 'he' })).toBe('עברית');
    expect(i18n.t('settings.languagePicker.en', { lng: 'en' })).toBe('English');
  });
});
