import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSettingsValidation } from '../useSettingsValidation';

// הגדרות בסיסיות תקינות (מינימום חובה)
const validSettings = {
    structureMode: 'PROJECT_ONLY',
    fieldConfig: {
        task: 'hidden',
        stage: 'hidden',
        notes: 'hidden',
        billableToggle: 'visible',
        nonBillableType: 'required',
    },
    useCurrentBoardForReporting: true,
    connectedBoardId: 'board1',
    peopleColumnIds: ['person1'],
    dateColumnId: 'date1',
    endTimeColumnId: 'endDate1',
    durationColumnId: 'dur1',
    projectColumnId: 'proj1',
    reporterColumnId: 'rep1',
    eventTypeStatusColumnId: 'status1',
    nonBillableStatusColumnId: 'nb1',
    eventTypeMapping: {
        '0': 'hourly',
        '1': 'vacation',
        '2': 'sick',
        '3': 'reserves',
        '4': 'non_billable',
        '5': 'temporary',
    },
    enableApproval: false,
};

const context = { boardId: '12345' };

describe('useSettingsValidation — approval', () => {

    // כש-enableApproval כבוי — אין שגיאות approval
    it('enableApproval=false — אין שגיאות אישור', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({ ...validSettings, enableApproval: false }, context)
        );
        expect(result.current.errors.approvalStatusColumnId).toBeUndefined();
        expect(result.current.errors.approvalStatusMapping).toBeUndefined();
    });

    // כש-enableApproval פעיל — חובה עמודת סטטוס אישור
    it('enableApproval=true ללא approvalStatusColumnId — שגיאה', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                enableApproval: true,
                approvalStatusColumnId: null,
            }, context)
        );
        expect(result.current.errors.approvalStatusColumnId).toBeDefined();
        expect(result.current.isValid).toBe(false);
    });

    // כש-enableApproval פעיל + עמודה + ללא מיפוי — שגיאה
    it('enableApproval=true עם approvalStatusColumnId ללא מיפוי — שגיאה', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                enableApproval: true,
                approvalStatusColumnId: 'approval_col',
                approvalStatusMapping: null,
            }, context)
        );
        expect(result.current.errors.approvalStatusMapping).toBeDefined();
    });

    // כש-enableApproval פעיל + עמודה + מיפוי ריק — שגיאה
    it('enableApproval=true עם מיפוי ריק — שגיאה', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                enableApproval: true,
                approvalStatusColumnId: 'approval_col',
                approvalStatusMapping: {},
            }, context)
        );
        expect(result.current.errors.approvalStatusMapping).toBeDefined();
    });

    // כש-enableApproval פעיל + עמודה + מיפוי תקין — אין שגיאה
    it('enableApproval=true עם מיפוי תקין — ללא שגיאות', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                enableApproval: true,
                approvalStatusColumnId: 'approval_col',
                approvalStatusMapping: {
                    '0': 'pending',
                    '1': 'approved',
                    '2': 'rejected',
                },
            }, context)
        );
        expect(result.current.errors.approvalStatusColumnId).toBeUndefined();
        expect(result.current.errors.approvalStatusMapping).toBeUndefined();
    });

    // מיפוי לא תקין — חסר pending
    it('מיפוי חסר pending — שגיאה', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                enableApproval: true,
                approvalStatusColumnId: 'approval_col',
                approvalStatusMapping: {
                    '1': 'approved',
                    '2': 'rejected',
                },
            }, context)
        );
        expect(result.current.errors.approvalStatusMapping).toBeDefined();
    });

    // שגיאות approval ממופות ל-tab 'additional' (נבדק ב-SettingsDialog)
    it('מפתחות שגיאה של approval נמצאים בתשובה', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                enableApproval: true,
                approvalStatusColumnId: null,
                approvalStatusMapping: null,
            }, context)
        );
        expect('approvalStatusColumnId' in result.current.errors).toBe(true);
    });
});

