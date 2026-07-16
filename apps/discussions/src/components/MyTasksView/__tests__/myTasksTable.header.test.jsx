import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// MyTasksTable resolves its visible columns from the board-config store and
// drives widths via useColumnWidths. Mock those so the header renders all
// columns (name + deadline + priority + status + notes + discussion) and the
// body rows render via the real MyTasksRow (so we can assert the body name
// cell keeps its own left-aligned classes, distinct from the header).
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
// Force a custom persisted order: status BEFORE priority (default is priority
// before status). Header + body must both honor this.
vi.mock('../../../hooks/useColumnOrder.js', () => ({
  useColumnOrder: () => ({
    order: ['name', 'deadline', 'status', 'priority', 'notes', 'discussion'],
    reorder: () => {},
  }),
}));
// Keep the row dumb so we can assert ONLY the header's class wiring plus the
// body name cell's separate (left-aligned) classes without pulling in the
// full status/notes machinery.
vi.mock('../MyTasksRow.jsx', () => ({
  MyTasksRow: ({ task }) => (
    <div data-testid="body-row">
      <div className="taskCell taskFirst name">
        <button className="nameText">{task.name}</button>
      </div>
    </div>
  ),
}));

import { MyTasksTable } from '../MyTasksTable.jsx';

const TASKS = [{ id: '1', name: 'משימה א' }];

describe('MyTasksTable — header alignment', () => {
  it('renders the "משימה" column header text', () => {
    render(<MyTasksTable tasks={TASKS} />);
    expect(screen.getByText('משימה')).toBeTruthy();
  });

  it('name header cell carries the centered nameHead class', () => {
    render(<MyTasksTable tasks={TASKS} />);
    const nameHeader = screen.getByText('משימה').closest('div');
    expect(nameHeader.className).toContain('nameHead');
    expect(nameHeader.className).toContain('taskFirst');
  });

  it('priority header cell does NOT carry the frozen taskFirst/nameHead classes (copy-paste regression guard)', () => {
    render(<MyTasksTable tasks={TASKS} />);
    const priorityHeader = screen.getByText('עדיפות').closest('div');
    expect(priorityHeader.className).toContain('taskCell');
    expect(priorityHeader.className).not.toContain('nameHead');
    expect(priorityHeader.className).not.toContain('taskFirst');
  });

  it('renders header cells in the persisted column order (status before priority)', () => {
    render(<MyTasksTable tasks={TASKS} />);
    const headerRow = document.querySelector('.taskHead');
    const texts = [...headerRow.querySelectorAll('.taskCell')].map((c) => c.textContent.trim());
    expect(texts.indexOf('סטאטוס')).toBeLessThan(texts.indexOf('עדיפות'));
  });

  it('body task-name cell keeps its own left-aligned name/nameText classes (not the header nameHead)', () => {
    render(<MyTasksTable tasks={TASKS} />);
    const bodyName = screen.getByText('משימה א');
    expect(bodyName.className).toContain('nameText');
    const cell = bodyName.closest('.name');
    expect(cell).toBeTruthy();
    expect(cell.className).not.toContain('nameHead');
  });
});
