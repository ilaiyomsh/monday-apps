import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineAddDecisionRow, LabelPickerCell, formatDayMonth } from '../DecisionRow.jsx';

// round145 — DecisionsTab split: the row-level building blocks moved to
// DecisionRow.jsx. These tests pin the behavior that moved, so the extraction
// (and any future edit to the module) can't silently change it.

describe('InlineAddDecisionRow', () => {
  it('rests as the "+ הוסף החלטה" affordance and swaps to an input on click', () => {
    render(<InlineAddDecisionRow onCreate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '+ הוסף החלטה' }));
    expect(screen.getByRole('textbox', { name: 'החלטה חדשה' })).toBeTruthy();
  });

  it('Enter creates with the trimmed name and clears the input for rapid entry', () => {
    const onCreate = vi.fn();
    render(<InlineAddDecisionRow onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: '+ הוסף החלטה' }));
    const input = screen.getByRole('textbox', { name: 'החלטה חדשה' });
    fireEvent.change(input, { target: { value: '  החלטה חשובה  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('החלטה חשובה');
    expect(input.value).toBe('');
  });

  it('Enter on a whitespace-only name creates nothing', () => {
    const onCreate = vi.fn();
    render(<InlineAddDecisionRow onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: '+ הוסף החלטה' }));
    const input = screen.getByRole('textbox', { name: 'החלטה חדשה' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('LabelPickerCell', () => {
  const opts = {
    options: [{ id: 'l1', label: 'בוצע', color: 'green' }],
    labelById: { l1: 'בוצע' },
    colorById: { l1: 'green' },
  };

  it('degrades to a display-only cell when not editable (no picker trigger)', () => {
    render(<LabelPickerCell value="l1" opts={opts} canEdit={false} onPick={() => {}} placeholder="בחר" />);
    expect(screen.getByText('בוצע')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the placeholder when the value has no label', () => {
    render(<LabelPickerCell value={null} opts={opts} canEdit={false} onPick={() => {}} placeholder="בחר סטאטוס" />);
    expect(screen.getByText('בחר סטאטוס')).toBeTruthy();
  });
});

describe('formatDayMonth', () => {
  it('formats as zero-padded dd/mm', () => {
    expect(formatDayMonth(new Date(2026, 2, 5))).toBe('05/03');
    expect(formatDayMonth(new Date(2026, 10, 21))).toBe('21/11');
  });
});
