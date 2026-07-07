import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useLanguageSync } from '../useLanguageSync';
import { MondayProvider } from '../../contexts/MondayContext';
import { SettingsProvider } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import i18n from '../../i18n';

/**
 * useLanguageSync — אינקרמנט 8.
 *
 * הסנכרון רץ ב-useEffect עם dependencies של languageOverride
 * ו-currentLanguage. הטסט מאמת ש-i18n.changeLanguage נקרא עם
 * הערך המתאים לפי שרשרת resolveLanguage.
 */

function wrap(monday, settings = {}) {
    return ({ children }) => (
        <MondayProvider monday={monday}>
            <SettingsProvider monday={monday}>
                {children}
            </SettingsProvider>
        </MondayProvider>
    );
}

describe('useLanguageSync (Increment 8)', () => {

    beforeEach(async () => {
        await i18n.changeLanguage('he');
    });

    it('מסנכרן ל-he כברירת מחדל כשאין override ואין currentLanguage', async () => {
        const monday = createMondayMock({ context: { boardId: 1 } });
        renderHook(() => useLanguageSync(), { wrapper: wrap(monday) });
        await waitFor(() => expect(i18n.language).toBe('he'));
    });

    it('מסנכרן ל-en כש-context.user.currentLanguage="en"', async () => {
        const monday = createMondayMock({
            context: { boardId: 1, user: { id: '1', currentLanguage: 'en' } }
        });
        renderHook(() => useLanguageSync(), { wrapper: wrap(monday) });
        await waitFor(() => expect(i18n.language).toBe('en'));
    });

    it('languageOverride ב-settings מנצח את context', async () => {
        const monday = createMondayMock({
            context: { boardId: 1, user: { id: '1', currentLanguage: 'en' } }
        });
        // seed הגדרות עם override ל-he
        const instanceId = 1;
        monday.__seedStorage(`customSettings_${instanceId}`, JSON.stringify({
            languageOverride: 'he',
            lastModifiedAt: '2026-01-01T00:00:00.000Z'
        }));
        renderHook(() => useLanguageSync(), { wrapper: wrap(monday) });
        await waitFor(() => expect(i18n.language).toBe('he'));
    });

    it('שפה לא נתמכת מ-currentLanguage נופלת ל-he', async () => {
        const monday = createMondayMock({
            context: { boardId: 1, user: { id: '1', currentLanguage: 'fr' } }
        });
        renderHook(() => useLanguageSync(), { wrapper: wrap(monday) });
        await waitFor(() => expect(i18n.language).toBe('he'));
    });
});
