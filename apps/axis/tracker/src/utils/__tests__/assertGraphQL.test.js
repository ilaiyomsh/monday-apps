/**
 * בדיקות ל-assertNoGraphQLErrors (Phase 2).
 *
 * החוזה:
 *  - זורק MondayApiError כש-res.errors קיים ולא ריק, עם response/errorCode/apiRequest.
 *  - מחזיר את res כמות שהוא כשאין שגיאות (גם null/undefined/חסר errors).
 *  - **אינו מלוגג** — ה-soft-error כבר נרשם ב-safeApi (client.js:256). הטסט עוקף
 *    את ה-mock הגלובלי ורושם sink אמיתי כדי לאמת 0 רישומים מהעוזר עצמו.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertNoGraphQLErrors } from '../mondayApi/assertGraphQL';
import { MondayApiError } from '../mondayApi/client';
import logger from '../logger';

// vi.unmock מורם ע"י vitest מעל ה-imports (כמו vi.mock) — עוקף את ה-mock הגלובלי
// מ-setupTests.js כדי לקבל את ה-logger האמיתי (נדרש לאימות dedup דרך sink אמיתי).
vi.unmock('../logger');

let consoleSpies;
beforeEach(() => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        group: vi.spyOn(console, 'group').mockImplementation(() => {}),
        groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
});
afterEach(() => {
    Object.values(consoleSpies).forEach((s) => s.mockRestore());
});

describe('assertNoGraphQLErrors', () => {
    it('זורק MondayApiError כש-res.errors קיים', () => {
        const res = { errors: [{ message: 'boom' }] };
        expect(() => assertNoGraphQLErrors(res)).toThrow(MondayApiError);
    });

    it('משמר response/errorCode/apiRequest על ה-MondayApiError', () => {
        const res = {
            errors: [{ message: 'unauthorized', extensions: { code: 'UserUnauthorizedException' } }]
        };
        let thrown;
        try {
            assertNoGraphQLErrors(res, {
                functionName: 'createBoardItem',
                query: 'mutation create_item { create_item { id } }',
                variables: { boardId: 1 }
            });
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(MondayApiError);
        expect(thrown.message).toBe('unauthorized');
        expect(thrown.errorCode).toBe('UserUnauthorizedException');
        expect(thrown.response).toBe(res);
        expect(thrown.functionName).toBe('createBoardItem');
        expect(thrown.apiRequest.operationName).toBe('create_item');
        expect(thrown.apiRequest.variables).toEqual({ boardId: 1 });
    });

    it('מחזיר res כשאין שגיאות (success path)', () => {
        const res = { data: { create_item: { id: '99' } } };
        expect(assertNoGraphQLErrors(res)).toBe(res);
    });

    it('מחזיר res כש-errors הוא מערך ריק', () => {
        const res = { data: {}, errors: [] };
        expect(assertNoGraphQLErrors(res)).toBe(res);
    });

    it('לא קורס על res חסר/null', () => {
        expect(assertNoGraphQLErrors(undefined)).toBe(undefined);
        expect(assertNoGraphQLErrors(null)).toBe(null);
    });

    it('אינו מלוגג — 0 רשומות לסינק (safeApi הוא הרשומה הקנונית)', () => {
        const spy = vi.fn();
        const unsub = logger.addSink(spy);
        try {
            try {
                assertNoGraphQLErrors({ errors: [{ message: 'x' }] }, { functionName: 'createBoardItem' });
            } catch {
                // הזריקה צפויה — בודקים שהעוזר עצמו לא רשם כלום
            }
            expect(spy).not.toHaveBeenCalled();
        } finally {
            unsub();
        }
    });
});
