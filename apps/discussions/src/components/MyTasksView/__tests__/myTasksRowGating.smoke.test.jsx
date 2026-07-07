import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Per-task permission gating: MyTasksTable withholds a row's edit handlers when
// canTask(cap, task) denies, so the REAL MyTasksRow must degrade each cell to
// read-only. Mock the config/layout hooks (like myTasksTable.header.test.jsx)
// but keep MyTasksRow real — the degradation logic is what's under test.
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({
    deadlineID: { id: 'date_x' },
    priorityID: { id: 'status_p' },
    taskNotesID: { id: 'text_n' },
  }),
}));
vi.mock('../../../hooks/useColumnWidths.js', () => ({
  useColumnWidths: () => ({ gridTemplate: 'repeat(6, 1fr)', startResize: () => {} }),
}));
vi.mock('../../../hooks/useViewport.js', () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('../../../hooks/useColumnOrder.js', () => ({
  useColumnOrder: () => ({
    order: ['name', 'deadline', 'priority', 'status', 'notes', 'discussion'],
    reorder: () => {},
  }),
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({
    options: [{ id: 0, label: 'בעבודה', color: '#579bfc' }],
    labelById: { 0: 'בעבודה' },
    colorById: { 0: '#579bfc' },
    orderById: { 0: 0 },
  }),
}));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: vi.fn() } }));
vi.mock('@generated/components/DatePickerPopover', () => ({
  DatePickerPopover: () => <button type="button" data-testid="date-picker" />,
}));

import { MyTasksTable } from '../MyTasksTable.jsx';

const TASKS = [
  { id: '1', name: 'משימה שלי', statusID: 0, deadlineID: new Date(2026, 6, 10), taskNotesID: '' },
  { id: '2', name: 'משימה של אחר', statusID: 0, deadlineID: new Date(2026, 6, 11), taskNotesID: '' },
];
// The gate under test: task '1' may edit everything, task '2' nothing.
const ALLOW_TASK_1_ONLY = (cap, task) => String(task?.id) === '1';

function renderGated() {
  return render(
    <MyTasksTable
      tasks={TASKS}
      canTask={ALLOW_TASK_1_ONLY}
      onStatusChange={() => {}}
      onPriorityChange={() => {}}
      onNotesChange={() => {}}
      onDeadlineChange={() => {}}
      onRenameTask={() => {}}
    />
  );
}

describe('MyTasksTable — per-task permission gating (canTask)', () => {
  it('allowed row gets the inline date picker; the denied row falls back to read-only text', () => {
    renderGated();
    expect(screen.getAllByTestId('date-picker')).toHaveLength(1);
    expect(screen.getByText('11/07/2026')).toBeTruthy(); // denied row, plain text
  });

  it('only the allowed row shows the rename pencil (and its name still opens the card)', () => {
    renderGated();
    const pencils = screen.getAllByLabelText(/ערוך שם משימה/);
    expect(pencils).toHaveLength(1);
    expect(screen.getByLabelText('ערוך שם משימה: משימה שלי')).toBeTruthy();
  });

  it('denied status cell renders a read-only pill — no picker trigger button', () => {
    renderGated();
    const fills = screen.getAllByText('בעבודה');
    expect(fills).toHaveLength(2); // both rows show the label
    const editable = fills.filter((el) => el.closest('button'));
    expect(editable).toHaveLength(1); // but only the allowed row wraps it in a trigger
  });
});
