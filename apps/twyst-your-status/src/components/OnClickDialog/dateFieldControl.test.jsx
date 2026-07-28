/**
 * The date field's contract: the hour is set INSIDE the picker and stays OPTIONAL.
 *
 * A date with no hour must remain a complete answer — if the clock toggle ever
 * leaves a stale time behind, or a day click stops emitting the date, a status
 * transition either writes an hour the user removed or refuses to go through, and
 * nothing else in the app would notice.
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DateFieldControl from './DateFieldControl';

afterEach(cleanup);

/** Renders the control as the form does: the parent owns the value. */
function renderControl(initial = { date: '', time: '' }) {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <DateFieldControl
        value={value}
        controlId="field-when"
        onChange={(next) => { onChange(next); setValue(next); }}
      />
    );
  }
  render(<Host />);
  const trigger = () => screen.getByRole('button', { name: /בחרו תאריך|\d+\.\d+\.\d+/ });
  return { onChange, trigger, open: () => fireEvent.click(trigger()) };
}

describe('DateFieldControl', () => {
  it('shows a placeholder until a date is picked', () => {
    renderControl();
    expect(screen.getByRole('button', { name: 'בחרו תאריך' })).toBeInTheDocument();
  });

  it('emits the clicked day and closes, without inventing an hour', () => {
    const { onChange, open } = renderControl({ date: '2026-07-01', time: '' });
    open();

    fireEvent.click(screen.getByRole('gridcell', { name: '15' }));

    expect(onChange).toHaveBeenCalledWith({ date: '2026-07-15', time: '' });
    // Date-only answer ⇒ the popover is done.
    expect(screen.queryByRole('gridcell', { name: '15' })).not.toBeInTheDocument();
  });

  it('shows the day and the hour on the trigger once both are set', () => {
    renderControl({ date: '2026-07-28', time: '09:30' });
    expect(screen.getByRole('button', { name: '28.7.2026 · 09:30' })).toBeInTheDocument();
  });

  it('shows the day alone when no hour is set', () => {
    renderControl({ date: '2026-07-28', time: '' });
    expect(screen.getByRole('button', { name: '28.7.2026' })).toBeInTheDocument();
  });

  it('hides the hour input until the clock is pressed', () => {
    const { open } = renderControl({ date: '2026-07-28', time: '' });
    open();
    expect(screen.queryByLabelText('שעה')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'הוספת שעה' }));

    expect(screen.getByLabelText('שעה')).toBeInTheDocument();
  });

  it('opens with the hour row already showing when the field has an hour', () => {
    const { open } = renderControl({ date: '2026-07-28', time: '09:30' });
    open();
    expect(screen.getByLabelText('שעה')).toHaveValue('09:30');
  });

  it('CLEARS the hour when the clock is switched off, leaving a date-only value', () => {
    // Leaving a stale time here would write an hour the user just removed.
    const { onChange, open } = renderControl({ date: '2026-07-28', time: '09:30' });
    open();

    fireEvent.click(screen.getByRole('button', { name: 'הוספת שעה' }));

    expect(onChange).toHaveBeenCalledWith({ date: '2026-07-28', time: '' });
    expect(screen.queryByLabelText('שעה')).not.toBeInTheDocument();
  });

  it('keeps the popover open after a day click while an hour is being entered', () => {
    const { open } = renderControl({ date: '2026-07-28', time: '09:30' });
    open();

    fireEvent.click(screen.getByRole('gridcell', { name: '20' }));

    expect(screen.getByLabelText('שעה')).toBeInTheDocument();
  });

  it('emits the typed hour without touching the day', () => {
    const { onChange, open } = renderControl({ date: '2026-07-28', time: '09:30' });
    open();

    fireEvent.change(screen.getByLabelText('שעה'), { target: { value: '17:45' } });

    expect(onChange).toHaveBeenCalledWith({ date: '2026-07-28', time: '17:45' });
  });

  it('steps the visible month without changing the value', () => {
    const { onChange, open } = renderControl({ date: '2026-07-28', time: '' });
    open();
    expect(screen.getByText('יולי 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'החודש הבא' }));

    expect(screen.getByText('אוגוסט 2026')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not open at all while disabled', () => {
    render(<DateFieldControl value={{ date: '', time: '' }} onChange={vi.fn()} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'בחרו תאריך' }));
    expect(screen.queryByRole('gridcell')).not.toBeInTheDocument();
  });
});
