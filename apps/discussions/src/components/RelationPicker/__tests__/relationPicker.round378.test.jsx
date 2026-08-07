import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RelationPicker } from '../RelationPicker.jsx';

/*
 * round378 — the connected-board picker rebuilt as monday's "Choose items" panel
 * (owner screenshot). These tests cover what the owner will look at: the board
 * name, the coloured group sections, the colour bar on each row, and the controls
 * that are real (search, sort, pick, clear).
 */

const CANDS = [
  { id: '1', name: 'ד פריט', group: { id: 'g1', title: 'קבוצה ראשונה', color: '#579bfc' } },
  { id: '2', name: 'א פריט', group: { id: 'g1', title: 'קבוצה ראשונה', color: '#579bfc' } },
  { id: '3', name: 'ב פריט', group: { id: 'g2', title: 'קבוצה שנייה', color: '#00c875' } },
];

const row = (name) => screen.getByTitle(name);

describe('RelationPicker — monday\'s panel layout', () => {
  it('names the LINKED BOARD above the search box', () => {
    render(<RelationPicker boardName="twyst your status" candidates={CANDS} />);
    expect(screen.getByText('twyst your status')).toBeTruthy();
    expect(screen.getByText('בחירת פריטים')).toBeTruthy();
  });

  it('omits the board-name line entirely when the name is unknown', () => {
    // An empty <div> would still take its 10px margin and push the search box down.
    const { container } = render(<RelationPicker boardName="" candidates={CANDS} />);
    expect(container.querySelector('.boardName')).toBe(null);
  });

  it('renders one titled section per group, coloured by the group', () => {
    render(<RelationPicker candidates={CANDS} />);
    const first = screen.getByText('קבוצה ראשונה');
    expect(first.className).toContain('groupTitle');
    expect(first.getAttribute('style')).toContain('rgb(87, 155, 252)');
    expect(screen.getByText('קבוצה שנייה').getAttribute('style')).toContain('rgb(0, 200, 117)');
  });

  /*
   * The colour bar is a pseudo-element fed by `--group-color`, so the row carries
   * the group's colour as a custom property. jsdom cannot read ::before, but it
   * CAN read the property that drives it — which is the part a change would break.
   */
  it('hands each row its group colour for the inline-start bar', () => {
    render(<RelationPicker candidates={CANDS} />);
    expect(row('ד פריט').getAttribute('style')).toContain('--group-color: #579bfc');
    expect(row('ב פריט').getAttribute('style')).toContain('--group-color: #00c875');
  });

  it('renders an ungrouped item with no section header at all', () => {
    const { container } = render(
      <RelationPicker candidates={[{ id: '9', name: 'בודד', group: null }]} />
    );
    expect(row('בודד')).toBeTruthy();
    expect(container.querySelector('.groupTitle')).toBe(null);
  });
});

