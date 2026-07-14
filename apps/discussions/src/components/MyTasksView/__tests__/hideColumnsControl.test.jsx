import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HideColumnsControl } from '../controls/HideColumnsControl.jsx';

// The "Display columns" (Hide) popover — a portal panel (z-index 10000) driven
// by a `columns` descriptor + a `hidden` Set. The primary name column is locked
// (checked + disabled). These tests exercise open/close, the master + per-column
// toggles, the search filter, and the owner "Save to this view" action.
const COLUMNS = [
  { key: 'name', label: 'Name', icon: 'text', locked: true },
  { key: 'status', label: 'Status', icon: 'status' },
  { key: 'deadline', label: 'Deadline', icon: 'date' },
  { key: 'notes', label: 'Notes', icon: 'text' },
];

function setup(props = {}) {
  const onToggle = vi.fn();
  const onToggleAll = vi.fn();
  const onSave = vi.fn();
  const utils = render(
    <HideColumnsControl
      columns={COLUMNS}
      hidden={props.hidden ?? new Set()}
      onToggle={onToggle}
      onToggleAll={onToggleAll}
      onSave={props.onSave === undefined ? onSave : props.onSave}
    />
  );
  return { onToggle, onToggleAll, onSave, ...utils };
}

describe('HideColumnsControl — "Display columns" popover', () => {
  it('opens the panel on click and shows the title + Save button', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.getByText('Display columns')).toBeInTheDocument();
    expect(screen.getByText('Save to this view')).toBeInTheDocument();
  });

  it('shows "All columns — N selected" counting every SHOWN column', () => {
    setup({ hidden: new Set(['status']) });
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    // 4 columns total, 1 hidden -> 3 shown/selected (name always counts).
    expect(screen.getByText('All columns — 3 selected')).toBeInTheDocument();
  });

  it('locks (disables) the primary name column checkbox but no other', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    // @vibe Checkbox renders a real <input type="checkbox"> (its ariaLabel does
    // not map to an accessible name here), so query the portal DOM directly. The
    // locked name row is the ONLY disabled column checkbox.
    const boxes = [...document.querySelectorAll('.hcList input[type="checkbox"]')];
    expect(boxes.filter((b) => b.disabled)).toHaveLength(1);
    const lockedRow = document.querySelector('.hcRowLocked');
    expect(lockedRow.querySelector('input[type="checkbox"]').disabled).toBe(true);
  });

  it('toggling a column (via its label button) calls onToggle(key)', () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(onToggle).toHaveBeenCalledWith('status');
  });

  it('the master checkbox hides all when everything is currently shown', () => {
    const { onToggleAll } = setup(); // all shown
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    const master = document.querySelector('.hcMasterRow input[type="checkbox"]');
    fireEvent.click(master);
    expect(onToggleAll).toHaveBeenCalledWith(false);
  });

  it('the search input filters the column rows', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    fireEvent.change(screen.getByLabelText('Find columns to show/hide'), { target: { value: 'dead' } });
    expect(screen.getByText('Deadline')).toBeInTheDocument();
    expect(screen.queryByText('Status')).toBeNull();
  });

  it('clicking "Save to this view" calls onSave and closes the panel', () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    fireEvent.click(screen.getByText('Save to this view'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Display columns')).toBeNull();
  });

  it('hides the Save button when onSave is null', () => {
    setup({ onSave: null });
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Save to this view')).toBeNull();
  });
});