describe('useSettingsValidation — מקור היעדרויות Day-off (W4.5)', () => {

    const fullDayOffMapping = {
        absenceSource: 'dayoff',
        dayOffBoardId: 'vac_board',
        dayOffPersonColumnId: 'do_person',
        dayOffStartDateColumnId: 'do_start',
        dayOffEndDateColumnId: 'do_end',
        dayOffKindColumnId: 'do_kind',
        dayOffKindGeneralLabelId: '1',
        dayOffKindPersonalLabelId: '2',
        dayOffTypeColumnId: 'do_type',
    };

    const dayOffErrorKeys = [
        'dayOffBoardId', 'dayOffPersonColumnId', 'dayOffStartDateColumnId',
        'dayOffEndDateColumnId', 'dayOffKindColumnId', 'dayOffKindLabels',
        'dayOffTypeColumnId', 'dayOffApprovalColumnId',
        'dayOffApprovedLabelIds', 'dayOffPendingLabelIds',
    ];

    it('ברירת מחדל (ללא absenceSource) — אין שגיאות dayOff', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({ ...validSettings }, context)
        );
        dayOffErrorKeys.forEach(key => {
            expect(result.current.errors[key]).toBeUndefined();
        });
    });

    it("absenceSource='tracker' עם מיפוי dayOff חלקי — לא חוסם (מותר למפות מראש)", () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                absenceSource: 'tracker',
                dayOffBoardId: 'vac_board',
                // שאר העמודות לא מופו — ובכל זאת אין שגיאות
            }, context)
        );
        dayOffErrorKeys.forEach(key => {
            expect(result.current.errors[key]).toBeUndefined();
        });
    });

    it("absenceSource='dayoff' ללא לוח — שגיאת לוח חופשות", () => {
        const { result } = renderHook(() =>
            useSettingsValidation({ ...validSettings, absenceSource: 'dayoff' }, context)
        );
        expect(result.current.errors.dayOffBoardId).toBeDefined();
        expect(result.current.isValid).toBe(false);
    });

    it("absenceSource='dayoff' עם לוח בלבד — כל העמודות הקריטיות נדרשות", () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                absenceSource: 'dayoff',
                dayOffBoardId: 'vac_board',
            }, context)
        );
        expect(result.current.errors.dayOffPersonColumnId).toBeDefined();
        expect(result.current.errors.dayOffStartDateColumnId).toBeDefined();
        expect(result.current.errors.dayOffEndDateColumnId).toBeDefined();
        expect(result.current.errors.dayOffKindColumnId).toBeDefined();
        expect(result.current.errors.dayOffTypeColumnId).toBeDefined();
        // מדיניות אישור כבויה — אין דרישת עמודת אישור (D2)
        expect(result.current.errors.dayOffApprovalColumnId).toBeUndefined();
    });

    it('עמודת קינד ללא בחירת תוויות כללי/אישי — שגיאת dayOffKindLabels', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                ...fullDayOffMapping,
                dayOffKindGeneralLabelId: null,
            }, context)
        );
        expect(result.current.errors.dayOffKindLabels).toBeDefined();
    });

    it('מיפוי dayOff מלא — אין שגיאות dayOff', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({ ...validSettings, ...fullDayOffMapping }, context)
        );
        dayOffErrorKeys.forEach(key => {
            expect(result.current.errors[key]).toBeUndefined();
        });
    });

    it('dayOffApprovalRequired=true ללא עמודת אישור — שגיאה (D2)', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                ...fullDayOffMapping,
                dayOffApprovalRequired: true,
            }, context)
        );
        expect(result.current.errors.dayOffApprovalColumnId).toBeDefined();
    });

    it('dayOffApprovalRequired=true עם עמודה ללא תוויות — שתי שגיאות תוויות', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                ...fullDayOffMapping,
                dayOffApprovalRequired: true,
                dayOffApprovalColumnId: 'do_approval',
                dayOffApprovedLabelIds: [],
                dayOffPendingLabelIds: [],
            }, context)
        );
        expect(result.current.errors.dayOffApprovedLabelIds).toBeDefined();
        expect(result.current.errors.dayOffPendingLabelIds).toBeDefined();
    });

    it('dayOffApprovalRequired=true עם מיפוי אישור מלא — אין שגיאות dayOff', () => {
        const { result } = renderHook(() =>
            useSettingsValidation({
                ...validSettings,
                ...fullDayOffMapping,
                dayOffApprovalRequired: true,
                dayOffApprovalColumnId: 'do_approval',
                dayOffApprovedLabelIds: ['1'],
                dayOffPendingLabelIds: ['0'],
            }, context)
        );
        dayOffErrorKeys.forEach(key => {
            expect(result.current.errors[key]).toBeUndefined();
        });
    });
});

describe('useSettingsValidation — XOR מתקדם', () => {
    it('XOR מופעל ללא בחירת שני שדות — שגיאת xorConfiguration', () => {
        const { result } = renderHook(() =>
            useSettingsValidation(
                {
                    ...validSettings,
                    advancedValidation: { enabled: true, xorFields: ['task', null] },
                },
                context
            )
        );
        expect(result.current.errors.xorConfiguration).toBeDefined();
    });

    it('XOR עם אותו שדה פעמיים — שגיאה', () => {
        const { result } = renderHook(() =>
            useSettingsValidation(
                {
                    ...validSettings,
                    advancedValidation: { enabled: true, xorFields: ['task', 'task'] },
                },
                context
            )
        );
        expect(result.current.errors.xorConfiguration).toBeDefined();
    });
});
