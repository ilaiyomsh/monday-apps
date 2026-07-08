/**
 * בדיקות Phase 4 (H10) — createColumn / createEventTypeStatusColumn
 * זורקים MondayApiError על id חסר במקום להחזיר null/undefined בשתיקה.
 *
 * החוזה:
 *  1. data חסר create_column/create_status_column.id → MondayApiError (לא null).
 *  2. soft-error (res.errors) ללא data → MondayApiError, עם errorCode.
 *  3. success path → מחזיר את ה-id/האובייקט כרגיל.
 *
 * משתמשים ב-logger אמיתי (vi.unmock) עם console-spy כדי לא לזהם פלט בדיקות.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createColumn, createEventTypeStatusColumn } from '../columns';
import { MondayApiError } from '../client';

vi.unmock('../../logger');

let consoleSpies;
beforeEach(() => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
        group: vi.spyOn(console, 'group').mockImplementation(() => {}),
        groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
});
afterEach(() => {
    Object.values(consoleSpies).forEach((s) => s.mockRestore());
});

// monday mock מינימלי — מחזיר את ה-response שהוזרק
const makeMonday = (response) => ({ api: vi.fn(async () => response) });

describe('createEventTypeStatusColumn — id חסר (Phase 4 H10)', () => {
    it('data ללא create_status_column.id → זורק MondayApiError', async () => {
        const monday = makeMonday({ data: {} });
        await expect(createEventTypeStatusColumn(monday, 123)).rejects.toBeInstanceOf(MondayApiError);
    });

    it('soft-error (res.errors) → זורק MondayApiError עם errorCode', async () => {
        const monday = makeMonday({
            errors: [{ message: 'unauthorized', extensions: { code: 'UserUnauthorizedException' } }]
        });
        let thrown;
        try {
            await createEventTypeStatusColumn(monday, 123);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(MondayApiError);
        expect(thrown.errorCode).toBe('UserUnauthorizedException');
        expect(thrown.functionName).toBe('createEventTypeStatusColumn');
    });

    it('success → מחזיר את ה-columnId', async () => {
        const monday = makeMonday({ data: { create_status_column: { id: 'col_99' } } });
        await expect(createEventTypeStatusColumn(monday, 123)).resolves.toBe('col_99');
    });
});

describe('createColumn — id חסר (Phase 4 H10)', () => {
    it('data ללא create_column.id → זורק MondayApiError', async () => {
        const monday = makeMonday({ data: {} });
        await expect(
            createColumn(monday, 123, { title: 'X', type: 'text' })
        ).rejects.toBeInstanceOf(MondayApiError);
    });

    it('soft-error → זורק MondayApiError', async () => {
        const monday = makeMonday({ errors: [{ message: 'boom', extensions: { code: 'SomeError' } }] });
        let thrown;
        try {
            await createColumn(monday, 123, { title: 'X', type: 'text' });
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(MondayApiError);
        expect(thrown.errorCode).toBe('SomeError');
        expect(thrown.functionName).toBe('createColumn');
    });

    it('success → מחזיר { id, type }', async () => {
        const monday = makeMonday({ data: { create_column: { id: 'col_5', type: 'text' } } });
        await expect(
            createColumn(monday, 123, { title: 'X', type: 'text' })
        ).resolves.toEqual({ id: 'col_5', type: 'text' });
    });
});
