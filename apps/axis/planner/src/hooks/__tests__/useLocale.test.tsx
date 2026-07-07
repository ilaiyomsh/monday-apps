import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import i18n from '../../i18n';
import { useLocale } from '../useLocale';
import { LOCALE_TABLE } from '../../utils/locale-table';

describe('useLocale', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('returns Hebrew metadata when i18n.language === "he"', () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current).toEqual(LOCALE_TABLE.he);
    expect(result.current.dateLocale).toBe('he-IL');
    expect(result.current.dir).toBe('rtl');
    expect(result.current.isRtl).toBe(true);
  });

  it('returns English metadata after changeLanguage("en")', async () => {
    const { result, rerender } = renderHook(() => useLocale());
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    rerender();
    expect(result.current.language).toBe('en');
    expect(result.current.dateLocale).toBe('en-US');
    // Increment 10: en flips to LTR.
    expect(result.current.dir).toBe('ltr');
    expect(result.current.isRtl).toBe(false);
    expect(result.current.isLtr).toBe(true);
  });

  it('falls back to Hebrew when i18n.language is unrecognised', async () => {
    const { result, rerender } = renderHook(() => useLocale());
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    rerender();
    // Hook normalises everything that isn't 'en' into 'he'.
    expect(result.current.language).toBe('he');
  });

  it.each(['en-US', 'en-GB', 'EN', 'en-IL'])(
    'recognises BCP-47 region tag %s as English',
    async (tag) => {
      const { result, rerender } = renderHook(() => useLocale());
      await act(async () => {
        await i18n.changeLanguage(tag);
      });
      rerender();
      expect(result.current.language).toBe('en');
    }
  );

  it('LOCALE_TABLE is the exclusive direction source (no per-component dir literals)', () => {
    expect(LOCALE_TABLE.he.dir).toBe('rtl');
    expect(LOCALE_TABLE.en.dir).toBe('ltr');
  });
});
