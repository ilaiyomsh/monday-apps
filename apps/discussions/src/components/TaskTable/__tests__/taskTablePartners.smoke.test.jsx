import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round306 (owner request) — the שותפים (partnersID) column joins the SHARED tasks
 * table, so it appears in every discussion view that renders it (משימות tab,
 * משימות קודמות, אפקטיביות) right beside אחראי, and behaves like it: hideable,
 * reorderable, resizable, renameable (all of which come from the table's existing
 * order/width/hide/rename machinery once the column is part of the def list) and
 * inline-editable when the row's editTaskPartners gate passes.
 */

const { columnsMock } = vi.hoisted(() => ({
  columnsMock: { value: { responsibilityID: { id: 'people_r' }, partnersID: { id: 'people_p' } } },
}));
vi.mock('@api/board-config-store.js', () => ({ getColumns: () => columnsMock.value }));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({ options: [], labelById: {}, colorById: {}, orderById: {}, doneId: null, loading: false }),
}));
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => null }));
vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: ({ selected, onChange, single }) => (
    <button
      type="button"
      data-testid={single ? 'picker-single' : 'picker-multi'}
      onClick={() => onChange([{ id: 'u9', name: 'חדש' }])}
    >
      {`picker:${(selected || []).map((p) => p.name).join(',')}`}
    </button>
  ),
}));
vi.mock('@generated/components/PersonAvatar', () => ({
  PersonList: ({ people }) => <span data-testid="person-list">{(people || []).map((p) => p.name).join(',') || '—'}</span>,
}));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: () => {} } }));

import { TaskTable } from '../TaskTable.jsx';

const TASK = {
  id: '1',
  name: 'משימה',
  statusID: null,
  responsibilityID: [{ id: 'u1', name: 'דנה' }],
  partnersID: [{ id: 'u2', name: 'יוסי' }],
  deadlineID: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  columnsMock.value = { responsibilityID: { id: 'people_r' }, partnersID: { id: 'people_p' } };
});

describe('TaskTable — שותפים column', () => {
  it('renders its header + people when the partnersID alias is mapped', () => {
    render(<TaskTable tasks={[TASK]} />);
    expect(screen.getByText('שותפים')).toBeTruthy();
    expect(screen.getByText('יוסי')).toBeTruthy();
  });

  it('is ABSENT when the alias is not mapped (nothing else changes)', () => {
    columnsMock.value = { responsibilityID: { id: 'people_r' } };
    render(<TaskTable tasks={[TASK]} />);
    expect(screen.queryByText('שותפים')).toBeNull();
    expect(screen.getByText('אחראי')).toBeTruthy();
  });

  it('is inline-editable (multi-select) when editTaskPartners passes, and reports the pick', () => {
    const onPartnersChange = vi.fn();
    render(
      <TaskTable tasks={[TASK]} onPartnersChange={onPartnersChange} canTask={(cap) => cap === 'editTaskPartners'} />
    );
    const picker = screen.getByTestId('picker-multi');
    expect(picker.textContent).toContain('יוסי');
    picker.click();
    expect(onPartnersChange).toHaveBeenCalledWith('1', [{ id: 'u9', name: 'חדש' }]);
  });

  it('degrades to read-only when the row\'s editTaskPartners gate denies', () => {
    render(<TaskTable tasks={[TASK]} onPartnersChange={() => {}} canTask={() => false} />);
    expect(screen.queryByTestId('picker-multi')).toBeNull();
    expect(screen.getByText('יוסי')).toBeTruthy();
  });

  it('can be HIDDEN like any other column (hiddenColumns prop)', () => {
    render(<TaskTable tasks={[TASK]} hiddenColumns={new Set(['partners'])} />);
    expect(screen.queryByText('שותפים')).toBeNull();
    // its neighbour stays
    expect(screen.getByText('אחראי')).toBeTruthy();
  });

  it('does not disturb אחראי: that column keeps its own single-select picker + gate', () => {
    render(
      <TaskTable
        tasks={[TASK]}
        onAssigneeChange={() => {}}
        onPartnersChange={() => {}}
        canTask={(cap) => cap === 'editTaskAssignee'}
      />
    );
    expect(screen.getByTestId('picker-single').textContent).toContain('דנה');
    expect(screen.queryByTestId('picker-multi')).toBeNull();
  });
});
