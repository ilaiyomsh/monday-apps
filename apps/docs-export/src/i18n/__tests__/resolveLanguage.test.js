/**
 * Characterization tests for resolveLanguage — the only piece of logic in
 * src/i18n/index.js (the rest is i18next configuration, waived).
 *
 * The precedence chain is the whole contract: an explicit app setting wins over
 * the monday user's language, which wins over the Hebrew default. Both
 * candidates are validated against SUPPORTED_LANGUAGES, so an unsupported value
 * must be IGNORED rather than passed to i18next (which would silently fall back
 * and make the error layer render raw keys).
 */
import { describe, it, expect } from 'vitest';
import { resolveLanguage, SUPPORTED_LANGUAGES } from '../index';

const heContext = { user: { currentLanguage: 'he' } };
const enContext = { user: { currentLanguage: 'en' } };

describe('resolveLanguage', () => {
  it('supports exactly he and en', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['he', 'en']);
  });

  it('lets a supported override win over a DIFFERENT context language', () => {
    // Both branches present and different — this is what pins the precedence.
    expect(resolveLanguage({ languageOverride: 'en' }, heContext)).toBe('en');
    expect(resolveLanguage({ languageOverride: 'he' }, enContext)).toBe('he');
  });

  it("ignores an unsupported override and falls through to the context language", () => {
    expect(resolveLanguage({ languageOverride: 'fr' }, enContext)).toBe('en');
  });

  it('uses the monday user language when there is no override', () => {
    expect(resolveLanguage(null, enContext)).toBe('en');
    expect(resolveLanguage({}, enContext)).toBe('en');
  });

  it("ignores an unsupported context language and falls back to 'he'", () => {
    expect(resolveLanguage(null, { user: { currentLanguage: 'de' } })).toBe('he');
  });

  it("falls back to 'he' when neither a setting nor a context language exists", () => {
    expect(resolveLanguage(null, null)).toBe('he');
    expect(resolveLanguage(undefined, undefined)).toBe('he');
    expect(resolveLanguage({}, {})).toBe('he');
    expect(resolveLanguage({}, { user: {} })).toBe('he');
  });
});
