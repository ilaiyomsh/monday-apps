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
  it('offers NO clear TEXT row — the gray default label is the empty state', async () => {
    render(<StatusCell value={0} {...OPTS} onChange={vi.fn()} ariaLabel="עריכה" />);
    fireEvent.click(screen.getByText('בעבודה'));
    await flush();
    expect(screen.queryByText('נקה')).toBe(null);
  });

  /*
   * round377 — EVERY status column in monday offers a gray default (it is how a
   * cell goes back to unset), so this picker always offers one too. It is not
   * always in the DATA, though: `settings.labels` omits the implicit gray state
   * whenever nobody wrote text on id 5, which is why "בדיקה" (0/1/2/3) and
   * "עדיפות" (7/10/109/110) come back without it. The app supplies the pill, and
   * picking it writes NULL — id 5 is not on the column, and an empty value is
   * already what the cell renders as the gray face.
   */
  it('offers a gray default pill even when it carries no text, and it clears', async () => {
    const onChange = vi.fn();
    render(<StatusCell value={0} {...OPTS} onChange={onChange} ariaLabel="עריכה" />);
    fireEvent.click(screen.getByText('בעבודה'));
    await flush();
    const pill = screen.getByLabelText('ללא סטאטוס');
    expect(pill.textContent).toBe('');           // textless, on purpose
    fireEvent.click(pill);
    expect(onChange).toHaveBeenCalledWith(null); // never id 5
  });

  it('labels that pill with the column\'s gray text when the column has one', async () => {
    render(<StatusCell value={0} {...OPTS} onChange={vi.fn()} emptyLabel="טרם החל" ariaLabel="עריכה" />);
    fireEvent.click(screen.getByText('בעבודה'));
    await flush();
    expect(screen.getByLabelText('טרם החל')).toBeTruthy();
  });

  /*
   * A column that already owns a gray default (stable id 5) must NOT get a second
   * one — it is already in `options` at its own display position.
   */
  it('adds NO pill when the column already has its own gray default label', async () => {
    const withGray = {
      options: [{ id: 5, label: 'טרם נבחר', color: '#c4c4c4' }, { id: 1, label: 'בוצע', color: '#00c875' }],
      labelById: { 5: 'טרם נבחר', 1: 'בוצע' },
      colorById: { 5: '#c4c4c4', 1: '#00c875' },
    };
    render(<StatusCell value={1} {...withGray} onChange={vi.fn()} ariaLabel="עריכה" />);
    fireEvent.click(screen.getByText('בוצע'));
    await flush();
    // exactly one gray entry — the column's own
    expect(screen.getAllByText('טרם נבחר')).toHaveLength(1);
    expect(screen.queryByLabelText('ללא סטאטוס')).toBe(null);
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
