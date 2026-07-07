import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// ייבוא ישיר מ-client.js — שם safeApi נשאר לתמיד (Wave 4.1.1).
import { MondayApiError, safeApi } from '../mondayApi/client';

// בדיקות retry ל-safeApi (Wave 3.1.1, F013 + F014)
// משתמשים ב-fake timers כדי שלא נחכה באמת ל-2s/4s exponential backoff.

describe('safeApi — retry coverage', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // עוזר: מריץ promise עם fake timers — מקדם זמן עד שהוא מסתיים
    const runWithTimers = async (promise) => {
        const collected = promise.then(v => ({ ok: true, value: v }), e => ({ ok: false, error: e }));
        await vi.advanceTimersByTimeAsync(15_000);
        return collected;
    };

    const makeMonday = (apiImpl) => ({ api: vi.fn(apiImpl) });

    it('עושה retry על שגיאת transport זמנית (429) ופותר בניסיון השני', async () => {
        const transportErr = Object.assign(new Error('rate limited'), {
            data: { errors: [{ extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] }
        });
        const successResponse = { data: { items: [] } };
        const monday = makeMonday(() => Promise.resolve())
            .api.mockRejectedValueOnce(transportErr)
            .mockResolvedValueOnce(successResponse);
        const mondayObj = { api: monday };

        const out = await runWithTimers(safeApi(mondayObj, 'fetchX', 'query Q { x }'));
        expect(out).toEqual({ ok: true, value: successResponse });
        expect(mondayObj.api).toHaveBeenCalledTimes(2);
    });

    it('עושה retry על שגיאה זרוקה עם errorCode RATE_LIMIT_EXCEEDED', async () => {
        const thrown = Object.assign(new Error('rate'), { errorCode: 'RATE_LIMIT_EXCEEDED' });
        const successResponse = { data: { ok: true } };
        const apiMock = vi.fn()
            .mockRejectedValueOnce(thrown)
            .mockResolvedValueOnce(successResponse);
        const monday = { api: apiMock };

        const out = await runWithTimers(safeApi(monday, 'fetchY', 'query Q { y }'));
        expect(out).toEqual({ ok: true, value: successResponse });
        expect(apiMock).toHaveBeenCalledTimes(2);
    });

    it('זורק MondayApiError אחרי שמיצה את MAX_RETRIES', async () => {
        const transportErr = Object.assign(new Error('still rate limited'), {
            data: { errors: [{ extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] }
        });
        const apiMock = vi.fn().mockRejectedValue(transportErr);
        const monday = { api: apiMock };

        const out = await runWithTimers(safeApi(monday, 'fetchZ', 'query Q { z }'));
        expect(out.ok).toBe(false);
        expect(out.error).toBeInstanceOf(MondayApiError);
        expect(out.error.functionName).toBe('fetchZ');
        expect(out.error.apiRequest?.query).toBe('query Q { z }');
        // ניסיון ראשון + 2 retries = 3 קריאות
        expect(apiMock).toHaveBeenCalledTimes(3);
    });

    it('לא עושה retry על שגיאת transport לא-זמנית (401)', async () => {
        const fatalErr = Object.assign(new Error('unauthorized'), {
            data: { errors: [{ extensions: { code: 'USER_UNAUTHORIZED', status_code: 401 } }] }
        });
        const apiMock = vi.fn().mockRejectedValue(fatalErr);
        const monday = { api: apiMock };

        const out = await runWithTimers(safeApi(monday, 'fetchW', 'query Q { w }'));
        expect(out.ok).toBe(false);
        expect(out.error).toBeInstanceOf(MondayApiError);
        expect(apiMock).toHaveBeenCalledTimes(1);
    });

    it('לא עושה retry על soft GraphQL errors — מחזיר את ה-response כמו שהוא', async () => {
        const softErrorResponse = {
            data: null,
            errors: [{ message: 'Bad field', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }]
        };
        const apiMock = vi.fn().mockResolvedValue(softErrorResponse);
        const monday = { api: apiMock };

        const out = await runWithTimers(safeApi(monday, 'fetchSoft', 'query Q { soft }'));
        expect(out.ok).toBe(true);
        expect(out.value).toBe(softErrorResponse);
        // soft GraphQL errors לא אמורים לטריגר retry — קריאה אחת בלבד
        expect(apiMock).toHaveBeenCalledTimes(1);
    });

    it('מכבד retry_in_seconds מתוך extensions של שגיאת transport', async () => {
        const transportErr = Object.assign(new Error('rate'), {
            data: { errors: [{ extensions: { code: 'RATE_LIMIT_EXCEEDED', retry_in_seconds: 5 } }] }
        });
        const successResponse = { data: { ok: 1 } };
        const apiMock = vi.fn()
            .mockRejectedValueOnce(transportErr)
            .mockResolvedValueOnce(successResponse);
        const monday = { api: apiMock };

        const promise = safeApi(monday, 'fetchSlow', 'query Q { slow }');
        const collected = promise.then(v => ({ ok: true, value: v }), e => ({ ok: false, error: e }));

        // אחרי 4 שניות לא אמור להיפתר עדיין (retry_in_seconds=5)
        await vi.advanceTimersByTimeAsync(4_000);
        expect(apiMock).toHaveBeenCalledTimes(1);

        // אחרי 5+ שניות הניסיון השני יוצא לדרך
        await vi.advanceTimersByTimeAsync(2_000);
        const out = await collected;
        expect(out).toEqual({ ok: true, value: successResponse });
        expect(apiMock).toHaveBeenCalledTimes(2);
    });

    it('MondayApiError האחרון מכיל את ה-query המקורי ב-apiRequest', async () => {
        const transportErr = Object.assign(new Error('rate'), {
            data: { errors: [{ extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] }
        });
        const apiMock = vi.fn().mockRejectedValue(transportErr);
        const monday = { api: apiMock };
        const query = 'query MyOp { board(id: 1) { id } }';

        const out = await runWithTimers(safeApi(monday, 'callerX', query, { variables: { foo: 'bar' } }));
        expect(out.ok).toBe(false);
        expect(out.error).toBeInstanceOf(MondayApiError);
        expect(out.error.apiRequest?.query).toBe(query);
        expect(out.error.apiRequest?.variables).toEqual({ foo: 'bar' });
        expect(out.error.apiRequest?.operationName).toBe('MyOp');
    });
});
