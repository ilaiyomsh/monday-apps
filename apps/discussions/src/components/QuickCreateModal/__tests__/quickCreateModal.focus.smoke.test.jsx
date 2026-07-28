import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// The PersonPicker / DatePickerPopover are portaled, generated components — stub
// them so the focus test stays hermetic and fast.
vi.mock('@generated/components/PersonPicker', () => ({ PersonPicker: () => <div data-testid="person-picker" /> }));
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => <div data-testid="date-picker" /> }));

import { QuickCreateModal } from '../QuickCreateModal.jsx';

/*
 * round229 (owner request) — opening the quick-create card (e.g. the per-point
 * "+") auto-focuses the text field so the user can type immediately, and
 * switching the משימה/החלטה toggle re-focuses it (no mouse click needed).
 */
describe('QuickCreateModal — auto-focus (round229)', () => {
  it('focuses the text input on open', async () => {
    render(<QuickCreateModal open initialMode="task" onClose={() => {}} onCreate={() => {}} />);
    const input = screen.getByLabelText('שם המשימה (חובה)');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('re-focuses the text input after switching the משימה/החלטה toggle', async () => {
    render(<QuickCreateModal open initialMode="task" onClose={() => {}} onCreate={() => {}} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('שם המשימה (חובה)')));

    // Real click on the toggle moves focus to the button; the effect must pull
    // focus back to the field. jsdom's fireEvent.click doesn't itself focus the
    // button, so simulate that focus-steal explicitly, THEN assert the field
    // (re)gains focus — this is what fails if the toggle stops re-focusing.
    const tab = screen.getByRole('tab', { name: 'החלטה' });
    fireEvent.click(tab);
    tab.focus();
    expect(document.activeElement).toBe(tab); // focus stolen by the toggle
    const decisionInput = screen.getByLabelText('טקסט ההחלטה (חובה)');
    await waitFor(() => expect(document.activeElement).toBe(decisionInput));
  });
});
