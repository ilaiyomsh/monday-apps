import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { he, enUS } from 'date-fns/locale';
import i18n from '../../i18n';
import { useLocale } from '../useLocale';

/**
 * useLocale — מרכז את כל הנגזרות של locale (isRtl/isLtr/dir/dateLocale/
 * dateFnsLocale/culture) ב-API יחיד. שורש האמת: i18n.language.
 */

describe('useLocale', () => {
    beforeEach(async () => {
        await i18n.changeLanguage('he');
    });

    it('i18n.language="he" → ערכי he', () => {
        const { result } = renderHook(() => useLocale());
        expect(result.current).toEqual({
            language: 'he',
            isRtl: true,
            isLtr: false,
            dir: 'rtl',
            dateLocale: 'he-IL',
            dateFnsLocale: he,
            culture: 'he',
        });
    });

    it('i18n.language="en" → ערכי en', async () => {
        await act(async () => {
            await i18n.changeLanguage('en');
        });
        const { result } = renderHook(() => useLocale());
        expect(result.current).toEqual({
            language: 'en',
            isRtl: false,
            isLtr: true,
            dir: 'ltr',
            dateLocale: 'en-US',
            dateFnsLocale: enUS,
            culture: 'en',
        });
    });

    it('שפה לא נתמכת → fallback ל-he בלי לזרוק', async () => {
        await act(async () => {
            await i18n.changeLanguage('fr');
        });
        const { result } = renderHook(() => useLocale());
        expect(result.current.language).toBe('he');
        expect(result.current.dir).toBe('rtl');
        expect(result.current.dateFnsLocale).toBe(he);
    });

    it('reactivity — שינוי i18n.language מעדכן את הערכים', async () => {
        const { result } = renderHook(() => useLocale());
        expect(result.current.language).toBe('he');

        await act(async () => {
            await i18n.changeLanguage('en');
        });
        await waitFor(() => expect(result.current.language).toBe('en'));
        expect(result.current.dir).toBe('ltr');

        await act(async () => {
            await i18n.changeLanguage('he');
        });
        await waitFor(() => expect(result.current.language).toBe('he'));
        expect(result.current.dir).toBe('rtl');
    });
});
