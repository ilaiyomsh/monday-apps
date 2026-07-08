/**
 * בדיקות Phase 4 (H7) — handleUpdateAllDayEvent: GraphQL soft-error ≠ הצלחה כוזבת.
 *
 * החוזה:
 *  1. כשעדכון שם האירוע (change_simple_column_value) מחזיר soft-error
 *     (status 200 עם res.errors), הפונקציה זורקת ולא מציגה showSuccess.
 *  2. בנתיב הצלחה — showSuccess נקרא והמודל נסגר.
 *
 * חשוב: setupTests ממקה את logger גלובלית; כאן אין צורך ב-logger אמיתי
 * (לא נבדק dedup), אך מאמתים את החוזה דרך showSuccess/showError stubs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useAllDayEvents } from '../useAllDayEvents';
import { useSettings } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';

const TEST_SETTINGS = {
    timeReportingBoardId: '2002',
    useCurrentBoardForReporting: false,
    dateColumnId: 'date_col',
    durationColumnId: 'duration_col',
    endTimeColumnId: 'end_time_col',
    projectColumnId: 'project_col',
    reporterColumnId: 'reporter_col',
    eventTypeStatusColumnId: 'event_type_col',
    allDayTypeStatusColumnId: 'allday_type_col',
    nonBillableStatusColumnId: 'non_billable_col',
    stageColumnId: 'stage_col',
    notesColumnId: 'notes_col',
    eventTypeMapping: { '0': 'allDay', '3': 'billable', '101': 'nonBillable' },
    eventTypeLabelMeta: { '0': { label: 'יומי' } },
    enableProjectTypeDistinction: false,
    enableApproval: false,
    // W4.8 (אינטגרציית Day-off): הסוויטה נועלת את מסלול העדכון הוותיק —
    // הצמדה מפורשת של מקור ההיעדרויות (זהה לברירת המחדל; תחת 'dayoff'
    // שער W4.4 היה חוסם את handleUpdateAllDayEvent שנבדק כאן)
    absenceSource: 'tracker',
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

const TEST_CONTEXT = { boardId: 2002, user: { id: '7', name: 'בודק' } };

const SOFT_ERROR_RESPONSE = {
    errors: [{ message: 'User unauthorized', extensions: { code: 'UserUnauthorizedException' } }]
};

const SUCCESS_RESPONSE = { data: { change_simple_column_value: { id: '555' } } };

describe('useAllDayEvents.handleUpdateAllDayEvent — soft-error (Phase 4 H7)', () => {
    let monday;
    let showSuccess;
    let showError;
    let modalsStub;

    beforeEach(() => {
        showSuccess = vi.fn();
        showError = vi.fn();
        modalsStub = {
            allDayModal: { eventToEdit: { mondayItemId: '555', allDay: true } },
            closeAllDayModal: vi.fn()
        };
    });

    async function setupHook() {
        const { result } = renderHookWithProviders(
            () => ({
                allDay: useAllDayEvents({
                    monday,
                    context: TEST_CONTEXT,
                    modals: modalsStub,
                    showSuccess,
                    showError,
                    showWarning: vi.fn(),
                    loadEvents: vi.fn(),
                    addEvent: vi.fn(),
                    resolvePendingEvent: vi.fn(),
                    removePendingEvent: vi.fn(),
                    currentViewRange: { start: new Date(2026, 4, 1), end: new Date(2026, 4, 31) }
                }),
                settings: useSettings()
            }),
            { monday, initialContext: TEST_CONTEXT, initialSettings: TEST_SETTINGS }
        );
        await waitFor(() => {
            expect(result.current.settings.isLoading).toBe(false);
            expect(result.current.settings.customSettings.dateColumnId).toBe('date_col');
        });
        return result;
    }

    it('soft-error בעדכון השם → זורק ולא מציג showSuccess', async () => {
        monday = createMondayMock({
            context: TEST_CONTEXT,
            apiResponsesByOp: { change_simple_column_value: SOFT_ERROR_RESPONSE }
        });
        const result = await setupHook();

        let thrown;
        await act(async () => {
            try {
                await result.current.allDay.handleUpdateAllDayEvent({ index: 2, label: 'מחלה' });
            } catch (e) {
                thrown = e;
            }
        });

        expect(thrown).toBeTruthy();
        expect(thrown.name).toBe('MondayApiError');
        expect(showSuccess).not.toHaveBeenCalled();
        expect(modalsStub.closeAllDayModal).not.toHaveBeenCalled();
    });

    it('success → showSuccess נקרא והמודל נסגר', async () => {
        monday = createMondayMock({
            context: TEST_CONTEXT,
            apiResponsesByOp: {
                change_simple_column_value: SUCCESS_RESPONSE,
                change_multiple_column_values: { data: { change_multiple_column_values: { id: '555' } } }
            }
        });
        const result = await setupHook();

        await act(async () => {
            await result.current.allDay.handleUpdateAllDayEvent({ index: 2, label: 'מחלה' });
        });

        expect(showSuccess).toHaveBeenCalled();
        expect(modalsStub.closeAllDayModal).toHaveBeenCalled();
    });
});
