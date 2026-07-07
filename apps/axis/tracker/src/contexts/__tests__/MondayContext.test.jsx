import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';


import { MondayProvider, useMondayContext, useMobile } from '../MondayContext';

// יצירת mock ל-Monday SDK
// MondayProvider קוראת גם ל-monday.listen('context') ו-monday.api (לקריאת
// פרטי משתמש כשחסר name) — ה-mock חייב לחשוף את כולם.
function createMockMonday(contextData = {}) {
    return {
        get: vi.fn().mockResolvedValue({ data: contextData }),
        listen: vi.fn(() => () => {}),
        api: vi.fn().mockResolvedValue({ data: { me: null } })
    };
}

function createWrapper(monday) {
    return ({ children }) => (
        <MondayProvider monday={monday}>{children}</MondayProvider>
    );
}

describe('MondayContext', () => {

    // === זיהוי מובייל ===

    describe('isMobile', () => {
        it('מזהה מובייל כאשר context.mode === "mobile"', async () => {
            const monday = createMockMonday({ mode: 'mobile', boardId: 123 });
            const { result } = renderHook(() => useMondayContext(), {
                wrapper: createWrapper(monday)
            });

            await waitFor(() => {
                expect(result.current.isMobile).toBe(true);
            });
        });

        it('מזהה דסקטופ כאשר אין שדה mode', async () => {
            const monday = createMockMonday({ boardId: 123 });
            const { result } = renderHook(() => useMondayContext(), {
                wrapper: createWrapper(monday)
            });

            await waitFor(() => {
                expect(result.current.context).not.toBeNull();
            });
            expect(result.current.isMobile).toBe(false);
        });

        it('ברירת מחדל false לפני טעינת הקונטקסט', () => {
            const monday = {
                get: vi.fn().mockReturnValue(new Promise(() => {})), // לעולם לא נפתר
                listen: vi.fn(() => () => {}),
                api: vi.fn().mockResolvedValue({ data: { me: null } })
            };
            const { result } = renderHook(() => useMondayContext(), {
                wrapper: createWrapper(monday)
            });

            expect(result.current.isMobile).toBe(false);
            expect(result.current.context).toBeNull();
        });
    });

    // === useMobile hook ===

    describe('useMobile', () => {
        it('מחזיר true במובייל', async () => {
            const monday = createMockMonday({ mode: 'mobile' });
            const { result } = renderHook(() => useMobile(), {
                wrapper: createWrapper(monday)
            });

            await waitFor(() => {
                expect(result.current).toBe(true);
            });
        });

        it('מחזיר false בדסקטופ', async () => {
            const monday = createMockMonday({ boardId: 456 });
            const { result } = renderHook(() => useMobile(), {
                wrapper: createWrapper(monday)
            });

            await waitFor(() => {
                expect(result.current).toBe(false);
            });
        });
    });

    // === קונטקסט מלא ===

    describe('context object', () => {
        it('חושף את כל שדות הקונטקסט', async () => {
            const contextData = {
                boardId: 123,
                mode: 'mobile',
                user: { id: '456', isAdmin: false },
                theme: 'dark',
                account: { id: '789' }
            };
            const monday = createMockMonday(contextData);
            const { result } = renderHook(() => useMondayContext(), {
                wrapper: createWrapper(monday)
            });

            await waitFor(() => {
                expect(result.current.context).toEqual(contextData);
            });
        });

        it('מטפל בשגיאת טעינה בלי לקרוס', async () => {
            const monday = {
                get: vi.fn().mockRejectedValue(new Error('SDK error')),
                listen: vi.fn(() => () => {}),
                api: vi.fn().mockResolvedValue({ data: { me: null } })
            };
            const { result } = renderHook(() => useMondayContext(), {
                wrapper: createWrapper(monday)
            });

            // ממתין שה-promise יידחה
            await waitFor(() => {
                expect(monday.get).toHaveBeenCalled();
            });

            // לא קרס, ערכי ברירת מחדל
            expect(result.current.context).toBeNull();
            expect(result.current.isMobile).toBe(false);
        });
    });

    // === קריאת SDK ===

    describe('SDK call', () => {
        it('קורא ל-monday.get("context") פעם אחת', async () => {
            const monday = createMockMonday({ boardId: 123 });
            renderHook(() => useMondayContext(), {
                wrapper: createWrapper(monday)
            });

            await waitFor(() => {
                expect(monday.get).toHaveBeenCalledWith('context');
            });
            expect(monday.get).toHaveBeenCalledTimes(1);
        });
    });
});
