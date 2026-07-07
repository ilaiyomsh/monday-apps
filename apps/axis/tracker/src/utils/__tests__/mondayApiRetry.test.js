import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// ייבוא ישיר מ-client.js — שם _testHelpers נשאר לתמיד (Wave 4.1.1).
import { MondayApiError, _testHelpers } from '../mondayApi/client';

const { isRetryableCode, isRetryableError, isRetryableMessage, getRetryDelay, _getErrorExtensions, executeWithRetry } = _testHelpers;

// === isRetryableCode ===

describe('isRetryableCode', () => {
    it('מזהה קוד UPPER_SNAKE_CASE', () => {
        expect(isRetryableCode('COMPLEXITY_BUDGET_EXHAUSTED')).toBe(true);
    });

    it('מזהה קוד PascalCase', () => {
        expect(isRetryableCode('ComplexityBudgetExhausted')).toBe(true);
    });

    it('מזהה קוד lowercase', () => {
        expect(isRetryableCode('complexitybudgetexhausted')).toBe(true);
    });

    it('מזהה InternalServerError', () => {
        expect(isRetryableCode('InternalServerError')).toBe(true);
        expect(isRetryableCode('INTERNAL_SERVER_ERROR')).toBe(true);
    });

    it('מזהה קודי rate limit', () => {
        expect(isRetryableCode('RATE_LIMIT_EXCEEDED')).toBe(true);
        expect(isRetryableCode('IP_RATE_LIMIT_EXCEEDED')).toBe(true);
        expect(isRetryableCode('FIELD_LIMIT_EXCEEDED')).toBe(true);
    });

    it('מזהה Rate Limit Exceeded עם רווחים (ממיר ל-underscores)', () => {
        expect(isRetryableCode('Rate Limit Exceeded')).toBe(true);
    });

    it('מזהה maxConcurrencyExceeded', () => {
        expect(isRetryableCode('maxConcurrencyExceeded')).toBe(true);
    });

    it('מזהה REQUEST_MAX_COMPLEXITY_EXCEEDED', () => {
        expect(isRetryableCode('REQUEST_MAX_COMPLEXITY_EXCEEDED')).toBe(true);
    });

    it('מחזיר false לקוד לא ידוע', () => {
        expect(isRetryableCode('USER_UNAUTHORIZED')).toBe(false);
        expect(isRetryableCode('ResourceNotFoundException')).toBe(false);
    });

    it('מחזיר false ל-null/undefined', () => {
        expect(isRetryableCode(null)).toBe(false);
        expect(isRetryableCode(undefined)).toBe(false);
        expect(isRetryableCode('')).toBe(false);
    });
});

// === isRetryableMessage ===

describe('isRetryableMessage', () => {
    it('מזהה Rate Limit Exceeded בהודעה', () => {
        expect(isRetryableMessage('Rate Limit Exceeded')).toBe(true);
    });

    it('מזהה Minute limit rate exceeded', () => {
        expect(isRetryableMessage('Minute limit rate exceeded')).toBe(true);
    });

    it('מזהה Resource is currently locked', () => {
        expect(isRetryableMessage('Resource is currently locked, please try again later')).toBe(true);
    });

    it('מחזיר false להודעת שגיאה רגילה', () => {
        expect(isRetryableMessage('Column not found')).toBe(false);
        expect(isRetryableMessage('User unauthorized')).toBe(false);
    });

    it('מחזיר false ל-null/undefined', () => {
        expect(isRetryableMessage(null)).toBe(false);
        expect(isRetryableMessage(undefined)).toBe(false);
    });
});

// === _getErrorExtensions ===

