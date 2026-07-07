/**
 * בדיקת unit ל-useColumnOptions — סדר התצוגה של אפשרויות הסטטוס.
 *
 * החוזה הנבדק:
 *  (א) כש-settings.labels מגיע כמערך (הפורמט המוקלד) שבו סדר ה-id שונה
 *      מסדר התצוגה (label.index), האפשרויות שמוחזרות חייבות לעקוב אחרי
 *      ה-index (מיקום הלייבל בעמודה / labels_positions_v2) — לא אחרי ה-id
 *      שבו ה-API מחזיר את הרשימה.
 *  (ב) המיון יציב ולא משנה ids או נתונים.
 *
 * safeApi ממוקה ישירות (אין צורך בשרת GraphQL). logger ממוקה גלובלית
 * ב-setupTests.js, ולכן אין צורך לממק אותו כאן.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useColumnOptions, prefetchColumnOptions, invalidateColumnOptionsCache } from '../useColumnOptions';
import { safeApi } from '../../utils/mondayApi';

vi.mock('../../utils/mondayApi', () => ({ safeApi: vi.fn() }));

const monday = {};
const BOARD_ID = '2002';
const COLUMN_ID = 'stage_col';

// בונה תגובת GraphQL לעמודת status עם settings כמחרוזת JSON.
const columnResponse = (settings) => ({
    data: {
        boards: [{
            columns: [{
                id: COLUMN_ID,
                type: 'status',
                settings: JSON.stringify(settings),
            }],
        }],
    },
});

beforeEach(() => {
    safeApi.mockReset();
    invalidateColumnOptionsCache();
});

describe('useColumnOptions — סדר אפשרויות לפי index (סדר התצוגה)', () => {
    it('ממיין אפשרויות לפי label.index גם כשסדר ה-id הפוך', async () => {
        // ה-API מחזיר labels ממוינים לפי id (5,12,30) אך סדר התצוגה (index) הוא 2,0,1.
        const settings = {
            labels: [
                { id: 5, label: 'סיווג ג', index: 2, is_deactivated: false },
                { id: 12, label: 'סיווג א', index: 0, is_deactivated: false },
                { id: 30, label: 'סיווג ב', index: 1, is_deactivated: false },
            ],
            labels_colors: {},
        };
        safeApi.mockResolvedValue(columnResponse(settings));

        const { result } = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));

        await waitFor(() => expect(result.current.options).toHaveLength(3));

        // התוצאה עוקבת אחרי index (סדר התצוגה), לא אחרי id.
        expect(result.current.options.map((o) => o.label)).toEqual(['סיווג א', 'סיווג ב', 'סיווג ג']);
        expect(result.current.options.map((o) => o.index)).toEqual([0, 1, 2]);
        // ה-ids נשמרים כפי שהם (לא שונו) — רק הסדר השתנה.
        expect(result.current.options.map((o) => o.id)).toEqual(['12', '30', '5']);
        expect(result.current.error).toBeNull();
    });

    it('שומר על סדר ה-index גם בפורמט אובייקט של labels', async () => {
        // פורמט אובייקט: המפתח הוא ה-index. הסדר הסופי חייב להיות 0,1,2.
        const settings = {
            labels: { 2: 'שלישי', 0: 'ראשון', 1: 'שני' },
            labels_colors: {},
        };
        safeApi.mockResolvedValue(columnResponse(settings));

        const { result } = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));

        await waitFor(() => expect(result.current.options).toHaveLength(3));

        expect(result.current.options.map((o) => o.label)).toEqual(['ראשון', 'שני', 'שלישי']);
        expect(result.current.options.map((o) => o.index)).toEqual([0, 1, 2]);
    });

    it('cache hit — קריאה שנייה לא מבצעת safeApi נוסף', async () => {
        const settings = {
            labels: [
                { id: 1, label: 'א', index: 0, is_deactivated: false },
                { id: 2, label: 'ב', index: 1, is_deactivated: false },
            ],
            labels_colors: {},
        };
        safeApi.mockResolvedValue(columnResponse(settings));

        const first = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));
        await waitFor(() => expect(first.result.current.options).toHaveLength(2));
        expect(safeApi).toHaveBeenCalledTimes(1);

        const second = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));
        await waitFor(() => expect(second.result.current.options).toHaveLength(2));
        expect(second.result.current.loading).toBe(false);
        expect(safeApi).toHaveBeenCalledTimes(1);
    });

    it('dedupe — שני consumers במקביל חולקים בקשה אחת', async () => {
        const settings = {
            labels: [
                { id: 10, label: 'X', index: 0, is_deactivated: false },
                { id: 11, label: 'Y', index: 1, is_deactivated: false },
            ],
            labels_colors: {},
        };

        let resolveApi;
        const pending = new Promise((resolve) => {
            resolveApi = () => resolve(columnResponse(settings));
        });
        safeApi.mockReturnValue(pending);

        const first = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));
        const second = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));

        expect(safeApi).toHaveBeenCalledTimes(1);
        resolveApi();

        await waitFor(() => expect(first.result.current.options).toHaveLength(2));
        await waitFor(() => expect(second.result.current.options).toHaveLength(2));
        expect(safeApi).toHaveBeenCalledTimes(1);
    });

    it('invalidation — לאחר ניקוי cache מתבצעת קריאה חדשה', async () => {
        const settings = {
            labels: [
                { id: 1, label: 'לפני', index: 0, is_deactivated: false },
            ],
            labels_colors: {},
        };
        safeApi.mockResolvedValue(columnResponse(settings));

        const first = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));
        await waitFor(() => expect(first.result.current.options).toHaveLength(1));
        expect(safeApi).toHaveBeenCalledTimes(1);

        invalidateColumnOptionsCache([{ boardId: BOARD_ID, columnId: COLUMN_ID }]);

        const secondSettings = {
            labels: [
                { id: 2, label: 'אחרי', index: 0, is_deactivated: false },
            ],
            labels_colors: {},
        };
        safeApi.mockResolvedValueOnce(columnResponse(secondSettings));

        const second = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));
        await waitFor(() => expect(second.result.current.options[0]?.label).toBe('אחרי'));
        expect(safeApi).toHaveBeenCalledTimes(2);
    });

    it('prefetch מזין cache וה-hook מחזיר מייד', async () => {
        const settings = {
            labels: [
                { id: 1, label: 'מוכן', index: 0, is_deactivated: false },
            ],
            labels_colors: {},
        };
        safeApi.mockResolvedValue(columnResponse(settings));

        const prefetchResult = await prefetchColumnOptions(monday, BOARD_ID, COLUMN_ID, 'testPrefetch');
        expect(prefetchResult).toHaveLength(1);
        expect(safeApi).toHaveBeenCalledTimes(1);

        const { result } = renderHook(() => useColumnOptions(monday, BOARD_ID, COLUMN_ID));
        await waitFor(() => expect(result.current.options[0]?.label).toBe('מוכן'));
        expect(result.current.loading).toBe(false);
        expect(safeApi).toHaveBeenCalledTimes(1);
    });
});
