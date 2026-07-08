import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEffect } from 'react';
import i18n from '../i18n';
import { useLocale } from '../hooks/useLocale';

/**
 * Mirrors the side-effect AppContent runs: `<html dir>` follows
 * `useLocale().dir`. Tests the contract with a tiny stub component instead of
 * mounting the entire App tree (which depends on monday-sdk-js + multiple
 * providers).
 */

const useDirSync = () => {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.dir = locale.dir;
    document.documentElement.lang = locale.language;
  }, [locale.dir, locale.language]);
  return locale;
};

describe('AppContent direction sync (Increment 10)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'he';
  });

  it('switching i18n.language to "en" flips <html dir> to "ltr"', async () => {
    const { rerender } = renderHook(() => useDirSync());
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    rerender();

    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('switching back to "he" restores RTL', async () => {
    renderHook(() => useDirSync());
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await act(async () => {
      await i18n.changeLanguage('he');
    });
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
  });
});
