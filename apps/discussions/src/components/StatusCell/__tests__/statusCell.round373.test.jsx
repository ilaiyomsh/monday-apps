import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StatusCell } from '../StatusCell.jsx';

/*
 * round373 — the ONE status cell behind the built-in status column, the priority
 * column and every owner-added custom status column. What these tests protect is
 * the reason it exists: the custom column used to have its own lookalike markup
 * and drifted (rounded chip in a padded cell, fixed-width picker). Anything that
 * makes one of the three render differently has to fail here.
 */

// @vibe's Dialog ORs its internal open-state with the controlled `open`, so the
// menu only exists in the DOM after a tick — the same flush the existing
// statusMenuAutoClose smoke test uses.
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 260)); }); };

const OPTS = {
  options: [
    { id: 0, label: 'בעבודה', color: '#fdab3d' },
    { id: 1, label: 'בוצע', color: '#00c875' },
  ],
  labelById: { 0: 'בעבודה', 1: 'בוצע' },
  colorById: { 0: '#fdab3d', 1: '#00c875' },
};

describe('StatusCell — the face', () => {
  it('renders the label filled with the column\'s own colour', () => {
    render(<StatusCell value={1} {...OPTS} />);
    const fill = screen.getByText('בוצע');
    expect(fill.className).toContain('statusFill');
    expect(fill.getAttribute('style')).toContain('rgb(0, 200, 117)');
  });

  /*
   * Label id 0 is a REAL label. A truthiness test here would render the FIRST
   * label of every status column as the empty state — the single most likely way
   * to break this cell.
   */
  it('treats label id 0 as a value, not as empty', () => {
    render(<StatusCell value={0} {...OPTS} emptyLabel="בחר סטאטוס" />);
    expect(screen.getByText('בעבודה')).toBeTruthy();
    expect(screen.queryByText('בחר סטאטוס')).toBe(null);
  });

  it('shows the empty label for no value, and for an id the column does not have', () => {
    const { rerender } = render(<StatusCell value={null} {...OPTS} emptyLabel="בחר סטאטוס" />);
    expect(screen.getByText('בחר סטאטוס').className).toContain('statusEmpty');
    rerender(<StatusCell value={99} {...OPTS} emptyLabel="בחר סטאטוס" />);
    expect(screen.getByText('בחר סטאטוס')).toBeTruthy();
  });

  it('renders NO trigger button when it is read-only (no onChange)', () => {
    render(<StatusCell value={1} {...OPTS} />);
    expect(screen.queryByRole('button')).toBe(null);
  });
});

describe('StatusCell — the picker', () => {
  it('offers every label and reports the picked id', async () => {
    const onChange = vi.fn();
    render(<StatusCell value={null} {...OPTS} onChange={onChange} emptyLabel="בחר סטאטוס" ariaLabel="עריכת סטאטוס" />);
    expect(screen.queryByText('בוצע')).toBe(null); // menu closed
    fireEvent.click(screen.getByText('בחר סטאטוס'));
    await flush();
    fireEvent.click(screen.getByText('בוצע'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('can set the FIRST label (id 0) — not swallowed as a falsy pick', async () => {
    const onChange = vi.fn();
    render(<StatusCell value={1} {...OPTS} onChange={onChange} ariaLabel="עריכת סטאטוס" />);
    fireEvent.click(screen.getByText('בוצע')); // the current face
    await flush();
    fireEvent.click(screen.getByText('בעבודה'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  /*
   * The clear row is the ONLY way to empty a status from a table cell, and it is
   * on the shared cell so the built-in and custom columns clear identically —
   * round372's custom column cleared by re-picking the set label, a gesture the
   * built-in columns never had.
   */
  it('offers "נקה" only when a value is set, and clears with null', async () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <StatusCell value={null} {...OPTS} onChange={onChange} emptyLabel="בחר" ariaLabel="עריכה" />
    );
    fireEvent.click(screen.getByText('בחר'));
    await flush();
    expect(screen.queryByText('נקה')).toBe(null); // nothing to clear
    unmount();

    render(<StatusCell value={0} {...OPTS} onChange={onChange} ariaLabel="עריכה" />);
    fireEvent.click(screen.getByText('בעבודה'));
    await flush();
    fireEvent.click(screen.getByText('נקה'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('tells the user when the column has no labels at all', async () => {
    render(
      <StatusCell value={null} options={[]} labelById={{}} colorById={{}}
        onChange={vi.fn()} emptyLabel="בחר" ariaLabel="עריכה" />
    );
    fireEvent.click(screen.getByText('בחר'));
    await flush();
    expect(screen.getByText('אין תוויות בעמודה זו')).toBeTruthy();
  });
});