describe('RelationPicker — the controls that are real', () => {
  it('filters as you type and drops the section left empty', () => {
    render(<RelationPicker candidates={CANDS} columnTitle="קישור" />);
    fireEvent.change(screen.getByLabelText('חיפוש בקישור'), { target: { value: 'ב' } });
    expect(screen.queryByTitle('ד פריט')).toBe(null);
    expect(screen.getByTitle('ב פריט')).toBeTruthy();
    expect(screen.queryByText('קבוצה ראשונה')).toBe(null);
  });

  it('says so when the search matches nothing — not "there are no items"', () => {
    render(<RelationPicker candidates={CANDS} />);
    fireEvent.change(screen.getByLabelText('חיפוש פריט'), { target: { value: 'זזזז' } });
    expect(screen.getByText('לא נמצאו פריטים מתאימים')).toBeTruthy();
    expect(screen.queryByText('אין פריטים להצגה')).toBe(null);
  });

  it('offers the clear-search button ONLY while something is typed', () => {
    render(<RelationPicker candidates={CANDS} />);
    expect(screen.queryByLabelText('ניקוי החיפוש')).toBe(null);
    fireEvent.change(screen.getByLabelText('חיפוש פריט'), { target: { value: 'ב' } });
    fireEvent.click(screen.getByLabelText('ניקוי החיפוש'));
    expect(screen.getByTitle('ד פריט')).toBeTruthy(); // filter released
  });

  it('toggles the order between board order and alphabetical', () => {
    const { container } = render(<RelationPicker candidates={CANDS} />);
    const names = () => [...container.querySelectorAll('.itemName')].map((n) => n.textContent);
    expect(names()).toEqual(['ד פריט', 'א פריט', 'ב פריט']); // board order
    fireEvent.click(screen.getByLabelText('סדר התצוגה: סדר הלוח'));
    expect(names()).toEqual(['א פריט', 'ד פריט', 'ב פריט']); // alpha WITHIN each group
    fireEvent.click(screen.getByLabelText('סדר התצוגה: לפי שם (א׳–ת׳)'));
    expect(names()).toEqual(['ד פריט', 'א פריט', 'ב פריט']); // and back
  });

  it('reports the picked item by id', () => {
    const onToggle = vi.fn();
    render(<RelationPicker candidates={CANDS} onToggle={onToggle} />);
    fireEvent.click(row('ב פריט'));
    expect(onToggle).toHaveBeenCalledWith('3');
  });

  it('marks the linked items, and accepts the linked set as a Set or an array', () => {
    const { rerender } = render(<RelationPicker candidates={CANDS} linkedIds={new Set(['3'])} />);
    expect(row('ב פריט').getAttribute('aria-pressed')).toBe('true');
    expect(row('ד פריט').getAttribute('aria-pressed')).toBe('false');
    rerender(<RelationPicker candidates={CANDS} linkedIds={['3']} />);
    expect(row('ב פריט').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('RelationPicker — clear-all and the empty states', () => {
  it('offers clear-all only for a MULTI column that currently has links', () => {
    const { rerender } = render(<RelationPicker candidates={CANDS} linkedIds={['3']} />);
    expect(screen.getByText('נקה את כל הקישורים')).toBeTruthy();
    // nothing linked → nothing to clear
    rerender(<RelationPicker candidates={CANDS} linkedIds={[]} />);
    expect(screen.queryByText('נקה את כל הקישורים')).toBe(null);
    // single-select clears by re-picking, so the row would be a second way to do it
    rerender(<RelationPicker candidates={CANDS} linkedIds={['3']} allowMultiple={false} />);
    expect(screen.queryByText('נקה את כל הקישורים')).toBe(null);
  });

  it('calls onClearAll when it is used', () => {
    const onClearAll = vi.fn();
    render(<RelationPicker candidates={CANDS} linkedIds={['3']} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByText('נקה את כל הקישורים'));
    expect(onClearAll).toHaveBeenCalled();
  });

  it('shows loading and empty as DISTINCT states, never a bare panel', () => {
    const { rerender } = render(<RelationPicker candidates={[]} loading />);
    expect(screen.getByText('טוען פריטים…')).toBeTruthy();
    rerender(<RelationPicker candidates={[]} loading={false} />);
    expect(screen.getByText('אין פריטים להצגה')).toBeTruthy();
  });
});

describe('RelationPicker — RTL is logical, not mirrored by hand', () => {
  /*
   * The reference screenshot is monday's LTR panel, where the group bar and the
   * search icon sit on the LEFT; in this Hebrew app they belong on the RIGHT. That
   * only holds automatically while the stylesheet uses LOGICAL properties — a
   * `left:`/`padding-left:` here would pin the bar to the wrong edge, and jsdom
   * applies no layout, so the stylesheet is where this is checkable.
   */
  const CSS = readFileSync(
    join(process.cwd(), 'src/components/RelationPicker/RelationPicker.module.css'),
    'utf-8'
  );

  it('pins the colour bar to the inline-start edge', () => {
    const bar = CSS.slice(CSS.indexOf('.item::before {'));
    const block = bar.slice(0, bar.indexOf('}') + 1);
    expect(block).toContain('inset-inline-start: 0');
    expect(block).not.toMatch(/\bleft:/);
    expect(block).not.toMatch(/\bright:/);
  });

  it('uses no physical horizontal padding or margin anywhere in the panel', () => {
    expect(CSS).not.toMatch(/padding-(left|right):/);
    expect(CSS).not.toMatch(/margin-(left|right):/);
  });
});
