import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsDialog from '../SettingsDialog';

// Mock child tabs to prevent heavy rendering
vi.mock('../StructureTab', () => ({
    default: () => <div data-testid="structure-tab">StructureTab</div>,
}));
vi.mock('../MappingTab', () => ({
    default: () => <div data-testid="mapping-tab">MappingTab</div>,
}));
vi.mock('../AdditionalTab', () => ({
    default: () => <div data-testid="additional-tab">AdditionalTab</div>,
}));
vi.mock('../CalendarTab', () => ({
    default: () => <div data-testid="calendar-tab">CalendarTab</div>,
}));

vi.mock('../../Toast', () => ({ ToastContainer: () => null }));
vi.mock('../../ErrorDetailsModal/ErrorDetailsModal', () => ({ default: () => null }));
vi.mock('../../ConfirmDialog/ConfirmDialog', () => ({ default: () => null }));

// Mock validation hook to cut heavy dependency chain
vi.mock('../useSettingsValidation', () => ({
    useSettingsValidation: () => ({
        errors: {},
        isValid: true,
        getFieldError: () => null,
        getMissingFieldsMessage: () => null,
    }),
}));

vi.mock('../../../hooks/useToast', () => ({
    useToast: () => ({
        showErrorWithDetails: vi.fn(),
        showSuccess: vi.fn(),
        toasts: [],
        removeToast: vi.fn(),
        errorDetailsModal: null,
        openErrorDetailsModal: vi.fn(),
        closeErrorDetailsModal: vi.fn(),
    }),
}));

// Mock logger to prevent side effects
vi.mock('../../../utils/logger', () => ({
    default: {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
        api: vi.fn(), apiResponse: vi.fn(), apiError: vi.fn(),
        functionStart: vi.fn(), functionEnd: vi.fn(),
    },
}));

const mockCustomSettings = {
    structureMode: 'PROJECT_ONLY',
    fieldConfig: { task: 'hidden', stage: 'hidden', notes: 'hidden', billableToggle: 'visible', nonBillableType: 'required' },
    showTemporaryEvents: true, enableApproval: false,
    editLockMode: 'none', lockAfterApproval: false,
    monthlyHoursTarget: 182.5, weeklyHoursTarget: null, workdayLength: 8.5,
    useCurrentBoardForReporting: true, connectedBoardId: 'board1', peopleColumnIds: ['person1'],
};

vi.mock('../../../contexts/SettingsContext', () => ({
    FIELD_MODES: { REQUIRED: 'required', OPTIONAL: 'optional', HIDDEN: 'hidden' },
    TOGGLE_MODES: { VISIBLE: 'visible', HIDDEN: 'hidden' },
    DEFAULT_FIELD_CONFIG: { task: 'hidden', stage: 'hidden', notes: 'hidden', billableToggle: 'visible', nonBillableType: 'required' },
    useSettings: () => ({
        customSettings: mockCustomSettings,
        updateSettings: vi.fn().mockResolvedValue(true),
    }),
}));

const mockMonday = {
    api: vi.fn().mockResolvedValue({ data: { boards: [] } }),
};
const mockContext = { boardId: '12345' };

describe('SettingsDialog — ניווט בין הטאבים', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    const renderDialog = async (onClose = vi.fn()) => {
        let result;
        await act(async () => {
            result = render(<SettingsDialog monday={mockMonday} onClose={onClose} context={mockContext} />);
        });
        return { ...result, onClose };
    };

    it('מציג את כל הטאבים', async () => {
        await renderDialog();
        expect(screen.getByText('1. מבנה דיווח')).toBeInTheDocument();
        expect(screen.getByText('2. מיפוי נתונים')).toBeInTheDocument();
        expect(screen.getByText('3. הגדרות נוספות')).toBeInTheDocument();
        expect(screen.getByText('4. הגדרות יומן')).toBeInTheDocument();
    });

    it('טאב 1 פעיל בפתיחה — מרנדר StructureTab', async () => {
        await renderDialog();
        expect(screen.getByTestId('structure-tab')).toBeInTheDocument();
        expect(screen.getByText('ביטול')).toBeInTheDocument();
        expect(screen.getByText(/הבא.*מיפוי נתונים/)).toBeInTheDocument();
    });

    it('ניווט הבא עובר בין כל הטאבים', async () => {
        const user = userEvent.setup();
        await renderDialog();

        await user.click(screen.getByText(/הבא.*מיפוי נתונים/));
        expect(screen.getByTestId('mapping-tab')).toBeInTheDocument();

        await user.click(screen.getByText(/הבא.*הגדרות נוספות/));
        expect(screen.getByTestId('additional-tab')).toBeInTheDocument();

        await user.click(screen.getByText(/הבא.*הגדרות יומן/));
        expect(screen.getByTestId('calendar-tab')).toBeInTheDocument();
        expect(screen.getByText('שמור הגדרות')).toBeInTheDocument();
    });

    it('ביטול סוגר את הדיאלוג', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        await act(async () => {
            render(<SettingsDialog monday={mockMonday} onClose={onClose} context={mockContext} />);
        });
        await user.click(screen.getByText('ביטול'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('לחיצה ישירה על טאב יומן מעבירה אליו', async () => {
        const user = userEvent.setup();
        await renderDialog();
        await user.click(screen.getByText('4. הגדרות יומן'));
        expect(screen.getByTestId('calendar-tab')).toBeInTheDocument();
        expect(screen.getByText('שמור הגדרות')).toBeInTheDocument();
    });

    it('ניווט אחורה מטאב יומן חוזר לטאב הקודם', async () => {
        const user = userEvent.setup();
        await renderDialog();
        await user.click(screen.getByText('4. הגדרות יומן'));
        expect(screen.getByTestId('calendar-tab')).toBeInTheDocument();
        await user.click(screen.getByText(/חזרה.*הגדרות נוספות/));
        expect(screen.getByTestId('additional-tab')).toBeInTheDocument();
    });
});
