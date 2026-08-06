import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@generated/components/PersonPicker', () => ({ PersonPicker: () => <div data-testid="person-picker" /> }));
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => <div data-testid="date-picker" /> }));

import { QuickCreateModal } from '../QuickCreateModal.jsx';

/*
 * round370 §1 (owner request) — "תוריד את ה-X בצד שמאל, אין בו צורך כי יש הרי
 * כפתור ביטול, ואז גם תפרוס את הטוגל של משימה או החלטה לכל רוחב הכרטיס".
 *
 * The × is gone, so the toggle can own the whole top row. What must NOT go with it
 * is the ability to close: ביטול is now the only visible close control, and Esc
 * still works. Both are asserted here — removing a control silently is how a card
 * becomes a trap.
 */
const open = (props) => render(
  <QuickCreateModal open initialMode="task" onClose={props.onClose} onCreate={props.onCreate || (() => {})} />
);

describe('round370 — the quick-create card has no × ', () => {
  it('renders no close (×) button at all', () => {
    open({ onClose: () => {} });
    expect(screen.queryByRole('button', { name: 'סגירה' })).toBeNull();
    expect(screen.queryByText('×')).toBeNull();
  });

  it('ביטול still closes the card — it is the close affordance now', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc still closes the card', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('both toggle sides are still there and reachable', () => {
    open({ onClose: () => {} });
    expect(screen.getByRole('tab', { name: 'משימה' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'החלטה' })).toBeInTheDocument();
  });
});
