import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/*
 * round208 — the mobile card list. Pinned owner spec:
 *   · bottom chips row: priority+deadline on the RIGHT (chipsStart), status
 *     ALONE on the bottom-LEFT (chipsEnd).
 *   · the linked-discussion line is HIDDEN when the view is grouped by
 *     discussion (showDiscussion=false), shown otherwise.
 *   · tapping the status chip opens a bottom sheet; picking a label calls
 *     onStatusChange(taskId, labelId).
 *   · a permission-denied task renders a STATIC chip (no picker).
 */
const openCard = vi.hoisted(() => vi.fn());
vi.mock('@generated/utils/itemCard.js', () => ({ openOrToggleItemCard: openCard }));

import { MyTasksCardList } from '../MyTasksCardList.jsx';

const TASK = {
  id: '1',
  name: 'להכין מצגת',
  statusID: 10,
  priorityID: 20,
  deadlineID: new Date('2030-01-05T00:00:00'),
  discussionLinkID: { linkedItems: [{ id: '99', name: 'ישיבת הנהלה' }] },
};

const baseProps = {
  tasks: [TASK],
  statusOptions: [{ id: 10, label: 'בתהליך', color: '#fdab3d' }, { id: 11, label: 'בוצע', color: '#00c875' }],
  priorityOptions: [{ id: 20, label: 'גבוה', color: '#401694' }],
  statusLabelById: { 10: 'בתהליך', 11: 'בוצע' },
  statusColorById: { 10: '#fdab3d', 11: '#00c875' },
  priorityLabelById: { 20: 'גבוה' },
  priorityColorById: { 20: '#401694' },
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onDeadlineChange: vi.fn(),
};

beforeEach(() => { baseProps.onStatusChange.mockReset(); openCard.mockReset(); });

describe('MyTasksCardList (round208 mobile cards)', () => {
  it('status sits alone in the end (left) slot; priority+deadline in the start (right) slot', () => {
    const { container } = render(<MyTasksCardList {...baseProps} />);
    const start = container.querySelector('.chipsStart');
    const end = container.querySelector('.chipsEnd');
    expect(start.textContent).toContain('גבוה');
    expect(start.textContent).toContain('05/01');
    expect(start.textContent).not.toContain('בתהליך');
    expect(end.textContent).toContain('בתהליך');
    expect(end.textContent).not.toContain('גבוה');
  });

  it('hides the discussion line when grouped by discussion, shows it otherwise', () => {
    const { rerender } = render(<MyTasksCardList {...baseProps} showDiscussion />);
    expect(screen.getByText('ישיבת הנהלה')).toBeInTheDocument();
    rerender(<MyTasksCardList {...baseProps} showDiscussion={false} />);
    expect(screen.queryByText('ישיבת הנהלה')).not.toBeInTheDocument();
  });

  it('tapping the status chip opens the sheet; picking a label calls onStatusChange', () => {
    render(<MyTasksCardList {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'בתהליך' }));
    fireEvent.click(screen.getByRole('button', { name: 'בוצע' }));
    expect(baseProps.onStatusChange).toHaveBeenCalledWith('1', 11);
  });

  it('permission-denied task renders static chips (no status picker)', () => {
    render(<MyTasksCardList {...baseProps} canTask={() => false} />);
    expect(screen.queryByRole('button', { name: 'בתהליך' })).not.toBeInTheDocument();
    expect(screen.getByText('בתהליך')).toBeInTheDocument();
  });

  it('tapping the task name opens the monday item card', () => {
    render(<MyTasksCardList {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'להכין מצגת' }));
    expect(openCard).toHaveBeenCalledWith('1');
  });

  it('round214: the deadline sheet shows a HEBREW RTL calendar and a נקה תאריך button', () => {
    render(<MyTasksCardList {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '📅 05/01' }));
    // Hebrew month header (the task's deadline month) + Hebrew weekday row.
    expect(screen.getByText('ינואר 2030')).toBeInTheDocument();
    expect(screen.getByText('א׳')).toBeInTheDocument();
    // Picking a day writes a Date for that day and closes the sheet.
    fireEvent.click(screen.getByRole('button', { name: '12' }));
    const picked = baseProps.onDeadlineChange.mock.calls.at(-1);
    expect(picked[0]).toBe('1');
    expect(picked[1]).toBeInstanceOf(Date);
    expect(picked[1].getFullYear()).toBe(2030);
    expect(picked[1].getMonth()).toBe(0);
    expect(picked[1].getDate()).toBe(12);
  });

  it('round215: the pencil renames inline (Enter commits the trimmed name)', () => {
    const onRenameTask = vi.fn();
    render(<MyTasksCardList {...baseProps} onRenameTask={onRenameTask} />);
    fireEvent.click(screen.getByRole('button', { name: 'עריכת שם המשימה' }));
    const input = screen.getByLabelText('עריכת שם המשימה');
    fireEvent.change(input, { target: { value: ' מצגת רבעונית ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameTask).toHaveBeenCalledWith('1', 'מצגת רבעונית');
  });

  it('round215: no pencil without rename permission; drag handle always present', () => {
    render(<MyTasksCardList {...baseProps} onRenameTask={vi.fn()} canTask={(cap) => cap !== 'editTaskName'} />);
    expect(screen.queryByRole('button', { name: 'עריכת שם המשימה' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'גרירת המשימה לשינוי מיקום' })).toBeInTheDocument();
  });

  it('round214: נקה תאריך clears the deadline (no הסר תאריך label)', () => {
    render(<MyTasksCardList {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '📅 05/01' }));
    expect(screen.queryByText('הסר תאריך')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'נקה תאריך' }));
    expect(baseProps.onDeadlineChange).toHaveBeenCalledWith('1', null);
  });
});
