import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Round 46: MyTasksTable accepts a `hiddenColumns` Set and drops those columns
// from BOTH the header and the body rows — applied at the render layer only, so
// column order/width persistence is untouched and the frozen name column can
// never be hidden. Mock the config/order/width hooks (as the header test does)
// so all columns are mapped and the persisted order is deterministic.
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  // round136: MyTasksTable hoists useStatusOptions, which also reads getBoardId
  getBoardId: () => null,
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
vi.mock('../MyTasksRow.jsx', () => ({
  MyTasksRow: ({ task, columns }) => (
    <div data-testid="body-row" data-cols={columns.join(',')}>{task.name}</div>
  ),
}));

import { MyTasksTable } from '../MyTasksTable.jsx';

const TASKS = [{ id: '1', name: 'משימה א' }];

describe('MyTasksTable — hidden columns', () => {
  it('renders all mapped columns when nothing is hidden', () => {
    render(<MyTasksTable tasks={TASKS} />);
    expect(screen.getByText('עדיפות')).toBeTruthy(); // priority
    expect(screen.getByText('סטאטוס')).toBeTruthy(); // status
  });

  it('omits a hidden column header (priority) but keeps the others', () => {
    render(<MyTasksTable tasks={TASKS} hiddenColumns={new Set(['priority'])} />);
    expect(screen.queryByText('עדיפות')).toBeNull(); // priority hidden
    expect(screen.getByText('סטאטוס')).toBeTruthy(); // status still shown
  });

  it('never hides the frozen name column even if asked', () => {
    render(<MyTasksTable tasks={TASKS} hiddenColumns={new Set(['name', 'status'])} />);
    expect(screen.getByText('משימה')).toBeTruthy(); // name header always shown
    expect(screen.queryByText('סטאטוס')).toBeNull(); // status hidden
  });

  it('drops the hidden key from the body row columns too (also accepts an array)', () => {
    render(<MyTasksTable tasks={TASKS} hiddenColumns={['notes']} />);
    const row = screen.getByTestId('body-row');
    expect(row.getAttribute('data-cols')).not.toContain('notes');
    expect(row.getAttribute('data-cols')).toContain('status');
  });
});
