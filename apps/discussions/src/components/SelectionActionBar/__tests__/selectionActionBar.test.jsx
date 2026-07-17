import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SelectionActionBar from '../SelectionActionBar.jsx';

// round144 — the shared floating bulk-selection bar extracted from the five
// multi-select views. These tests pin the contract every call site relies on:
// the empty-selection guard, the count label, the pass-through action slot,
// the aria wiring, and the clear-X.

describe('SelectionActionBar', () => {
  it('renders nothing when the selection is empty (count 0)', () => {
    const { container } = render(
      <SelectionActionBar count={0} onClear={() => {}} ariaLabel="פעולות">
        <button type="button">מחיקה</button>
      </SelectionActionBar>
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the selected count and the aria-label region when count > 0', () => {
    render(
      <SelectionActionBar count={3} onClear={() => {}} ariaLabel="פעולות על משימות נבחרות">
        <button type="button">מחיקה</button>
      </SelectionActionBar>
    );
    const region = screen.getByRole('region', { name: 'פעולות על משימות נבחרות' });
    expect(region).toBeTruthy();
    expect(screen.getByText('3 נבחרו')).toBeTruthy();
  });

  it('renders the view-specific actions passed as children', () => {
    render(
      <SelectionActionBar count={2} onClear={() => {}} ariaLabel="פעולות">
        <button type="button">העבר לדיון הבא</button>
        <button type="button">מחיקה</button>
      </SelectionActionBar>
    );
    expect(screen.getByRole('button', { name: 'העבר לדיון הבא' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'מחיקה' })).toBeTruthy();
  });

  it('clicking the clear-X calls onClear exactly once', () => {
    const onClear = vi.fn();
    render(
      <SelectionActionBar count={5} onClear={onClear} ariaLabel="פעולות">
        <button type="button">מחיקה</button>
      </SelectionActionBar>
    );
    fireEvent.click(screen.getByRole('button', { name: 'בטל בחירה' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
