import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import i18n from '../../i18n';
import { resolveLanguage } from '../../i18n';
import { useLanguageSync } from '../useLanguageSync';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';
import { getMondayMock } from '../../test-utils/mondayMock';

// Wire the in-memory monday SDK mock so MondayContextProvider's
// `monday.get('context')` call returns whatever __seedContext provides.
// Factory uses dynamic import — vi.mock hoists, so it can't close over
// statically-imported bindings.
vi.mock('monday-sdk-js', async () => {
  const { getMondayMock } = await import('../../test-utils/mondayMock');
  return { default: () => getMondayMock() };
});

// Resolution-only unit tests stay at the top — they don't need providers.
describe('useLanguageSync — language resolution unit', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('settings null + context.he resolves to "he"', () => {
    expect(resolveLanguage({ override: null, contextLanguage: 'he' })).toBe('he');
  });

  it('settings.languageOverride="en" wins over context', () => {
    expect(resolveLanguage({ override: 'en', contextLanguage: 'he' })).toBe('en');
  });

  it('a context-language change re-resolves when override is null', () => {
    expect(resolveLanguage({ override: null, contextLanguage: 'he' })).toBe('he');
    expect(resolveLanguage({ override: null, contextLanguage: 'en' })).toBe('en');
  });

  it('a malformed override throws (caller decides to log+fallback)', () => {
    expect(() =>
      resolveLanguage({ override: 'fr' as unknown as 'en', contextLanguage: 'he' })
    ).toThrow(/unsupported override/);
  });
});

// Hook integration: actually mount useLanguageSync inside the providers and
// verify the matrix of `settings.languageOverride` × `context.user.currentLanguage`.
describe('useLanguageSync — hook integration', () => {
  beforeEach(async () => {
    // Reset the singleton's state in place — replacing the singleton would
    // strand the `mondaySdk()` calls that already cached the old instance
    // at module load time.
    getMondayMock().__reset();
    await i18n.changeLanguage('he');
  });

  type Case = {
    name: string;
    override: 'he' | 'en' | 'invalid' | null;
    contextLanguage?: string;
    expected: 'he' | 'en';
  };

  const cases: Case[] = [
    { name: 'override=null, ctx=undefined → he (fallback)', override: null, expected: 'he' },
    { name: 'override=null, ctx=he → he', override: null, contextLanguage: 'he', expected: 'he' },
    { name: 'override=null, ctx=en → en', override: null, contextLanguage: 'en', expected: 'en' },
    { name: 'override=null, ctx=fr → he (unrecognised)', override: null, contextLanguage: 'fr', expected: 'he' },
    { name: 'override=he, ctx=en → he (override wins)', override: 'he', contextLanguage: 'en', expected: 'he' },
    { name: 'override=en, ctx=he → en (override wins)', override: 'en', contextLanguage: 'he', expected: 'en' },
  ];

  cases.forEach(({ name, override, contextLanguage, expected }) => {
    it(name, async () => {
      const initialSettings = override ? { languageOverride: override } : {};
      const { result } = renderHookWithProviders(useLanguageSync, {
        initialSettings,
        language: contextLanguage,
        withoutActiveProjects: true,
      });

      // Wait for both the resolution flag AND for i18n to land on the
      // expected target — the hook re-fires when the async monday context
      // resolves, so `isResolved` flipping true once isn't enough.
      await waitFor(() => {
        expect(result.current.isResolved).toBe(true);
        expect(i18n.language).toBe(expected);
      });
    });
  });

  it('a malformed override falls back to "he" without crashing', async () => {
    const { result } = renderHookWithProviders(useLanguageSync, {
      initialSettings: { languageOverride: 'invalid' as unknown as 'en' },
      language: 'en',
      withoutActiveProjects: true,
    });

    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(i18n.language).toBe('he');
  });

  it('isResolved is false on first render and true after sync settles', async () => {
    const { result } = renderHookWithProviders(useLanguageSync, {
      initialSettings: { languageOverride: 'en' },
      withoutActiveProjects: true,
    });

    await waitFor(() => {
      expect(result.current.isResolved).toBe(true);
      expect(i18n.language).toBe('en');
    });
  });
});

// Bundle-resolution smoke (kept from prior file as a contract — bilingual
// keys remain reachable through i18n.t).
describe('useLanguageSync — bundle smoke', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('changeLanguage flips i18n.language and `t` resolution', async () => {
    expect(i18n.language).toBe('he');
    await i18n.changeLanguage('en');
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(i18n.t('common.cancel')).toBe('Cancel');
  });

  it('changeLanguage back to "he" restores Hebrew lookups', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('common.cancel')).toBe('Cancel');
    await i18n.changeLanguage('he');
    expect(i18n.t('common.cancel')).toBe('ביטול');
  });
});
