import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable viewport flag — the desktop @vibe Dialog popover can't open in jsdom,
// so we exercise the group-by builder via its mobile bottom-sheet branch.
const vp = vi.hoisted(() => ({ mobile: false }));

vi.mock('@generated/hooks/useViewport.js', () => ({
  useViewport: () => ({ isMobile: vp.mobile, isTablet: false, isDesktop: !vp.mobile }),
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({
    options: [{ id: 's1', label: 'בעבודה', color: '#fdab3d' }],
    labelById: { s1: 'בעבודה' },
    colorById: { s1: '#fdab3d' },
    orderById: { s1: 0 },
  }),
}));
// Keep the table dumb so the test stays focused on the toolbar/group control.
vi.mock('@generated/components/TaskTable', () => ({
  TaskTable: ({ tasks }) => <div data-testid="table">{tasks.map((t) => <div key={t.id}>{t.name}</div>)}</div>,
}));

import { TasksTab } from '../TasksTab.jsx';

const DATA = {
  items: [
    { id: '1', name: 'משימה א', statusID: 's1', responsibilityID: [] },
    { id: '2', name: 'משימה ב', statusID: 's1', responsibilityID: [] },
  ],
  loading: false,
  updateTaskName: () => {}, updateTaskStatus: () => {}, updateTaskAssignee: () => {},
  updateTaskDeadline: () => {}, updateTasksStatusBatch: () => {}, updateTasksAssigneeBatch: () => {},
  updateTasksDeadlineBatch: () => {}, softDeleteTasks: () => ({ undo: () => {} }),
};

describe('TasksTab — group-by builder (smoke)', () => {
  beforeEach(() => { vp.mobile = false; });

  it('renders the group builder trigger labelled "Group by" (not a @vibe Dropdown)', () => {
    render(<TasksTab data={DATA} onNewTask={() => {}} />);
    expect(screen.getByText('Group by')).toBeTruthy();
  });

  it('default is NO grouping → tasks render flat, without a status group header', () => {
    render(<TasksTab data={DATA} onNewTask={() => {}} />);
    expect(screen.queryByText('בעבודה')).toBeNull();
    expect(screen.getByText('משימה א')).toBeTruthy();
    expect(screen.getByText('משימה ב')).toBeTruthy();
  });

  it('mobile: opening the builder + Column segment lists the options and picking אחראי groups by person', () => {
    vp.mobile = true;
    render(<TasksTab data={DATA} onNewTask={() => {}} />);
    // pill → panel sheet; no grouping yet, so the Column segment is a placeholder
    fireEvent.click(screen.getByLabelText('Group by'));
    fireEvent.click(screen.getByText('Choose a column'));
    expect(screen.getByText('סטאטוס')).toBeTruthy();
    expect(screen.getByText('אחראי')).toBeTruthy();
    fireEvent.click(screen.getByText('אחראי'));
    // grouped by person → unassigned group header appears
    expect(screen.getByText('לא הוקצה')).toBeTruthy();
  });
});
