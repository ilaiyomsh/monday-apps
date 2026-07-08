import { describe, it, expect, vi, beforeEach } from 'vitest';

import { validateSettings, formatValidationMessage } from '../settingsValidator';
import { STRUCTURE_MODES, DEFAULT_FIELD_CONFIG } from '../../contexts/SettingsContext';


vi.mock('../../contexts/SettingsContext', () => ({
    STRUCTURE_MODES: {
        PROJECT_ONLY: 'project_only',
        PROJECT_WITH_STAGE: 'project_with_stage',
        PROJECT_WITH_TASKS: 'project_with_tasks',
        PROJECT_WITH_TASKS_AND_STAGE: 'project_with_tasks_and_stage'
    },
    FIELD_MODES: {
        REQUIRED: 'required',
        OPTIONAL: 'optional',
        HIDDEN: 'hidden'
    },
    TOGGLE_MODES: {
        VISIBLE: 'visible',
        HIDDEN: 'hidden'
    },
    DEFAULT_FIELD_CONFIG: {
        task: 'hidden',
        stage: 'hidden',
        notes: 'hidden',
        billableToggle: 'visible',
        nonBillableType: 'required'
    }
}));

// fieldConfig מתאים ל-structureMode (לתאימות בטסטים)
const fieldConfigForMode = (mode) => {
    const fc = { ...DEFAULT_FIELD_CONFIG };
    if (mode === STRUCTURE_MODES.PROJECT_WITH_TASKS) {
        fc.task = 'required';
    } else if (mode === STRUCTURE_MODES.PROJECT_WITH_STAGE) {
        fc.stage = 'required';
    }
    return fc;
};

