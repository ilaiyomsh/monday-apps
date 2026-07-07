import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import DashboardToolbar from '../DashboardToolbar';
import { useLocale } from '../../../hooks/useLocale';

// טסט קצר לפיקס ה-RTL של ה-back-icon. "Back" מצביע לכיוון תחילת ציר
// הקריאה: ב-LTR שמאלה (←), ב-RTL ימינה (→).
// vi.mock עובר hoist אוטומטית מעל ה-import-ים ע"י vitest.
vi.mock('../../../hooks/useLocale', () => ({
    useLocale: vi.fn()
}));

vi.mock('../../../i18n/useStableT', () => ({
    useStableT: () => (key) => key
}));

describe('DashboardToolbar — back-icon direction', () => {
    it('he/RTL → ArrowRight (back points to reading-axis start = right)', () => {
        useLocale.mockReturnValue({ isRtl: true });
        const { container } = render(
            <DashboardToolbar
                onSwitchToCalendar={() => {}}
                isOwner={false}
                onOpenSettings={() => {}}
                onExport={() => {}}
                exportDisabled={false}
            />
        );
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg.getAttribute('class')).toMatch(/arrow-right/);
        expect(svg.getAttribute('class')).not.toMatch(/arrow-left/);
    });

    it('en/LTR → ArrowLeft (back points to reading-axis start = left)', () => {
        useLocale.mockReturnValue({ isRtl: false });
        const { container } = render(
            <DashboardToolbar
                onSwitchToCalendar={() => {}}
                isOwner={false}
                onOpenSettings={() => {}}
                onExport={() => {}}
                exportDisabled={false}
            />
        );
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg.getAttribute('class')).toMatch(/arrow-left/);
        expect(svg.getAttribute('class')).not.toMatch(/arrow-right/);
    });
});
