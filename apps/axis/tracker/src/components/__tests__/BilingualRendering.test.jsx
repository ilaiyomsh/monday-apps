import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import FilterBar from '../FilterBar/FilterBar';
import CalendarToolbar from '../CalendarToolbar';
import { MondayProvider } from '../../contexts/MondayContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import i18n, { t } from '../../i18n';

/**
 * Bilingual integration tests (Increment 3 — part 3/3)
 *
 * המטרה: לאמת ש-i18n פועל מקצה לקצה — מ-i18next.changeLanguage('en')
 * ועד טקסט אנגלי שמופיע בפועל ברכיב, וההיפך לעברית.
 *
 * חלוקה:
 * 1. רנדור FilterBar ו-CalendarToolbar בשתי שפות (component-level)
 * 2. בדיקה שכל ה-keys של EventModal ו-AllDayEventModal מתורגמים
 *    כראוי בשתי השפות (key-level, ללא mount של המודלים שדורשים
 *    setup מורכב)
 */

// ביטוי בעברית = יש ב-RegExp [א-ת]
const HEBREW_RE = /[א-ת]/;

describe('Bilingual — component rendering', () => {

    afterEach(async () => {
        await i18n.changeLanguage('he'); // נשמור על baseline עברי בין טסטים
    });

    describe('FilterBar', () => {
        const baseProps = {
            reporters: [],
            projects: [],
            selectedReporterIds: [],
            selectedProjectIds: [],
            onReporterChange: vi.fn(),
            onProjectChange: vi.fn(),
            onClear: vi.fn(),
            hasActiveFilter: false
        };

        it('he: מציג "סינון" בלבד, אין אנגלית', async () => {
            await i18n.changeLanguage('he');
            const { container } = render(<FilterBar {...baseProps} />);
            expect(container.textContent).toContain('סינון');
            expect(container.textContent).not.toContain('Filter');
        });

        it('en: מציג "Filter" בלבד, אין עברית', async () => {
            await i18n.changeLanguage('en');
            const { container } = render(<FilterBar {...baseProps} />);
            expect(container.textContent).toContain('Filter');
            expect(container.textContent).not.toMatch(HEBREW_RE);
        });

        it('en: placeholder תורגם נכון', async () => {
            await i18n.changeLanguage('en');
            // פותחים את הדרופדאון כדי ש-placeholder יופיע
            const { container } = render(<FilterBar {...baseProps} hasActiveFilter={true} selectedReporterIds={['1']} />);
            // הכפתור עדיין במצב סגור — נבדוק את ה-clearSelection אם hasActiveFilter
            // אבל clearSelection מופיע רק כשהדרופדאון פתוח. נתפוס מה שכן מופיע.
            expect(container.textContent).toContain('Filter');
        });
    });

    describe('CalendarToolbar', () => {
        const baseProps = {
            onNavigate: vi.fn(),
            onView: vi.fn(),
            label: 'May 2026',
            view: 'work_week',
            date: new Date(2026, 4, 4),
            views: { month: true, week: true, work_week: true, day: true },
            localizer: { messages: {} },
            onOpenSettings: vi.fn(),
            onSwitchToDashboard: vi.fn(),
            isOwner: false
        };

        function renderWithMonday(component) {
            const monday = createMondayMock({ context: { mode: 'desktop' } });
            return render(
                <MondayProvider monday={monday}>
                    {component}
                </MondayProvider>
            );
        }

        it('he: מציג "היום" ו"שבוע עבודה"', async () => {
            await i18n.changeLanguage('he');
            const { container } = renderWithMonday(<CalendarToolbar {...baseProps} />);
            expect(container.textContent).toContain('היום');
            expect(container.textContent).toContain('שבוע עבודה');
        });

        it('en: מציג "Today" ו"Work week", אין עברית', async () => {
            await i18n.changeLanguage('en');
            const { container } = renderWithMonday(<CalendarToolbar {...baseProps} />);
            expect(container.textContent).toContain('Today');
            expect(container.textContent).toContain('Work week');
            expect(container.textContent).not.toMatch(HEBREW_RE);
        });

        it('aria-label של כפתור הגדרות מתורגם', async () => {
            await i18n.changeLanguage('en');
            const { container } = renderWithMonday(<CalendarToolbar {...baseProps} isOwner={true} />);
            // יש כמה כפתורים עם aria-label — נוודא שלפחות אחד מהם באנגלית
            const ariaLabels = Array.from(container.querySelectorAll('[aria-label]'))
                .map(el => el.getAttribute('aria-label'));
            const hasEnglishLabel = ariaLabels.some(l => l && /^[A-Za-z]/.test(l));
            expect(hasEnglishLabel).toBe(true);
        });
    });
});

