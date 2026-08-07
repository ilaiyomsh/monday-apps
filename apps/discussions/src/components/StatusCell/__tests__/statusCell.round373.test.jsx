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
   * round374 (owner decision) — there is NO clear row. monday's own status column
   * cannot be emptied from a cell either; the gray DEFAULT label is what "not set"
   * looks like, and the app renders that same gray label for an empty value. A
   * clear action made this picker differ from every board the owner already knows.
   */
  it('offers NO clear row — the gray default label is the empty state', async () => {
    render(<StatusCell value={0} {...OPTS} onChange={vi.fn()} ariaLabel="עריכה" />);
    fireEvent.click(screen.getByText('בעבודה'));
    await flush();
    expect(screen.queryByText('נקה')).toBe(null);
  });

  it('renders the column\'s own gray default label as the empty face', () => {
    // round353 — `emptyLabel` is the gray label-5 text read off the monday column,
    // which is what makes an unset cell read as "not started yet" rather than blank.
    render(<StatusCell value={null} {...OPTS} emptyLabel="טרם החל" />);
    const face = screen.getByText('טרם החל');
    expect(face.className).toContain('statusEmpty');
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
