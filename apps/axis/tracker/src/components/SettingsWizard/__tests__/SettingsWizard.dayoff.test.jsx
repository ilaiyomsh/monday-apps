import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import SettingsWizard from '../SettingsWizard';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { createMondayMock } from '../../../test-utils/mondayMock';
import { useSettings } from '../../../contexts/SettingsContext';
import { t } from '../../../i18n';

/**
 * W4.6 — חיווט האשף: absenceSource מגיע מההגדרות הקיימות (SettingsContext),
 * לא משאלות האשף, ומועבר ל-builder.build כדי שיצירת עמודת All-day Type
 * תהיה מותנית בו. ברירת המחדל 'tracker' שומרת התנהגות קיימת אחד-לאחד.
 */

// מבודדים את האשף מה-builder האמיתי — בודקים רק את החיווט
const { buildMock } = vi.hoisted(() => ({ buildMock: vi.fn() }));
vi.mock('../useBoardBuilder', () => ({
    useBoardBuilder: () => ({
        build: buildMock,
        progress: [],
        running: false,
        result: null,
        error: null
    })
}));

const TEST_CONTEXT = {
    boardId: 100,
    instanceId: 'wizard-dayoff-test',
    user: { id: '7', name: 'Tester', currentLanguage: 'he' }
};

// probe קטן שמסמן מתי ה-SettingsProvider סיים לטעון את ההגדרות מה-storage —
// בלעדיו לחיצת ההתקנה עלולה לרוץ לפני שה-absenceSource שנזרע נטען (race).
const SettingsLoadProbe = () => {
    const { isLoading } = useSettings();
    return <div data-testid="settings-load-state">{isLoading ? 'loading' : 'ready'}</div>;
};

const renderWizardAndInstall = async (initialSettings) => {
    const monday = createMondayMock({ context: TEST_CONTEXT });
    renderWithProviders(
        <>
            <SettingsLoadProbe />
            <SettingsWizard monday={monday} context={TEST_CONTEXT} mode="reRun" onClose={() => {}} />
        </>,
        { monday, initialContext: TEST_CONTEXT, initialSettings }
    );

    // ממתינים שההגדרות שנזרעו ייטענו בפועל לפני ההתקנה
    await waitFor(() => {
        expect(screen.getByTestId('settings-load-state')).toHaveTextContent('ready');
    });

    // reRun מתחיל בשלב השאלות → "הבא" → שלב ההתקנה → כפתור היצירה
    fireEvent.click(screen.getByRole('button', { name: t('wizard.next') }));
    fireEvent.click(await screen.findByRole('button', { name: t('wizard.steps.install.createButton') }));

    await waitFor(() => {
        expect(buildMock).toHaveBeenCalledTimes(1);
    });
    return buildMock.mock.calls[0][0];
};

describe('SettingsWizard — חיווט absenceSource אל ה-builder (W4.6)', () => {

    beforeEach(() => {
        buildMock.mockReset().mockResolvedValue({ timeReportingBoardId: 'b1' });
    });

    it("absenceSource='dayoff' בהגדרות הקיימות מועבר ל-build (העמודה תדולג)", async () => {
        const buildArgs = await renderWizardAndInstall({
            absenceSource: 'dayoff',
            lastModifiedAt: '2026-01-01T00:00:00.000Z'
        });

        expect(buildArgs.absenceSource).toBe('dayoff');
        // תשובות האשף עצמן שורדות את המיזוג
        expect(buildArgs.source).toBe('board');
    });

    it("ללא absenceSource שמור — ברירת המחדל 'tracker' מועברת ל-build (התנהגות קיימת)", async () => {
        const buildArgs = await renderWizardAndInstall({
            lastModifiedAt: '2026-01-01T00:00:00.000Z'
        });

        expect(buildArgs.absenceSource).toBe('tracker');
    });
});
