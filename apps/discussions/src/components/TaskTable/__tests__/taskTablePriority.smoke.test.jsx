import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// useStatusOptions is called twice per row: once for statusID (default args) and
// once for ('tasks','priorityID'). Return distinct maps so we can tell the
// priority pill apart from the status pill.
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: (board, alias) => (alias === 'priorityID'
    ? { options: [{ id: 'p1', label: 'דחוף', color: '#e2445c' }], labelById: { p1: 'דחוף' }, colorById: { p1: '#e2445c' }, orderById: { p1: 0 }, doneId: null, loading: false }
    : { options: [{ id: 's1', label: 'בעבודה', color: '#fdab3d' }], labelById: { s1: 'בעבודה' }, colorById: { s1: '#fdab3d' }, orderById: { s1: 0 }, doneId: null, loading: false }),
}));
// TaskTableRow's heavy children are irrelevant to the priority cell — stub them.
vi.mock('@generated/components/PersonPicker', () => ({ PersonPicker: () => null }));
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => null }));
vi.mock('@generated/components/PersonAvatar', () => ({ PersonList: () => null }));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: () => {} } }));

import { TaskTable } from '../TaskTable.jsx';

const TASK = { id: '1', name: 'משימה', statusID: 's1', priorityID: 'p1', responsibilityID: [], deadlineID: null };

describe('TaskTable — priority column (smoke)', () => {
  it('renders the "עדיפות" header + the priority label when showPriority is on', () => {
    render(<TaskTable tasks={[TASK]} showPriority />);
    expect(screen.getByText('עדיפות')).toBeTruthy();
    expect(screen.getByText('דחוף')).toBeTruthy();
  });

  it('hides the priority column when showPriority is off (default)', () => {
    render(<TaskTable tasks={[TASK]} />);
    expect(screen.queryByText('עדיפות')).toBeNull();
    expect(screen.queryByText('דחוף')).toBeNull();
  });

  it('editable mode (onPriorityChange) shows a picker placeholder for an empty priority', () => {
    render(<TaskTable tasks={[{ ...TASK, priorityID: null }]} showPriority onPriorityChange={() => {}} />);
    expect(screen.getByText('בחר עדיפות')).toBeTruthy();
  });
});
