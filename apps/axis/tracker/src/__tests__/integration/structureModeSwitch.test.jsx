/* global globalThis */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, waitFor, screen, act } from '@testing-library/react';
import { renderCalendar } from '../../test-utils/renderCalendar';

/**
 * Integration test 2.1.5 — flow מעבר בין מצבי מבנה (StructureTab → MappingTab):
 *   פתיחת SettingsDialog → MappingTab לא מציג את שדה "עמודת סיווג - פרויקטים"
 *   כש-fieldConfig.stage === HIDDEN → חזרה ל-StructureTab → לחיצה על "חובה"
 *   ב-stage → MappingTab כעת מציג את שדה ה-stageColumnId.
 *
 * החוזה: ה-toggle של structure mode (stage hidden → stage required, שמתרגם
 * ל-STRUCTURE_MODES.PROJECT_ONLY → STRUCTURE_MODES.PROJECT_WITH_STAGE דרך
 * ה-legacy sync ב-StructureTab.handleFieldModeChange) מפעיל את ה-FieldWrapper
 * של עמודת הסיווג ב-MappingTab. הטסט נוגע ב-DOM הנראה למשתמש (טקסטים +
 * radios) ולא בשמות פנימיים — ישרוד פירוק god-files ב-Wave 4.
 *
 * הערת יישום: שדה ה-stage נמצא בתוך AccordionSection "לוח דיווחי שעות"
 * שסגור כברירת מחדל. בנוסף, MappingTab מבצע fetches בעלייה (fetchPeopleColumns
 * וחבריו) שגורמים ל-re-mount בזמן הטעינה — לכן צריך לרענן את ה-reference
 * לכפתור האקורדיון מיד לפני הלחיצה ולוודא שהאקורדיון אכן נפתח.
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

// canvas-confetti — אותה הגנה כמו ב-2.1.1/2.1.2/2.1.3/2.1.4 (ה-rAF callback
// נוגע ב-canvas שלא קיים ב-jsdom).
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
});

describe('Integration — structure mode switch (2.1.5)', () => {
    it('הפעלת stage ב-StructureTab גורמת ל-MappingTab להציג את שדה עמודת הסיווג', async () => {
        // Seed: stage hidden — מתורגם ל-STRUCTURE_MODES.PROJECT_ONLY.
        // override של `boards` op כדי לתת ל-useBoardOwner תשובה שכוללת את
        // ה-current user (id 7) כ-owner. ללא זה, כפתור ההגדרות לא נרנדר
        // ב-CalendarToolbar (isOwner=false → הכפתור הוא null).
        const { container } = await renderCalendar({
            apiResponsesByOp: {
                boards: (query) => {
                    if (typeof query === 'string' && query.includes('owners')) {
                        return { data: { boards: [{ id: '100', owners: [{ id: '7' }] }] } };
                    }
                    // ברירת מחדל defensive — מבנה ריק עם cursor: null.
                    return {
                        data: {
                            boards: [{
                                id: '100',
                                items_page: { cursor: null, items: [] },
                                columns: []
                            }]
                        }
                    };
                }
            }
        });

        // פותחים את ה-SettingsDialog דרך ה-CalendarToolbar (כפתור הגדרות,
        // aria-label "הגדרות"). lastModifiedAt מאוכלס ב-seed → SettingsDialog
        // (ולא SettingsWizard) נטען.
        const settingsBtn = await screen.findByLabelText('הגדרות');
        fireEvent.click(settingsBtn);

        // SettingsDialog נטען lazy — ממתינים שטאב המבנה יופיע.
        await screen.findByText('1. מבנה דיווח', {}, { timeout: 10000 });

        // עזר: לוחץ על כותרת אקורדיון "לוח דיווחי שעות" עד שהוא נפתח.
        // ה-MappingTab מבצע fetches בעלייה ונערך מחדש בזמן ה-loading ⇒
        // reference ישן לכפתור עלול להיות detached. waitFor מרענן את
        // ה-reference בכל איטרציה ובודק את [class*="accordionOpen"].
        const clickTimesheetAccordion = async () => {
            await waitFor(async () => {
                const header = await screen.findByText('לוח דיווחי שעות');
                const btn = header.closest('button');
                if (!btn || !document.body.contains(btn)) {
                    throw new Error('timesheet accordion button not yet attached');
                }
                await act(async () => {
                    fireEvent.click(btn);
                });
                if (!document.querySelector('[class*="accordionOpen"]')) {
                    throw new Error('accordion not yet open');
                }
            }, { timeout: 15000, interval: 100 });
        };

        // (1) מעבר ל-MappingTab ופתיחת אקורדיון "לוח דיווחי שעות".
        //     אסור שיופיע שדה עמודת הסיווג כש-stage hidden.
        fireEvent.click(screen.getByText('2. מיפוי נתונים'));
        await clickTimesheetAccordion();
        expect(screen.queryByText('עמודת סיווג - פרויקטים')).toBeNull();

        // (2) חזרה ל-StructureTab ולחיצה על "חובה" עבור שדה stage.
        //     ה-radio ב-StructureTab.renderFieldRow:
        //         name="field_stage" value="required"
        //     handleFieldModeChange מסנכרן structureMode ל-PROJECT_WITH_STAGE
        //     דרך ה-legacy mapping שב-StructureTab.
        fireEvent.click(screen.getByText('1. מבנה דיווח'));
        const stageRequiredRadio = await waitFor(() => {
            const el = container.querySelector('input[name="field_stage"][value="required"]');
            if (!el) throw new Error('radio field_stage[required] not in DOM yet');
            return el;
        }, { timeout: 10000 });
        await act(async () => {
            fireEvent.click(stageRequiredRadio);
        });

        // אימות שה-state אכן התעדכן — ה-radio סומן ו-hidden אינו מסומן.
        expect(stageRequiredRadio.checked).toBe(true);
        const stageHiddenRadio = container.querySelector('input[name="field_stage"][value="hidden"]');
        expect(stageHiddenRadio.checked).toBe(false);

        // (3) חזרה ל-MappingTab — האקורדיון מתאפס (openSection הוא state
        //     מקומי של MappingTab שמתאפס ב-remount). שדה עמודת הסיווג
        //     חייב להופיע כעת בפנים.
        fireEvent.click(screen.getByText('2. מיפוי נתונים'));
        await clickTimesheetAccordion();

        await waitFor(() => {
            expect(screen.getByText('עמודת סיווג - פרויקטים')).toBeInTheDocument();
        }, { timeout: 15000 });
    }, 60000);
});
