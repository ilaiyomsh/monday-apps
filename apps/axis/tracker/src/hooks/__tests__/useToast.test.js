import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from '../useToast';
import logger from '../../utils/logger';

vi.mock('../../utils/errorHandler', () => ({
    parseMondayError: vi.fn(() => ({
        userMessage: 'שגיאת בדיקה',
        errorCode: 'TEST_ERROR',
        canRetry: false,
        fullDetails: {}
    })),
    createFullErrorObject: vi.fn(() => ({
        errorCode: 'TEST_ERROR',
        userMessage: 'שגיאת בדיקה'
    }))
}));

vi.mock('../../utils/mondayApi', () => ({
    MondayApiError: class MondayApiError extends Error {
        constructor(message, opts = {}) {
            super(message);
            this.name = 'MondayApiError';
            this.response = opts.response || null;
            this.errorCode = opts.errorCode || null;
        }
    }
}));

describe('useToast', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('מציג toast רגיל', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showSuccess('הצלחה');
        });

        expect(result.current.toasts).toHaveLength(1);
        expect(result.current.toasts[0].message).toBe('הצלחה');
        expect(result.current.toasts[0].type).toBe('success');
    });

    it('מציג toast שגיאה', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showError('שגיאה');
        });

        expect(result.current.toasts).toHaveLength(1);
        expect(result.current.toasts[0].type).toBe('error');
    });

    it('מונע כפילות של toast שגיאה באותה הודעה תוך 2 שניות', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showToast('שגיאה זהה', 'error');
            result.current.showToast('שגיאה זהה', 'error');
            result.current.showToast('שגיאה זהה', 'error');
        });

        expect(result.current.toasts).toHaveLength(1);
    });

    it('מאפשר toast שגיאה עם הודעות שונות', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showToast('שגיאה 1', 'error');
            result.current.showToast('שגיאה 2', 'error');
        });

        expect(result.current.toasts).toHaveLength(2);
    });

    it('לא מונע כפילות ב-success/warning toasts', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showSuccess('הצלחה');
            result.current.showSuccess('הצלחה');
        });

        expect(result.current.toasts).toHaveLength(2);
    });

    it('מחזיר null עבור toast שנחסם', () => {
        const { result } = renderHook(() => useToast());

        let firstId, secondId;
        act(() => {
            firstId = result.current.showToast('שגיאה', 'error');
            secondId = result.current.showToast('שגיאה', 'error');
        });

        expect(firstId).not.toBeNull();
        expect(secondId).toBeNull();
    });

    it('מסיר toast', () => {
        const { result } = renderHook(() => useToast());

        let toastId;
        act(() => {
            toastId = result.current.showSuccess('test');
        });

        expect(result.current.toasts).toHaveLength(1);

        act(() => {
            result.current.removeToast(toastId);
        });

        expect(result.current.toasts).toHaveLength(0);
    });

    // Phase 1 של ui-sink-plan.md: showErrorWithDetails הוא facade לוג-בלבד —
    // ההצגה נעשית ע"י ה-UI sink (useUiErrorSink) שמאזין לרשומות ERROR.
    it('showErrorWithDetails רושם ל-logger ולא מציג טוסט ישירות (facade לוג-בלבד)', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showErrorWithDetails(new Error('test error'), {
                functionName: 'testFunction'
            });
        });

        // אין טוסט ישיר — ההצגה עוברת דרך ה-sink
        expect(result.current.toasts).toHaveLength(0);
        // אבל השגיאה נרשמה ל-logger (פעם אחת)
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toBe('testFunction');
    });

    it('showErrorWithDetails מדלג על רישום שגיאה שכבר נרשמה (__loggedId / log-once)', () => {
        const { result } = renderHook(() => useToast());

        const err = new Error('already logged');
        act(() => {
            // רישום ראשון — מטביע __loggedId (במוק ה-logger המשודרג)
            logger.error('safeApi', 'first log', err);
        });
        logger.error.mockClear();

        act(() => {
            result.current.showErrorWithDetails(err, { functionName: 'caller' });
        });

        // ה-facade לא רושם שוב שגיאה שכבר נרשמה במעלה הזרם
        expect(logger.error).not.toHaveBeenCalled();
        expect(result.current.toasts).toHaveLength(0);
    });
});
