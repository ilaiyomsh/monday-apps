import { describe, it, expect } from 'vitest';
import {
    getEffectiveBoardId,
    hasValidReportingBoard,
    isCustomObjectMode
} from '../boardIdResolver';

describe('boardIdResolver', () => {

    // === getEffectiveBoardId ===

    describe('getEffectiveBoardId', () => {
        it('מחזיר context.boardId כש-useCurrentBoardForReporting פעיל', () => {
            const settings = { useCurrentBoardForReporting: true };
            const context = { boardId: '123' };
            expect(getEffectiveBoardId(settings, context)).toBe('123');
        });

        it('מתעלם מ-useCurrentBoard אם אין context.boardId', () => {
            const settings = { useCurrentBoardForReporting: true, timeReportingBoardId: '456' };
            const context = {};
            expect(getEffectiveBoardId(settings, context)).toBe('456');
        });

        it('מחזיר timeReportingBoardId כש-useCurrentBoard כבוי', () => {
            const settings = { useCurrentBoardForReporting: false, timeReportingBoardId: '456' };
            const context = { boardId: '123' };
            expect(getEffectiveBoardId(settings, context)).toBe('456');
        });

        it('מחזיר timeReportingBoardId כשאין useCurrentBoard כלל', () => {
            const settings = { timeReportingBoardId: '456' };
            const context = { boardId: '123' };
            expect(getEffectiveBoardId(settings, context)).toBe('456');
        });

        it('fallback ל-context.boardId כשאין הגדרות ספציפיות', () => {
            const settings = {};
            const context = { boardId: '789' };
            expect(getEffectiveBoardId(settings, context)).toBe('789');
        });

        it('מחזיר null כשאין שום מזהה לוח', () => {
            expect(getEffectiveBoardId({}, {})).toBe(null);
        });

        it('מטפל ב-settings null', () => {
            const context = { boardId: '123' };
            expect(getEffectiveBoardId(null, context)).toBe('123');
        });

        it('מטפל ב-context null', () => {
            const settings = { timeReportingBoardId: '456' };
            expect(getEffectiveBoardId(settings, null)).toBe('456');
        });

        it('מחזיר null כשהכל null', () => {
            expect(getEffectiveBoardId(null, null)).toBe(null);
        });

        it('מחזיר null כשהכל undefined', () => {
            expect(getEffectiveBoardId(undefined, undefined)).toBe(null);
        });
    });

    // === hasValidReportingBoard ===

    describe('hasValidReportingBoard', () => {
        it('מחזיר true כשיש לוח תקף', () => {
            expect(hasValidReportingBoard({}, { boardId: '123' })).toBe(true);
        });

        it('מחזיר true עם timeReportingBoardId', () => {
            expect(hasValidReportingBoard({ timeReportingBoardId: '456' }, {})).toBe(true);
        });

        it('מחזיר false כשאין לוח', () => {
            expect(hasValidReportingBoard({}, {})).toBe(false);
        });

        it('מחזיר false עם null', () => {
            expect(hasValidReportingBoard(null, null)).toBe(false);
        });
    });

    // === isCustomObjectMode ===

    describe('isCustomObjectMode', () => {
        it('מחזיר true כשאין boardId ב-context', () => {
            expect(isCustomObjectMode({})).toBe(true);
        });

        it('מחזיר true עם context null', () => {
            expect(isCustomObjectMode(null)).toBe(true);
        });

        it('מחזיר true עם context undefined', () => {
            expect(isCustomObjectMode(undefined)).toBe(true);
        });

        it('מחזיר false כשיש boardId', () => {
            expect(isCustomObjectMode({ boardId: '123' })).toBe(false);
        });
    });
});