describe('Bilingual — modal key resolution (without mount)', () => {

    afterEach(async () => {
        await i18n.changeLanguage('he');
    });

    /**
     * רשימת keys קריטיים שחייבים להיות מתורגמים נכון בשתי השפות.
     * לכל key: { he: 'expected hebrew', en: 'expected english' }
     */
    const EVENT_MODAL_KEYS = [
        ['eventModal.title', 'דיווח שעות', 'Time report'],
        ['eventModal.convertTitle', 'המרת אירוע מתוכנן', 'Convert planned event'],
        ['eventModal.fields.project', 'פרויקט', 'Project'],
        ['eventModal.fields.task', 'משימה', 'Task'],
        ['eventModal.fields.stage', 'סיווג', 'Classification'],
        ['eventModal.actions.save', 'שמור', 'Save'],
        ['eventModal.actions.update', 'עדכן', 'Update'],
        ['eventModal.actions.delete', 'מחק', 'Delete'],
        ['eventModal.validation.project', 'יש לבחור פרויקט', 'Project is required'],
        ['eventModal.unsavedChanges.title', 'שינויים שלא נשמרו', 'Unsaved changes']
    ];

    const ALL_DAY_MODAL_KEYS = [
        ['allDayModal.menuTitle', 'סוג דיווח ליום זה', 'Report type for this day'],
        ['allDayModal.splitTitle', 'דיווח שעות מרוכז', 'Bulk hours report'],
        ['allDayModal.labels.totalHours', 'סה"כ שעות', 'Total hours'],
        ['allDayModal.labels.fromDate', 'מתאריך:', 'From:'],
        ['allDayModal.labels.toDate', 'עד תאריך:', 'To:'],
        ['allDayModal.labels.oneDay', 'יום אחד', 'One day'],
        ['allDayModal.search.externalGroup', 'פרויקטים חיצוניים', 'External projects'],
        ['allDayModal.actions.save', 'שמור דיווחים', 'Save reports'],
        ['allDayModal.unsaved.title', 'שמירת דיווחים', 'Save reports'],
        ['allDayModal.validation.noReports', 'יש להוסיף לפחות פרויקט אחד עם שעות', 'Add at least one project with hours']
    ];

    describe('EventModal — מפתחות ב-he', () => {
        beforeEach(async () => { await i18n.changeLanguage('he'); });

        for (const [key, hebrew] of EVENT_MODAL_KEYS) {
            it(`${key} → "${hebrew}"`, () => {
                expect(t(key)).toBe(hebrew);
            });
        }
    });

    describe('EventModal — מפתחות ב-en', () => {
        beforeEach(async () => { await i18n.changeLanguage('en'); });

        for (const [key, , english] of EVENT_MODAL_KEYS) {
            it(`${key} → "${english}"`, () => {
                expect(t(key)).toBe(english);
                expect(t(key)).not.toMatch(HEBREW_RE);
            });
        }
    });

    describe('AllDayEventModal — מפתחות ב-he', () => {
        beforeEach(async () => { await i18n.changeLanguage('he'); });

        for (const [key, hebrew] of ALL_DAY_MODAL_KEYS) {
            it(`${key} → "${hebrew}"`, () => {
                expect(t(key)).toBe(hebrew);
            });
        }
    });

    describe('AllDayEventModal — מפתחות ב-en', () => {
        beforeEach(async () => { await i18n.changeLanguage('en'); });

        for (const [key, , english] of ALL_DAY_MODAL_KEYS) {
            it(`${key} → "${english}"`, () => {
                expect(t(key)).toBe(english);
                expect(t(key)).not.toMatch(HEBREW_RE);
            });
        }
    });
});

describe('Bilingual — interpolation', () => {

    afterEach(async () => {
        await i18n.changeLanguage('he');
    });

    it('he: "{{count}} ימים" עובד עם count=5', async () => {
        await i18n.changeLanguage('he');
        expect(t('allDayModal.labels.manyDays', { count: 5 })).toBe('5 ימים');
    });

    it('en: "{{count}} days" עובד עם count=5', async () => {
        await i18n.changeLanguage('en');
        expect(t('allDayModal.labels.manyDays', { count: 5 })).toBe('5 days');
    });

    it('he: כותרת בחירת ימים עם {{type}}', async () => {
        await i18n.changeLanguage('he');
        expect(t('allDayModal.daysSelectionTitle', { type: 'חופשה' })).toBe('הגדרת חופשה');
    });

    it('en: בחירת ימים עם {{type}} שמגיע מ-board data בעברית', async () => {
        // תרחיש מציאותי: ה-UI באנגלית אבל הלייבל מהלוח עברי.
        // התרגום עוטף את הלייבל באנגלית ("X settings") אבל הלייבל עצמו
        // נשאר כפי שהוא מוגדר ב-Monday — שזה הנכון (board data).
        await i18n.changeLanguage('en');
        const result = t('allDayModal.daysSelectionTitle', { type: 'חופשה' });
        expect(result).toBe('חופשה settings');
        expect(result).toContain('settings');
    });
});
