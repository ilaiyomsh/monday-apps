import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import FilterBar from '../FilterBar/FilterBar';
import CalendarToolbar from '../CalendarToolbar';
import { MondayProvider } from '../../contexts/MondayContext';
import { createMondayMock } from '../../test-utils/mondayMock';

/**
 * Hebrew snapshot tests (Phase 3)
 *
 * המטרה: רשת ביטחון ל-i18n — כל שינוי לא מכוון בטקסט עברי בקוד עצמו
 * ייתפס מיד. הסנפשוטים מתעדים את הסטייט הנוכחי של הרכיב בעברית, ולפני
 * שמתחילים אינקרמנט 1 (חילוץ טקסטים לקבצי locale) זה ה-baseline.
 *
 * תפיסה: כשמחלצים טקסט מהקוד, הסנפשוט יישבר. הצעד שאחרי זה הוא להריץ
 * את ה-app באנגלית ולוודא שהטקסטים מופיעים נכון, ואז לעדכן את ה-baseline
 * בעברית עם snapshot עברי חדש.
 *
 * הערה: הסנפשוטים נשמרים בתיקיית __snapshots__ הסמוכה. השינוי שלהם
 * חייב לעבור code review מפורש (זה השער).
 */

/**
 * מחלץ את כל הטקסט הגלוי מ-DOM, מנקה whitespace.
 * זה הסנפשוט הקריטי ביותר ל-i18n — תופס שינויי טקסט בלי רגישות
 * ל-DOM structure.
 */
function getVisibleText(container) {
    return container.textContent
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * מחלץ את כל הטקסט מתוך attribute שמכיל UI text (title, aria-label,
 * placeholder). תופס דליפות שמעורבות ב-attributes ולא רק ב-textContent.
 */
function getAriaAndTitleText(container) {
    const out = [];
    const walker = container.querySelectorAll('[title], [aria-label], [placeholder]');
    for (const el of walker) {
        if (el.title) out.push(`title="${el.title}"`);
        if (el.getAttribute('aria-label')) out.push(`aria-label="${el.getAttribute('aria-label')}"`);
        if (el.placeholder) out.push(`placeholder="${el.placeholder}"`);
    }
    return out.sort().join('\n');
}

describe('FilterBar — Hebrew baseline', () => {
    const baseProps = {
        reporters: [
            { id: '1', name: 'דני', photo: null },
            { id: '2', name: 'רותם', photo: null }
        ],
        projects: [
            { id: '101', name: 'פרויקט אלפא' },
            { id: '102', name: 'פרויקט בטא' }
        ],
        selectedReporterIds: [],
        selectedProjectIds: [],
        onReporterChange: vi.fn(),
        onProjectChange: vi.fn(),
        onClear: vi.fn(),
        hasActiveFilter: false,
        isLoadingReporters: false,
        isLoadingProjects: false
    };

    it('snapshot של טקסט גלוי במצב סגור', () => {
        const { container } = render(<FilterBar {...baseProps} />);
        expect(getVisibleText(container)).toMatchSnapshot();
    });

    it('snapshot של title/aria/placeholder', () => {
        const { container } = render(<FilterBar {...baseProps} />);
        expect(getAriaAndTitleText(container)).toMatchSnapshot();
    });

    it('snapshot של מבנה HTML מלא', () => {
        const { container } = render(<FilterBar {...baseProps} />);
        expect(container.innerHTML).toMatchSnapshot();
    });

    it('snapshot עם פילטר פעיל', () => {
        const { container } = render(
            <FilterBar
                {...baseProps}
                selectedReporterIds={['1']}
                selectedProjectIds={['101']}
                hasActiveFilter={true}
            />
        );
        expect(getVisibleText(container)).toMatchSnapshot();
    });
});

describe('CalendarToolbar — Hebrew baseline', () => {
    const baseProps = {
        onNavigate: vi.fn(),
        onView: vi.fn(),
        label: 'מאי 2026',
        view: 'work_week',
        date: new Date(2026, 4, 4),
        views: { month: true, week: true, work_week: true, day: true },
        localizer: { messages: {} },
        onOpenSettings: vi.fn(),
        onSwitchToDashboard: vi.fn(),
        isOwner: false
    };

    function renderWithMonday(component, contextData = {}) {
        const monday = createMondayMock({ context: contextData });
        return render(
            <MondayProvider monday={monday}>
                {component}
            </MondayProvider>
        );
    }

    it('snapshot של טקסט גלוי בדסקטופ (RTL, עברית)', () => {
        const { container } = renderWithMonday(
            <CalendarToolbar {...baseProps} />,
            { mode: 'desktop' }
        );
        expect(getVisibleText(container)).toMatchSnapshot();
    });

    it('snapshot של aria/title — שמות הניווט בעברית', () => {
        const { container } = renderWithMonday(
            <CalendarToolbar {...baseProps} />,
            { mode: 'desktop' }
        );
        expect(getAriaAndTitleText(container)).toMatchSnapshot();
    });

    it('snapshot כולל דשבורד פעיל (isOwner)', () => {
        const { container } = renderWithMonday(
            <CalendarToolbar {...baseProps} isOwner={true} />,
            { mode: 'desktop' }
        );
        expect(getVisibleText(container)).toMatchSnapshot();
    });
});

describe('הגנת i18n — אין מחרוזות אנגליות במצב עברית', () => {
    it('FilterBar — אין מילים שמרמזות על UI אנגלי בטקסט הגלוי', () => {
        const { container } = render(
            <FilterBar
                reporters={[]}
                projects={[]}
                selectedReporterIds={[]}
                selectedProjectIds={[]}
                onReporterChange={vi.fn()}
                onProjectChange={vi.fn()}
                onClear={vi.fn()}
                hasActiveFilter={false}
            />
        );
        const text = getVisibleText(container);
        // המוצר עברי-only כרגע — אסור שיופיעו מילים שעיקרן UI אנגלי
        const FORBIDDEN_ENGLISH_UI_WORDS = [
            'Filter', 'Search', 'Clear', 'Apply', 'Cancel',
            'Save', 'Loading', 'No results'
        ];
        for (const word of FORBIDDEN_ENGLISH_UI_WORDS) {
            expect(text).not.toContain(word);
        }
    });
});
