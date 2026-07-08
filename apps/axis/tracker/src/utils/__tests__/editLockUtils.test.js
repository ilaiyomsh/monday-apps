import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    EDIT_LOCK_MODES,
    EDIT_LOCK_LABEL_KEYS,
    DEFAULT_EDIT_LOCK_DAYS,
    isEventLocked
} from '../editLockUtils';

describe('editLockUtils', () => {

    describe('EDIT_LOCK_MODES', () => {
        it('מכיל את כל המצבים', () => {
            expect(EDIT_LOCK_MODES.NONE).toBe('none');
            expect(EDIT_LOCK_MODES.DAYS_AFTER).toBe('days_after');
        });
    });

    describe('EDIT_LOCK_LABEL_KEYS', () => {
        it('מכיל מפתחות i18n לכל מצב', () => {
            expect(EDIT_LOCK_LABEL_KEYS[EDIT_LOCK_MODES.NONE]).toMatch(/^settings\.additional\.editLock\.modes\./);
            expect(EDIT_LOCK_LABEL_KEYS[EDIT_LOCK_MODES.DAYS_AFTER]).toMatch(/^settings\.additional\.editLock\.modes\./);
        });
    });

    describe('NONE mode', () => {
        it('לעולם לא נעול', () => {
            const event = { start: new Date(2020, 0, 1) };
            expect(isEventLocked(event, EDIT_LOCK_MODES.NONE)).toEqual({
                locked: false,
                reasonKey: ''
            });
        });

        it('lockMode null = לא נעול', () => {
            const event = { start: new Date() };
            expect(isEventLocked(event, null).locked).toBe(false);
        });

        it('lockMode undefined = לא נעול', () => {
            const event = { start: new Date() };
            expect(isEventLocked(event, undefined).locked).toBe(false);
        });
    });

    describe('DAYS_AFTER mode', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 1, 15, 12, 0, 0));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('אירוע מהיום - לא נעול (ברירת מחדל 2 ימים)', () => {
            const event = { start: new Date(2026, 1, 15, 9, 0) };
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 2).locked).toBe(false);
        });

        it('אירוע מאתמול - לא נעול (יום 1 < 2)', () => {
            const event = { start: new Date(2026, 1, 14, 9, 0) };
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 2).locked).toBe(false);
        });

        it('אירוע מלפני יומיים - נעול ב-lockDays=2', () => {
            const event = { start: new Date(2026, 1, 13, 9, 0) };
            const result = isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 2);
            expect(result.locked).toBe(true);
            expect(result.reasonKey).toBe('settings.additional.editLock.reasons.days_after');
            expect(result.reasonParams).toEqual({ days: 2 });
        });

        it('אירוע מלפני 5 ימים - לא נעול כש-lockDays=7', () => {
            const event = { start: new Date(2026, 1, 10, 9, 0) };
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 7).locked).toBe(false);
        });

        it('אירוע מלפני 7 ימים - נעול כש-lockDays=7', () => {
            const event = { start: new Date(2026, 1, 8, 9, 0) };
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 7).locked).toBe(true);
        });

        it('אירוע עתידי - לא נעול', () => {
            const event = { start: new Date(2026, 1, 20, 9, 0) };
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 2).locked).toBe(false);
        });

        it('lockDays חסר - משתמש בברירת מחדל', () => {
            const event = { start: new Date(2026, 1, 13, 9, 0) }; // 2 ימים אחורה
            const result = isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER);
            expect(result.locked).toBe(true);
            expect(result.reasonParams).toEqual({ days: DEFAULT_EDIT_LOCK_DAYS });
        });

        it('lockDays לא חוקי - חוזר לברירת מחדל', () => {
            const event = { start: new Date(2026, 1, 13, 9, 0) };
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 'foo').locked).toBe(true);
        });

        it('lockDays=0 או שלילי - clamp ל-1', () => {
            const event = { start: new Date(2026, 1, 14, 9, 0) }; // יום 1
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 0).locked).toBe(true);
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, -5).locked).toBe(true);
        });

        it('event.start null - לא נעול', () => {
            expect(isEventLocked({ start: null }, EDIT_LOCK_MODES.DAYS_AFTER, 2).locked).toBe(false);
        });
    });

    describe('temporary events', () => {
        it('אירוע זמני - לא נעול גם אם עברו ימים רבים', () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 30);
            const event = { start: oldDate, isTemporary: true };
            expect(isEventLocked(event, EDIT_LOCK_MODES.DAYS_AFTER, 2).locked).toBe(false);
        });
    });

    describe('unknown mode', () => {
        it('מצב לא מוכר - לא נעול', () => {
            const event = { start: new Date(2020, 0, 1) };
            expect(isEventLocked(event, 'unknown_mode').locked).toBe(false);
        });
    });
});
