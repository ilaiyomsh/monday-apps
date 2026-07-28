import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SortByBuilder } from '../SortByBuilder.jsx';

/*
 * round228 — a NON-owner (no "שמור"/onSave) can't persist a sort default, so the
 * sort panel CLOSES the moment they pick a column (mirroring the group-by
 * picker). The owner's panel stays open so "שמור" is reachable. The desktop
 * @vibe Dialog popover can't open in jsdom, so — like the group-by smoke tests —
 * we exercise the builder via its MOBILE bottom-sheet branch.
 */
const OPTIONS = [
  { value: 'status', label: 'סטטוס', icon: 'status', dirs: [{ key: 'labelAsc', label: 'א→ת', icon: 'az' }] },
  { value: 'name', label: 'שם', icon: 'text', dirs: [{ key: 'nameAsc', label: 'א→ת', icon: 'az' }] },
];

function pickColumn() {
  fireEvent.click(screen.getByLabelText('סדר'));      // pill → builder sheet
  expect(screen.getByText('סדר לפי')).toBeTruthy();     // sheet title (open)
  fireEvent.click(screen.getByText('בחרו עמודה'));      // open the column segment
  fireEvent.click(screen.getByText('סטטוס'));           // pick the column
}

describe('SortByBuilder — non-owner close-on-pick (round228)', () => {
  it('NON-owner (no onSave): picking a column fires onChange AND closes the panel', () => {
    const onChange = vi.fn();
    render(<SortByBuilder options={OPTIONS} value={null} onChange={onChange} onClear={() => {}} mobile />);
    pickColumn();
    expect(onChange).toHaveBeenCalledWith({ col: 'status', dir: 'labelAsc' });
    // panel closed → the sheet title is gone
    expect(screen.queryByText('סדר לפי')).toBeNull();
  });

  it('OWNER (onSave present): picking a column fires onChange but KEEPS the panel open', () => {
    const onChange = vi.fn();
    render(<SortByBuilder options={OPTIONS} value={null} onChange={onChange} onClear={() => {}} onSave={() => {}} mobile />);
    pickColumn();
    expect(onChange).toHaveBeenCalledWith({ col: 'status', dir: 'labelAsc' });
    // panel STAYS open (owner can still reach "שמור")
    expect(screen.getByText('סדר לפי')).toBeTruthy();
  });
});
