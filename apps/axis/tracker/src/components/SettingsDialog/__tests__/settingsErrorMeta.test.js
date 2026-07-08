import { describe, it, expect } from 'vitest';
import {
    getErrorTabForKey,
    countTabErrors,
    countMappingSectionErrors,
    MAPPING_SECTION_ERROR_KEYS,
} from '../settingsErrorMeta';

// ניתוב שגיאות ולידציה של מקור היעדרויות Day-off (W4.5) לטאב ולאקורדיון הנכונים

describe('settingsErrorMeta — מפתחות Day-off (W4.5)', () => {

    const dayOffErrorKeys = [
        'dayOffBoardId', 'dayOffPersonColumnId', 'dayOffStartDateColumnId',
        'dayOffEndDateColumnId', 'dayOffKindColumnId', 'dayOffKindLabels',
        'dayOffTypeColumnId', 'dayOffApprovalColumnId',
        'dayOffApprovedLabelIds', 'dayOffPendingLabelIds',
    ];

    it('כל מפתחות dayOff מנותבים לטאב מיפוי', () => {
        dayOffErrorKeys.forEach(key => {
            expect(getErrorTabForKey(key)).toBe('mapping');
        });
    });

    it('סקשן absences קיים וכולל את כל מפתחות dayOff', () => {
        expect(MAPPING_SECTION_ERROR_KEYS.absences).toBeDefined();
        dayOffErrorKeys.forEach(key => {
            expect(MAPPING_SECTION_ERROR_KEYS.absences).toContain(key);
        });
    });

    it('countTabErrors סופר שגיאות dayOff תחת mapping', () => {
        const errors = {
            dayOffBoardId: 'חסר לוח',
            dayOffKindColumnId: 'חסרה עמודה',
        };
        const counts = countTabErrors(errors);
        expect(counts.mapping).toBe(2);
        expect(counts.structure).toBe(0);
        expect(counts.additional).toBe(0);
    });

    it('countMappingSectionErrors סופר שגיאות dayOff בסקשן absences בלבד', () => {
        const errors = {
            dayOffBoardId: 'חסר לוח',
            dayOffApprovedLabelIds: 'חסרות תוויות',
            dateColumnId: 'חסרה עמודה', // שייך ל-timesheet
        };
        expect(countMappingSectionErrors(errors, 'absences')).toBe(2);
        expect(countMappingSectionErrors(errors, 'timesheet')).toBe(1);
        expect(countMappingSectionErrors(errors, 'projects')).toBe(0);
    });

    it('מפתחות dayOff אינם נספרים בסקשנים אחרים', () => {
        ['projects', 'assignments', 'tasks', 'timesheet'].forEach(section => {
            MAPPING_SECTION_ERROR_KEYS[section].forEach(key => {
                expect(key.startsWith('dayOff')).toBe(false);
            });
        });
    });
});
