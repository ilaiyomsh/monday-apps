import { describe, it, expect } from 'vitest';
import i18n, { resolveLanguage, isSupportedLanguage, SUPPORTED_LANGUAGES } from '../index';

describe('i18n module', () => {
  it('initializes with Hebrew as the active language', () => {
    expect(i18n.language).toBe('he');
  });

  it('exposes both translation namespaces', () => {
    expect(i18n.hasResourceBundle('he', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
  });

  it('exports the supported languages list', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['he', 'en']);
  });
});

describe('isSupportedLanguage', () => {
  it('accepts he/en', () => {
    expect(isSupportedLanguage('he')).toBe(true);
    expect(isSupportedLanguage('en')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(isSupportedLanguage('')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
    expect(isSupportedLanguage(42)).toBe(false);
  });
});

describe('resolveLanguage', () => {
  it('uses override when supplied', () => {
    expect(resolveLanguage({ override: 'en', contextLanguage: 'he' })).toBe('en');
    expect(resolveLanguage({ override: 'he', contextLanguage: 'en' })).toBe('he');
  });

  it('falls back to context language when no override', () => {
    expect(resolveLanguage({ contextLanguage: 'en' })).toBe('en');
    expect(resolveLanguage({ contextLanguage: 'he' })).toBe('he');
    expect(resolveLanguage({ override: null, contextLanguage: 'en' })).toBe('en');
  });

  it("falls back to 'he' when context language is unknown or missing", () => {
    expect(resolveLanguage({})).toBe('he');
    expect(resolveLanguage({ contextLanguage: 'fr' })).toBe('he');
    expect(resolveLanguage({ contextLanguage: null })).toBe('he');
    expect(resolveLanguage({ contextLanguage: '' })).toBe('he');
  });

  it('throws on a non-null override that is not he/en', () => {
    // settings storage corruption / unsupported version → fail loud, don't silently coerce
    expect(() =>
      resolveLanguage({ override: 'fr' as unknown as 'he' })
    ).toThrow(/unsupported override/);
  });
});
