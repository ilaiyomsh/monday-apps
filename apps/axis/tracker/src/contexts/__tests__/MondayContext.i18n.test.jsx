import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';

// TDD: Increment 5 — הרחבת MondayContext עם שדות שפה/כיוון/locale.
// כרגע MondayContext לא חושף את השדות האלה — הטסטים ייכשלו עד שהאינקרמנט יושלם.
import { MondayProvider, useMondayContext } from '../MondayContext';

function createMonday(contextData = {}) {
    let listener = null;
    return {
        get: vi.fn().mockResolvedValue({ data: contextData }),
        listen: vi.fn((event, cb) => {
            if (event === 'context') listener = cb;
            return () => { listener = null; };
        }),
        api: vi.fn().mockResolvedValue({ data: { me: { id: '1', name: 'X' } } }),
        __emitContext: (data) => listener && listener({ data })
    };
}

const wrap = (monday) => ({ children }) => (
    <MondayProvider monday={monday}>{children}</MondayProvider>
);

describe('MondayContext — language/dir/locale (Increment 5)', () => {

    describe('שדות שפה בקונטקסט', () => {
        it('חושף language כברירת מחדל "he" כשאין נתונים', async () => {
            const monday = createMonday({});
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.context).not.toBeNull());
            expect(result.current.language).toBe('he');
        });

        it('קורא language מ-context.user.currentLanguage כשמסופק', async () => {
            const monday = createMonday({ user: { id: '1', currentLanguage: 'en' } });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.language).toBe('en'));
        });

        it('שפה לא נתמכת מ-Monday נופלת ל-"he"', async () => {
            const monday = createMonday({ user: { id: '1', currentLanguage: 'fr' } });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.language).toBe('he'));
        });
    });

    describe('כיוון (dir) נגזר משפה', () => {
        it('he → rtl', async () => {
            const monday = createMonday({ user: { currentLanguage: 'he' } });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.dir).toBe('rtl'));
        });

        it('en → ltr (אינקרמנט 10 — LTR מלא)', async () => {
            const monday = createMonday({ user: { currentLanguage: 'en' } });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.dir).toBe('ltr'));
        });
    });

    describe('locale ו-defaults של זמן', () => {
        it('מספק locale תואם לשפה', async () => {
            const monday = createMonday({ user: { currentLanguage: 'en' } });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            // wait for the real condition — locale starts at the he-IL default until the
            // monday context resolves currentLanguage='en' (React 19 timing exposed the race)
            await waitFor(() => expect(result.current.locale).toMatch(/^en/));
        });

        it('מספק weekStartDay כברירת מחדל (0=ראשון, ישראל)', async () => {
            const monday = createMonday({ user: { currentLanguage: 'he' } });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.weekStartDay).toBe(0));
        });

        it('מספק timeFormat ברירת מחדל ("24h")', async () => {
            const monday = createMonday({});
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.timeFormat).toBe('24h'));
        });
    });

    describe('עדכון דרך monday.listen("context")', () => {
        it('שינוי currentLanguage ב-listener מעדכן את language ו-dir', async () => {
            const monday = createMonday({ user: { id: '1', currentLanguage: 'he' } });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.language).toBe('he'));

            act(() => {
                monday.__emitContext({ user: { id: '1', currentLanguage: 'en' } });
            });

            await waitFor(() => expect(result.current.language).toBe('en'));
        });
    });

    describe('שדות חסרים (location variants)', () => {
        it('board_view ללא user.currentLanguage לא קורס', async () => {
            const monday = createMonday({ boardId: 123, location: { type: 'board_view' } });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.context).not.toBeNull());
            expect(result.current.language).toBe('he');
        });

        it('item_view ללא boardId לא קורס', async () => {
            const monday = createMonday({ location: { type: 'item_view' }, itemId: 9 });
            const { result } = renderHook(() => useMondayContext(), { wrapper: wrap(monday) });
            await waitFor(() => expect(result.current.context).not.toBeNull());
            expect(result.current.language).toBe('he');
        });
    });
});
