import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useAllDayEvents } from '../useAllDayEvents';
import { useSettings } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';
import logger from '../../utils/logger';

/**
 * W4.4 — שערי הכתיבה של מסלול ה"יומי" (החלטה D5):
 * כש-absenceSource='dayoff' — createSingleAllDayEvent ו-handleUpdateAllDayEvent
 * חסומים (הגנת עומק: ה-UI ממילא מסתיר את תפריט הסוגים), בעוד שזרימת
 * הדיווחים המרובים (createMultipleReports) נשארת פעילה.
 * ברירת המחדל 'tracker' שומרת את ההתנהגות הקיימת אחד-לאחד.
 */

const TEST_SETTINGS = {
    timeReportingBoardId: '2002',
    useCurrentBoardForReporting: false,
    dateColumnId: 'date_col',
    durationColumnId: 'duration_col',
    reporterColumnId: 'reporter_col',
    eventTypeStatusColumnId: 'event_type_col',
    allDayTypeStatusColumnId: 'allday_type_col',
    eventTypeMapping: {
        '0': 'allDay',
        '3': 'billable',
        '101': 'nonBillable'
    },
    eventTypeLabelMeta: {
        '0': { label: 'יומי' },
        '3': { label: 'שעתי' },
        '101': { label: 'שוטף' }
    },
    enableProjectTypeDistinction: false,
    enableApproval: false,
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

const TEST_CONTEXT = {
    boardId: 2002,
    user: { id: '7', name: 'בודק' }
};

// תאריך עבר מובהק — דיווחים מרובים על זמן עתידי מדולגים בכוונה
const PAST_DATE = new Date(2026, 0, 5);

describe('useAllDayEvents — שערי absenceSource (W4.4/D5)', () => {

    let monday;
    let capture;
    let modalsStub;
    let addEvent;
    let resolvePendingEvent;
    let removePendingEvent;
    let showSuccess;
    let warnSpy;

    beforeEach(() => {
        monday = createMondayMock({
            context: TEST_CONTEXT,
            apiResponses: {
                'create_item': { data: { create_item: { id: '999', name: 'Created' } } },
                'change_simple_column_value': { data: { change_simple_column_value: { id: '555' } } },
                'change_multiple_column_values': { data: { change_multiple_column_values: { id: '555' } } }
            }
        });
        capture = createApiPayloadCapture(monday);
        modalsStub = {
            allDayModal: { eventToEdit: null },
            closeAllDayModal: vi.fn()
        };
        addEvent = vi.fn();
        resolvePendingEvent = vi.fn();
        removePendingEvent = vi.fn();
        showSuccess = vi.fn();
        warnSpy = vi.spyOn(logger, 'warn');
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    async function setupHook(settingsOverrides = {}) {
        const { result } = renderHookWithProviders(
            () => ({
                allDay: useAllDayEvents({
                    monday,
                    context: TEST_CONTEXT,
                    modals: modalsStub,
                    showSuccess,
                    showError: vi.fn(),
                    showWarning: vi.fn(),
                    loadEvents: vi.fn(),
                    addEvent,
                    resolvePendingEvent,
                    removePendingEvent,
                    currentViewRange: { start: new Date(2026, 0, 1), end: new Date(2026, 0, 31) }
                }),
                settings: useSettings()
            }),
            {
                monday,
                initialContext: TEST_CONTEXT,
                initialSettings: { ...TEST_SETTINGS, ...settingsOverrides }
            }
        );
        await waitFor(() => {
            expect(result.current.settings.isLoading).toBe(false);
            expect(result.current.settings.customSettings.dateColumnId).toBe('date_col');
        });
        return result;
    }

    describe("absenceSource='dayoff' — מסלולי הכתיבה של היומי חסומים", () => {

        it('יצירת אירוע יומי בודד חסומה: אפס create_item, אפס שלדים, warn אחד', async () => {
            const result = await setupHook({ absenceSource: 'dayoff' });

            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 2,
                    typeLabel: 'Vacation',
                    date: PAST_DATE,
                    durationDays: 3
                });
            });

            expect(capture.findAll(/create_item/)).toHaveLength(0);
            expect(addEvent).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                'createSingleAllDayEvent',
                expect.stringContaining('dayoff')
            );
        });

        it('עדכון תת-סוג של אירוע יומי חסום: אפס מוטציות, המודל לא נסגר, warn אחד', async () => {
            modalsStub.allDayModal.eventToEdit = { mondayItemId: '555' };
            const result = await setupHook({ absenceSource: 'dayoff' });

            await act(async () => {
                await result.current.allDay.handleUpdateAllDayEvent({ index: 1, label: 'Sick' });
            });

            expect(capture.findAll(/change_simple_column_value/)).toHaveLength(0);
            expect(capture.findAll(/change_multiple_column_values/)).toHaveLength(0);
            expect(showSuccess).not.toHaveBeenCalled();
            expect(modalsStub.closeAllDayModal).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                'handleUpdateAllDayEvent',
                expect.stringContaining('dayoff')
            );
        });

        it('זרימת הדיווחים המרובים שורדת: create_item נשלח כרגיל', async () => {
            const result = await setupHook({ absenceSource: 'dayoff' });

            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 'reports',
                    date: PAST_DATE,
                    reports: [{
                        projectId: null,
                        projectName: 'שוטף',
                        hours: '2.00',
                        notes: '',
                        taskId: '',
                        stageId: '',
                        isBillable: false,
                        nonBillableType: ''
                    }]
                });
            });

            expect(capture.findAll(/create_item/)).toHaveLength(1);
            expect(addEvent).toHaveBeenCalledTimes(1);
        });
    });

    describe("absenceSource='tracker' (ברירת מחדל) — ההתנהגות הקיימת נשמרת", () => {

        it('יצירת אירוע יומי בודד עובדת: create_item לכל יום', async () => {
            const result = await setupHook({ absenceSource: 'tracker' });

            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 2,
                    typeLabel: 'Vacation',
                    date: PAST_DATE,
                    durationDays: 2
                });
            });

            expect(capture.findAll(/create_item/)).toHaveLength(2);
            expect(addEvent).toHaveBeenCalledTimes(2);
        });

        it('עדכון תת-סוג עובד: מוטציית שם נשלחת והמודל נסגר', async () => {
            modalsStub.allDayModal.eventToEdit = { mondayItemId: '555' };
            const result = await setupHook({ absenceSource: 'tracker' });

            await act(async () => {
                await result.current.allDay.handleUpdateAllDayEvent({ index: 1, label: 'Sick' });
            });

            expect(capture.findAll(/change_simple_column_value/)).toHaveLength(1);
            expect(showSuccess).toHaveBeenCalledTimes(1);
            expect(modalsStub.closeAllDayModal).toHaveBeenCalledTimes(1);
        });
    });
});
