import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CalendarTab from '../CalendarTab';

describe('CalendarTab', () => {
    const defaultSettings = {
        showTemporaryEvents: true,
        monthlyHoursTarget: 182.5,
        weeklyHoursTarget: null,
        workdayLength: 8.5,
    };

    // C2: צ'קבוקס אירועים זמניים
    it('מציג צ\'קבוקס אירועים זמניים', () => {
        render(<CalendarTab settings={defaultSettings} onChange={vi.fn()} />);
        expect(screen.getByText('הצג אירועים זמניים בלוח')).toBeInTheDocument();
    });

    it('כיבוי אירועים זמניים שולח showTemporaryEvents: false', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<CalendarTab settings={defaultSettings} onChange={onChange} />);

        const checkboxes = screen.getAllByRole('checkbox');
        // הראשון הוא אירועים זמניים (צ'קבוקס החגים הוסר)
        await user.click(checkboxes[0]);
        expect(onChange).toHaveBeenCalledWith({ showTemporaryEvents: false });
    });

    // C4-C6: יעדי שעות
    it('מציג שדות יעד שעות', () => {
        render(<CalendarTab settings={defaultSettings} onChange={vi.fn()} />);
        expect(screen.getByText('יעד שעות')).toBeInTheDocument();
        expect(screen.getByText('חודשי — יעד שעות')).toBeInTheDocument();
        expect(screen.getByText('שבועי — יעד שעות')).toBeInTheDocument();
        expect(screen.getByText('יומי — אורך יום עבודה (שעות)')).toBeInTheDocument();
    });

    it('שינוי יעד שעות', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<CalendarTab settings={defaultSettings} onChange={onChange} />);

        const inputs = screen.getAllByRole('spinbutton');
        // סדר: יומי, שבועי, חודשי
        await user.clear(inputs[2]);
        await user.type(inputs[2], '200');
        // onChange נקרא עם הערך החדש
        expect(onChange).toHaveBeenCalled();
        const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(lastCall).toHaveProperty('monthlyHoursTarget');
    });

    // showTemporaryEvents=false — צ'קבוקס לא מסומן
    it('showTemporaryEvents=false — צ\'קבוקס לא מסומן', () => {
        render(<CalendarTab settings={{ ...defaultSettings, showTemporaryEvents: false }} onChange={vi.fn()} />);
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes[0]).not.toBeChecked();
    });
});
