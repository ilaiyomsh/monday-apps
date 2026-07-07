import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FilterBar from '../FilterBar';

const mockReporters = [
    { id: 1, name: 'יוסי כהן', photo: null },
    { id: 2, name: 'דנה לוי', photo: null },
    { id: 3, name: 'אבי ישראלי', photo: null }
];

const mockProjects = [
    { id: '101', name: 'פרויקט אלפא' },
    { id: '102', name: 'פרויקט בטא' },
    { id: '103', name: 'פרויקט גמא' }
];

const defaultProps = {
    reporters: mockReporters,
    projects: mockProjects,
    selectedReporterIds: [],
    selectedProjectIds: [],
    onReporterChange: vi.fn(),
    onProjectChange: vi.fn(),
    onClear: vi.fn(),
    hasActiveFilter: false
};

describe('FilterBar', () => {

    // === רינדור בסיסי ===

    it('מרנדר כפתור סינון', () => {
        render(<FilterBar {...defaultProps} />);
        expect(screen.getByText('סינון')).toBeInTheDocument();
    });

    it('לא מציג dropdown כברירת מחדל', () => {
        render(<FilterBar {...defaultProps} />);
        expect(screen.queryByText('אנשים')).not.toBeInTheDocument();
    });

    // === פתיחה/סגירה של dropdown ===

    it('פותח dropdown בלחיצה על כפתור סינון', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));

        expect(screen.getByText('אנשים')).toBeInTheDocument();
        expect(screen.getByText('פרויקטים')).toBeInTheDocument();
    });

    it('סוגר dropdown בלחיצה נוספת', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));
        expect(screen.getByText('אנשים')).toBeInTheDocument();

        await user.click(screen.getByText('סינון'));
        expect(screen.queryByText('אנשים')).not.toBeInTheDocument();
    });

    // === הצגת רשימות ===

    it('מציג את רשימת המדווחים', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));

        expect(screen.getByText('יוסי כהן')).toBeInTheDocument();
        expect(screen.getByText('דנה לוי')).toBeInTheDocument();
        expect(screen.getByText('אבי ישראלי')).toBeInTheDocument();
    });

    it('מציג את רשימת הפרויקטים', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));

        expect(screen.getByText('פרויקט אלפא')).toBeInTheDocument();
        expect(screen.getByText('פרויקט בטא')).toBeInTheDocument();
        expect(screen.getByText('פרויקט גמא')).toBeInTheDocument();
    });

    // === בחירת מדווח ===

    it('קורא ל-onReporterChange בלחיצה על מדווח', async () => {
        const user = userEvent.setup();
        const onReporterChange = vi.fn();
        render(<FilterBar {...defaultProps} onReporterChange={onReporterChange} />);

        await user.click(screen.getByText('סינון'));
        await user.click(screen.getByText('יוסי כהן'));

        expect(onReporterChange).toHaveBeenCalledWith([1]);
    });

    it('מסיר מדווח שכבר נבחר', async () => {
        const user = userEvent.setup();
        const onReporterChange = vi.fn();
        render(
            <FilterBar
                {...defaultProps}
                selectedReporterIds={[1]}
                onReporterChange={onReporterChange}
            />
        );

        await user.click(screen.getByText('סינון'));
        await user.click(screen.getByText('יוסי כהן'));

        // צריך לקרוא עם מערך ריק (הסרת ID 1)
        expect(onReporterChange).toHaveBeenCalledWith([]);
    });

    // === בחירת פרויקט ===

    it('קורא ל-onProjectChange בלחיצה על פרויקט', async () => {
        const user = userEvent.setup();
        const onProjectChange = vi.fn();
        render(<FilterBar {...defaultProps} onProjectChange={onProjectChange} />);

        await user.click(screen.getByText('סינון'));
        await user.click(screen.getByText('פרויקט אלפא'));

        expect(onProjectChange).toHaveBeenCalledWith(['101']);
    });

    // === חיפוש ===

    it('מסנן מדווחים לפי חיפוש', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));

        // שני שדות חיפוש - הראשון למדווחים
        const searchInputs = screen.getAllByPlaceholderText('חיפוש...');
        await user.type(searchInputs[0], 'יוסי');

        expect(screen.getByText('יוסי כהן')).toBeInTheDocument();
        expect(screen.queryByText('דנה לוי')).not.toBeInTheDocument();
        expect(screen.queryByText('אבי ישראלי')).not.toBeInTheDocument();
    });

    it('מסנן פרויקטים לפי חיפוש', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));

        // שדה חיפוש שני - לפרויקטים
        const searchInputs = screen.getAllByPlaceholderText('חיפוש...');
        await user.type(searchInputs[1], 'בטא');

        expect(screen.getByText('פרויקט בטא')).toBeInTheDocument();
        expect(screen.queryByText('פרויקט אלפא')).not.toBeInTheDocument();
    });

    it('מציג הודעת "לא נמצאו תוצאות" בחיפוש ריק', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));

        const searchInputs = screen.getAllByPlaceholderText('חיפוש...');
        await user.type(searchInputs[0], 'שם שלא קיים');

        expect(screen.getByText('לא נמצאו תוצאות')).toBeInTheDocument();
    });

    // === Badge ===

    it('מציג badge עם מספר הנבחרים', async () => {
        render(
            <FilterBar
                {...defaultProps}
                selectedReporterIds={[1, 2]}
                selectedProjectIds={['101']}
                hasActiveFilter={true}
            />
        );

        // badge עם סה"כ 3 (2 מדווחים + 1 פרויקט)
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('לא מציג badge כשאין נבחרים', () => {
        render(<FilterBar {...defaultProps} />);
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    // === כפתור ניקוי ===

    it('מציג כפתור "נקה בחירה" כשיש פילטר פעיל', async () => {
        const user = userEvent.setup();
        render(
            <FilterBar
                {...defaultProps}
                hasActiveFilter={true}
                selectedReporterIds={[1]}
            />
        );

        await user.click(screen.getByText('סינון'));

        expect(screen.getByText('נקה בחירה')).toBeInTheDocument();
    });

    it('לא מציג כפתור ניקוי כשאין פילטר פעיל', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));

        expect(screen.queryByText('נקה בחירה')).not.toBeInTheDocument();
    });

    it('קורא ל-onClear בלחיצה על כפתור ניקוי', async () => {
        const user = userEvent.setup();
        const onClear = vi.fn();
        render(
            <FilterBar
                {...defaultProps}
                hasActiveFilter={true}
                selectedReporterIds={[1]}
                onClear={onClear}
            />
        );

        await user.click(screen.getByText('סינון'));
        await user.click(screen.getByText('נקה בחירה'));

        expect(onClear).toHaveBeenCalledTimes(1);
    });

    // === מצבי טעינה ===

    it('מציג "טוען..." בזמן טעינת מדווחים', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} reporters={[]} isLoadingReporters={true} />);

        await user.click(screen.getByText('סינון'));

        expect(screen.getByText('טוען...')).toBeInTheDocument();
    });

    it('מציג "טוען..." בזמן טעינת פרויקטים', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} projects={[]} isLoadingProjects={true} />);

        await user.click(screen.getByText('סינון'));

        // ייתכנו 2 "טוען..." - אחד לכל עמודה
        const loadingElements = screen.getAllByText('טוען...');
        expect(loadingElements.length).toBeGreaterThan(0);
    });

    // === רשימות ריקות ===

    it('מציג הודעה כשאין אנשים זמינים', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} reporters={[]} />);

        await user.click(screen.getByText('סינון'));

        expect(screen.getByText('אין אנשים זמינים')).toBeInTheDocument();
    });

    it('מציג הודעה כשאין פרויקטים זמינים', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} projects={[]} />);

        await user.click(screen.getByText('סינון'));

        expect(screen.getByText('אין פרויקטים זמינים')).toBeInTheDocument();
    });

    // === טוגל מתוכננים ===

    it('מציג טוגל מתוכננים כשהפיצ׳ר פעיל', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(
            <FilterBar
                {...defaultProps}
                hasTemporaryEventsFeature={true}
                onToggleTemporaryEvents={onToggle}
            />
        );

        await user.click(screen.getByText('סינון'));

        expect(screen.getByText('הצג מתוכננים')).toBeInTheDocument();
    });

    it('לא מציג טוגל מתוכננים כשהפיצ׳ר לא פעיל', async () => {
        const user = userEvent.setup();
        render(<FilterBar {...defaultProps} />);

        await user.click(screen.getByText('סינון'));

        expect(screen.queryByText('הצג מתוכננים')).not.toBeInTheDocument();
    });

    // === column badges ===

    it('מציג badge בעמודת אנשים כשיש נבחרים', async () => {
        const user = userEvent.setup();
        render(
            <FilterBar
                {...defaultProps}
                selectedReporterIds={[1, 2]}
                hasActiveFilter={true}
            />
        );

        await user.click(screen.getByText('סינון'));

        // "2" מופיע כ-badge גלובלי וגם כ-column badge
        const badges = screen.getAllByText('2');
        expect(badges.length).toBeGreaterThanOrEqual(1);
    });
});