describe('_getErrorExtensions', () => {
    it('מחלץ extensions מ-error.data (SDK error)', () => {
        const error = { data: { errors: [{ extensions: { code: 'TEST' } }] } };
        expect(_getErrorExtensions(error)).toEqual({ code: 'TEST' });
    });

    it('מחלץ extensions מ-error.response (MondayApiError)', () => {
        const error = new MondayApiError('test', {
            response: { errors: [{ extensions: { code: 'TEST', retry_in_seconds: 5 } }] }
        });
        expect(_getErrorExtensions(error)).toEqual({ code: 'TEST', retry_in_seconds: 5 });
    });

    it('מעדיף error.data על error.response', () => {
        const error = {
            data: { errors: [{ extensions: { code: 'FROM_DATA' } }] },
            response: { errors: [{ extensions: { code: 'FROM_RESPONSE' } }] }
        };
        expect(_getErrorExtensions(error)).toEqual({ code: 'FROM_DATA' });
    });

    it('מחזיר null כשאין extensions', () => {
        expect(_getErrorExtensions({})).toBeNull();
        expect(_getErrorExtensions({ data: {} })).toBeNull();
        expect(_getErrorExtensions({ data: { errors: [] } })).toBeNull();
    });
});

// === isRetryableError ===

describe('isRetryableError', () => {
    it('מזהה MondayApiError עם errorCode', () => {
        const error = new MondayApiError('test', { errorCode: 'ComplexityBudgetExhausted' });
        expect(isRetryableError(error)).toBe(true);
    });

    it('מזהה MondayApiError עם response.errors[0].extensions.code', () => {
        const error = new MondayApiError('test', {
            response: { errors: [{ extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] }
        });
        expect(isRetryableError(error)).toBe(true);
    });

    it('מזהה MondayApiError עם response.errors[0].extensions.status_code 429', () => {
        const error = new MondayApiError('test', {
            response: { errors: [{ extensions: { status_code: 429 } }] }
        });
        expect(isRetryableError(error)).toBe(true);
    });

    it('מזהה SDK error עם data.errors[0].extensions.code', () => {
        const error = { data: { errors: [{ extensions: { code: 'InternalServerError' } }] } };
        expect(isRetryableError(error)).toBe(true);
    });

    it('מזהה שגיאה לפי message בלבד', () => {
        const error = { message: 'Minute limit rate exceeded' };
        expect(isRetryableError(error)).toBe(true);
    });

    it('מחזיר false לשגיאה לא ניתנת ל-retry', () => {
        const error = new MondayApiError('test', { errorCode: 'USER_UNAUTHORIZED' });
        expect(isRetryableError(error)).toBe(false);
    });

    it('מחזיר false לשגיאה ריקה', () => {
        expect(isRetryableError({})).toBe(false);
    });
});

// === getRetryDelay ===

describe('getRetryDelay', () => {
    it('משתמש ב-retry_in_seconds מ-response.errors (MondayApiError)', () => {
        const error = new MondayApiError('test', {
            response: { errors: [{ extensions: { retry_in_seconds: 5 } }] }
        });
        expect(getRetryDelay(error, 1)).toBe(5000);
    });

    it('משתמש ב-retry_in_seconds מ-data.errors (SDK error)', () => {
        const error = { data: { errors: [{ extensions: { retry_in_seconds: 15 } }] } };
        expect(getRetryDelay(error, 1)).toBe(15000);
    });

    it('נופל ל-exponential backoff כשאין retry_in_seconds', () => {
        const error = new MondayApiError('test', { errorCode: 'InternalServerError' });
        expect(getRetryDelay(error, 1)).toBe(2000); // 2^1 * 1000
        expect(getRetryDelay(error, 2)).toBe(4000); // 2^2 * 1000
    });
});

// === executeWithRetry — העוטף הגנרי ===

describe('executeWithRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // עוזר: מריץ promise עם fake timers — מקדם זמן עד שהוא מסתיים
    const runWithTimers = async (promise) => {
        const result = promise.then(v => ({ ok: true, value: v }), e => ({ ok: false, error: e }));
        // מקדם 10 שניות (מספיק ל-2s + 4s exponential backoff)
        await vi.advanceTimersByTimeAsync(10_000);
        return result;
    };

    it('מצליח בניסיון הראשון — לא קורא ל-onRetry', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const onRetry = vi.fn();
        const out = await runWithTimers(executeWithRetry(fn, { onRetry }));
        expect(out).toEqual({ ok: true, value: 'ok' });
        expect(fn).toHaveBeenCalledTimes(1);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it('עושה retry על שגיאה זמנית ומחזיר את התוצאה של הניסיון השני', async () => {
        const retryableError = new MondayApiError('rate', { errorCode: 'RATE_LIMIT_EXCEEDED' });
        const fn = vi.fn()
            .mockRejectedValueOnce(retryableError)
            .mockResolvedValueOnce('second-try');
        const onRetry = vi.fn();
        const out = await runWithTimers(executeWithRetry(fn, { onRetry }));
        expect(out).toEqual({ ok: true, value: 'second-try' });
        expect(fn).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
            error: retryableError,
            attempt: 1,
            delay: 2000
        }));
    });

    it('זורק את השגיאה האחרונה אחרי שמיצה את MAX_RETRIES', async () => {
        const retryableError = new MondayApiError('rate', { errorCode: 'RATE_LIMIT_EXCEEDED' });
        const fn = vi.fn().mockRejectedValue(retryableError);
        const onRetry = vi.fn();
        const out = await runWithTimers(executeWithRetry(fn, { onRetry }));
        expect(out.ok).toBe(false);
        expect(out.error).toBe(retryableError);
        // ניסיון ראשון + 2 retries = 3 קריאות
        expect(fn).toHaveBeenCalledTimes(3);
        expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('לא עושה retry על שגיאה לא-זמנית', async () => {
        const fatalError = new MondayApiError('auth', { errorCode: 'USER_UNAUTHORIZED' });
        const fn = vi.fn().mockRejectedValue(fatalError);
        const onRetry = vi.fn();
        const out = await runWithTimers(executeWithRetry(fn, { onRetry }));
        expect(out.ok).toBe(false);
        expect(out.error).toBe(fatalError);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it('מכבד retry_in_seconds מתוך ה-extensions', async () => {
        const error = new MondayApiError('rate', {
            errorCode: 'RATE_LIMIT_EXCEEDED',
            response: { errors: [{ extensions: { code: 'RATE_LIMIT_EXCEEDED', retry_in_seconds: 7 } }] }
        });
        const fn = vi.fn()
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce('done');
        const onRetry = vi.fn();
        const promise = executeWithRetry(fn, { onRetry });
        // לא אמור להיפתר עד שעוברות לפחות 7 שניות
        const collected = promise.then(v => ({ ok: true, value: v }), e => ({ ok: false, error: e }));
        await vi.advanceTimersByTimeAsync(15_000);
        const out = await collected;
        expect(out).toEqual({ ok: true, value: 'done' });
        expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delay: 7000 }));
    });

    it('נופל ל-exponential backoff (2s אז 4s) כשאין retry_in_seconds', async () => {
        const retryableError = new MondayApiError('500', { errorCode: 'InternalServerError' });
        const fn = vi.fn().mockRejectedValue(retryableError);
        const onRetry = vi.fn();
        const collected = executeWithRetry(fn, { onRetry })
            .then(v => ({ ok: true, value: v }), e => ({ ok: false, error: e }));
        await vi.advanceTimersByTimeAsync(10_000);
        const out = await collected;
        expect(out.ok).toBe(false);
        const delays = onRetry.mock.calls.map(c => c[0].delay);
        expect(delays).toEqual([2000, 4000]);
    });

    it('עובד גם בלי onRetry callback', async () => {
        const retryableError = new MondayApiError('rate', { errorCode: 'RATE_LIMIT_EXCEEDED' });
        const fn = vi.fn()
            .mockRejectedValueOnce(retryableError)
            .mockResolvedValueOnce('ok');
        const out = await runWithTimers(executeWithRetry(fn));
        expect(out).toEqual({ ok: true, value: 'ok' });
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
