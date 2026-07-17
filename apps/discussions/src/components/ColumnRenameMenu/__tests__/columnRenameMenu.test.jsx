// round140 — ColumnRenameMenu retrofit tests: the owner-only rename popover.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColumnRenameMenu } from '../ColumnRenameMenu.jsx';

const base = { position: { x: 100, y: 100 }, defaultName: 'סטאטוס', onSave: () => {}, onClose: () => {} };

describe('ColumnRenameMenu', () => {
  it('saves the typed name on the שמירה button and closes', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ColumnRenameMenu {...base} currentName="סטאטוס" onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue('סטאטוס'), { target: { value: 'שלב' } });
    fireEvent.click(screen.getByText('שמירה'));
    expect(onSave).toHaveBeenCalledWith('שלב');
    expect(onClose).toHaveBeenCalled();
  });

  it('Enter saves too; Escape closes without saving', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ColumnRenameMenu {...base} currentName="סטאטוס" onSave={onSave} onClose={onClose} />);
    const input = screen.getByDisplayValue('סטאטוס');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('סטאטוס');
  });

  it('shows the reset link ONLY when the current name differs from the default, and it saves ""', () => {
    const onSave = vi.fn();
    const { rerender } = render(<ColumnRenameMenu {...base} currentName="סטאטוס" onSave={onSave} />);
    expect(screen.queryByText('איפוס לברירת מחדל')).toBeNull();
    rerender(<ColumnRenameMenu {...base} currentName="שלב" onSave={onSave} />);
    fireEvent.click(screen.getByText('איפוס לברירת מחדל'));
    expect(onSave).toHaveBeenCalledWith('');
  });
});