describe('settingsValidator', () => {

    // === formatValidationMessage ===

    describe('formatValidationMessage', () => {
        it('מחזיר null כשהאימות תקין', () => {
            expect(formatValidationMessage({ isValid: true })).toBeNull();
        });

        it('מציג הגדרות חסרות', () => {
            const result = formatValidationMessage({
                isValid: false,
                missingSettings: [
                    { key: 'dateColumnId', label: 'עמודת תאריך התחלה' },
                    { key: 'projectColumnId', label: 'עמודת פרויקט' }
                ],
                missingBoards: [],
                missingColumns: []
            });

            expect(result).toContain('הגדרות חסרות');
            expect(result).toContain('עמודת תאריך התחלה');
            expect(result).toContain('עמודת פרויקט');
        });

        it('מציג לוחות לא נמצאו', () => {
            const result = formatValidationMessage({
                isValid: false,
                missingSettings: [],
                missingBoards: [
                    { key: 'connectedBoardId', label: 'לוח פרויקטים', boardId: '123' }
                ],
                missingColumns: []
            });

            expect(result).toContain('לוחות לא נמצאו');
            expect(result).toContain('לוח פרויקטים');
        });

        it('מציג עמודות לא נמצאו', () => {
            const result = formatValidationMessage({
                isValid: false,
                missingSettings: [],
                missingBoards: [],
                missingColumns: [
                    { columnId: 'col1', settingKey: 'dateColumnId', label: 'עמודת תאריך התחלה' }
                ]
            });

            expect(result).toContain('עמודות לא נמצאו בלוח');
            expect(result).toContain('עמודת תאריך התחלה');
        });

        it('מציג שילוב של כל סוגי הבעיות', () => {
            const result = formatValidationMessage({
                isValid: false,
                missingSettings: [{ key: 'a', label: 'הגדרה א' }],
                missingBoards: [{ key: 'b', label: 'לוח ב', boardId: '1' }],
                missingColumns: [{ columnId: 'c', settingKey: 'd', label: 'עמודה ג' }]
            });

            expect(result).toContain('הגדרות חסרות');
            expect(result).toContain('לוחות לא נמצאו');
            expect(result).toContain('עמודות לא נמצאו בלוח');
        });
    });

    // === validateSettings ===

    describe('validateSettings', () => {
        let mockMonday;

        beforeEach(() => {
            mockMonday = {
                api: vi.fn().mockResolvedValue({
                    data: {
                        boards: [{
                            id: '123',
                            name: 'Test Board',
                            columns: [
                                { id: 'date_col', title: 'Date' },
                                { id: 'end_col', title: 'End' },
                                { id: 'dur_col', title: 'Duration' },
                                { id: 'proj_col', title: 'Project' },
                                { id: 'rep_col', title: 'Reporter' },
                                { id: 'type_col', title: 'Type' },
                                { id: 'temp_col', title: 'Temporary' },
                                { id: 'allday_col', title: 'AllDayType' },
                                { id: 'notes_col', title: 'Notes' }
                            ]
                        }]
                    }
                })
            };
        });

        it('מחזיר isValid=false כשאין settings', async () => {
            const result = await validateSettings(mockMonday, null, '123');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('לא נמצאו הגדרות מותאמות');
        });

        it('מחזיר isValid=true כשכל ההגדרות תקינות', async () => {
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col',
                connectedBoardId: '456'
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('מזהה הגדרות חסרות', async () => {
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
                // חסרים: dateColumnId, endTimeColumnId, durationColumnId, projectColumnId, reporterColumnId
                connectedBoardId: '456'
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.isValid).toBe(false);
            expect(result.missingSettings.length).toBeGreaterThan(0);
        });

        it('דורש tasksBoardId ו-taskColumnId במצב PROJECT_WITH_TASKS', async () => {
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_WITH_TASKS,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_WITH_TASKS),
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col',
                connectedBoardId: '456'
                // חסרים: tasksBoardId, taskColumnId
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.isValid).toBe(false);
            const missingKeys = result.missingSettings.map(s => s.key);
            expect(missingKeys).toContain('tasksBoardId');
            expect(missingKeys).toContain('taskColumnId');
        });

        it('דורש stageColumnId במצב PROJECT_WITH_STAGE', async () => {
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_WITH_STAGE,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_WITH_STAGE),
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col',
                connectedBoardId: '456'
                // חסר: stageColumnId
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.isValid).toBe(false);
            const missingKeys = result.missingSettings.map(s => s.key);
            expect(missingKeys).toContain('stageColumnId');
        });

        it('לא דורש connectedBoardId במצב Assignments', async () => {
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
                useAssignmentsMode: true,
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col'
            };

            const result = await validateSettings(mockMonday, settings, '123');
            // לא צריך connectedBoardId, אז ההגדרות הנדרשות תקינות
            expect(result.missingSettings.find(s => s.key === 'connectedBoardId')).toBeUndefined();
        });

        it('מזהה לוח פרויקטים שלא קיים', async () => {
            mockMonday.api.mockResolvedValue({
                data: { boards: [] } // לוח לא נמצא
            });

            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                connectedBoardId: '999'
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.isValid).toBe(false);
            expect(result.missingBoards.length).toBeGreaterThan(0);
        });

        it('מזהה עמודות חסרות בלוח', async () => {
            // הלוח מחזיר רק חלק מהעמודות
            mockMonday.api.mockResolvedValue({
                data: {
                    boards: [{
                        id: '123',
                        name: 'Test Board',
                        columns: [
                            { id: 'date_col', title: 'Date' }
                            // חסרות: end_col, dur_col, proj_col, rep_col
                        ]
                    }]
                }
            });

            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col',
                connectedBoardId: '456'
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.isValid).toBe(false);
            expect(result.missingColumns.length).toBeGreaterThan(0);
        });

        it('מוסיף אזהרה כשאין eventTypeStatusColumnId', async () => {
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col',
                connectedBoardId: '456'
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.warnings.some(w => w.includes('סוג דיווח'))).toBe(true);
        });

        it('מוסיף אזהרה כשיש eventTypeStatus אבל אין mapping', async () => {
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col',
                connectedBoardId: '456',
                eventTypeStatusColumnId: 'type_col'
                // חסר: eventTypeMapping
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.warnings.some(w => w.includes('מיפוי סוגי דיווח'))).toBe(true);
        });

        it('מוסיף אזהרה כש-notes פעיל ללא notesColumnId', async () => {
            const fc = fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY);
            fc.notes = 'optional';
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fc,
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col',
                connectedBoardId: '456'
                // חסר: notesColumnId
            };

            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.warnings.some(w => w.includes('הערות'))).toBe(true);
        });

        it('לא בודק עמודות אם אין currentBoardId', async () => {
            const settings = {
                structureMode: STRUCTURE_MODES.PROJECT_ONLY,
                fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
                dateColumnId: 'date_col',
                endTimeColumnId: 'end_col',
                durationColumnId: 'dur_col',
                projectColumnId: 'proj_col',
                reporterColumnId: 'rep_col',
                temporaryCheckboxColumnId: 'temp_col',
                allDayTypeStatusColumnId: 'allday_col',
                connectedBoardId: '456'
            };

            const result = await validateSettings(mockMonday, settings, null);
            // ללא currentBoardId, לא בודק עמודות - רק הגדרות
            expect(result.missingColumns).toHaveLength(0);
        });
    });

    // === מקור היעדרויות Day-off (W4.5) ===

    describe('validateSettings — מקור היעדרויות Day-off (W4.5)', () => {
        let mockMonday;

        // לוח דיווחים (123) ולוח חופשות (789) — תשובות לפי הלוח שבשאילתה
        const reportingBoard = {
            id: '123',
            name: 'Test Board',
            columns: [
                { id: 'date_col', title: 'Date' },
                { id: 'end_col', title: 'End' },
                { id: 'dur_col', title: 'Duration' },
                { id: 'proj_col', title: 'Project' },
                { id: 'rep_col', title: 'Reporter' },
                { id: 'temp_col', title: 'Temporary' },
                { id: 'allday_col', title: 'AllDayType' }
            ]
        };
        const dayOffBoard = {
            id: '789',
            name: 'Vacations',
            columns: [
                { id: 'do_person', title: 'Person' },
                { id: 'do_start', title: 'Start' },
                { id: 'do_end', title: 'End' },
                { id: 'do_kind', title: 'Kind' },
                { id: 'do_type', title: 'Type' },
                { id: 'do_approval', title: 'Approval' }
            ]
        };

        beforeEach(() => {
            mockMonday = {
                api: vi.fn().mockImplementation((query) => {
                    if (query.includes('789')) {
                        return Promise.resolve({ data: { boards: [dayOffBoard] } });
                    }
                    return Promise.resolve({ data: { boards: [reportingBoard] } });
                })
            };
        });

        // בסיס תקין של לוח הדיווחים — ללא allDayTypeStatusColumnId (נושא הבדיקה)
        const reportingBase = {
            structureMode: STRUCTURE_MODES.PROJECT_ONLY,
            fieldConfig: fieldConfigForMode(STRUCTURE_MODES.PROJECT_ONLY),
            dateColumnId: 'date_col',
            endTimeColumnId: 'end_col',
            durationColumnId: 'dur_col',
            projectColumnId: 'proj_col',
            reporterColumnId: 'rep_col',
            temporaryCheckboxColumnId: 'temp_col',
            connectedBoardId: '456'
        };

        // מיפוי Day-off מלא ותקין
        const fullDayOffMapping = {
            absenceSource: 'dayoff',
            dayOffBoardId: '789',
            dayOffPersonColumnId: 'do_person',
            dayOffStartDateColumnId: 'do_start',
            dayOffEndDateColumnId: 'do_end',
            dayOffKindColumnId: 'do_kind',
            dayOffKindGeneralLabelId: '1',
            dayOffKindPersonalLabelId: '2',
            dayOffTypeColumnId: 'do_type'
        };

        it('ברירת מחדל (ללא absenceSource) — allDayTypeStatusColumnId עדיין חובה', async () => {
            const result = await validateSettings(mockMonday, { ...reportingBase }, '123');
            expect(result.isValid).toBe(false);
            const missingKeys = result.missingSettings.map(s => s.key);
            expect(missingKeys).toContain('allDayTypeStatusColumnId');
        });

        it("absenceSource='tracker' — allDayTypeStatusColumnId חובה", async () => {
            const result = await validateSettings(mockMonday, { ...reportingBase, absenceSource: 'tracker' }, '123');
            const missingKeys = result.missingSettings.map(s => s.key);
            expect(missingKeys).toContain('allDayTypeStatusColumnId');
        });

        it("absenceSource='dayoff' — allDayTypeStatusColumnId כבר לא חובה", async () => {
            const result = await validateSettings(mockMonday, { ...reportingBase, ...fullDayOffMapping }, '123');
            const missingKeys = result.missingSettings.map(s => s.key);
            expect(missingKeys).not.toContain('allDayTypeStatusColumnId');
        });

        it("absenceSource='dayoff' ללא מיפוי — דורש את לוח החופשות וכל העמודות הקריטיות", async () => {
            const result = await validateSettings(mockMonday, { ...reportingBase, absenceSource: 'dayoff' }, '123');
            expect(result.isValid).toBe(false);
            const missingKeys = result.missingSettings.map(s => s.key);
            expect(missingKeys).toContain('dayOffBoardId');
            expect(missingKeys).toContain('dayOffPersonColumnId');
            expect(missingKeys).toContain('dayOffStartDateColumnId');
            expect(missingKeys).toContain('dayOffEndDateColumnId');
            expect(missingKeys).toContain('dayOffKindColumnId');
            expect(missingKeys).toContain('dayOffTypeColumnId');
            // עמודת האישור לא נדרשת כשמדיניות האישור כבויה (D2)
            expect(missingKeys).not.toContain('dayOffApprovalColumnId');
        });

        it("absenceSource='dayoff' עם מיפוי מלא — תקין", async () => {
            const result = await validateSettings(mockMonday, { ...reportingBase, ...fullDayOffMapping }, '123');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('עמודת קינד ללא תוויות כללי/אישי — נדרשות', async () => {
            const settings = {
                ...reportingBase,
                ...fullDayOffMapping,
                dayOffKindGeneralLabelId: null,
                dayOffKindPersonalLabelId: null
            };
            const result = await validateSettings(mockMonday, settings, '123');
            expect(result.isValid).toBe(false);
            const missingKeys = result.missingSettings.map(s => s.key);
            expect(missingKeys).toContain('dayOffKindGeneralLabelId');
            expect(missingKeys).toContain('dayOffKindPersonalLabelId');
        });

        it('מדיניות אישור פעילה (D2) — עמודת אישור ותוויות הופכות חובה', async () => {
            const withoutColumn = await validateSettings(
                mockMonday,
                { ...reportingBase, ...fullDayOffMapping, dayOffApprovalRequired: true },
                '123'
            );
            expect(withoutColumn.isValid).toBe(false);
            expect(withoutColumn.missingSettings.map(s => s.key)).toContain('dayOffApprovalColumnId');

            const withoutLabels = await validateSettings(
                mockMonday,
                {
                    ...reportingBase,
                    ...fullDayOffMapping,
                    dayOffApprovalRequired: true,
                    dayOffApprovalColumnId: 'do_approval',
                    dayOffApprovedLabelIds: [],
                    dayOffPendingLabelIds: []
                },
                '123'
            );
            expect(withoutLabels.isValid).toBe(false);
            const missingKeys = withoutLabels.missingSettings.map(s => s.key);
            expect(missingKeys).toContain('dayOffApprovedLabelIds');
            expect(missingKeys).toContain('dayOffPendingLabelIds');
        });

        it('מדיניות אישור פעילה עם מיפוי מלא — תקין', async () => {
            const result = await validateSettings(
                mockMonday,
                {
                    ...reportingBase,
                    ...fullDayOffMapping,
                    dayOffApprovalRequired: true,
                    dayOffApprovalColumnId: 'do_approval',
                    dayOffApprovedLabelIds: ['1'],
                    dayOffPendingLabelIds: ['0']
                },
                '123'
            );
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('לוח חופשות שלא קיים — נכשל ברעש', async () => {
            mockMonday.api.mockImplementation((query) => {
                if (query.includes('999')) {
                    return Promise.resolve({ data: { boards: [] } });
                }
                return Promise.resolve({ data: { boards: [reportingBoard] } });
            });

            const result = await validateSettings(
                mockMonday,
                { ...reportingBase, ...fullDayOffMapping, dayOffBoardId: '999' },
                '123'
            );
            expect(result.isValid).toBe(false);
            expect(result.missingBoards.map(b => b.key)).toContain('dayOffBoardId');
        });

        it('עמודה שהוגדרה אך לא קיימת בלוח החופשות — מזוהה', async () => {
            const result = await validateSettings(
                mockMonday,
                { ...reportingBase, ...fullDayOffMapping, dayOffKindColumnId: 'deleted_col' },
                '123'
            );
            expect(result.isValid).toBe(false);
            const missingColKeys = result.missingColumns.map(c => c.settingKey);
            expect(missingColKeys).toContain('dayOffKindColumnId');
        });

        it("absenceSource='tracker' — מיפוי dayOff חלקי אינו חוסם", async () => {
            const result = await validateSettings(
                mockMonday,
                {
                    ...reportingBase,
                    allDayTypeStatusColumnId: 'allday_col',
                    absenceSource: 'tracker',
                    dayOffBoardId: '789'
                },
                '123'
            );
            expect(result.isValid).toBe(true);
            expect(result.missingSettings.map(s => s.key).filter(k => k.startsWith('dayOff'))).toHaveLength(0);
        });
    });
});
