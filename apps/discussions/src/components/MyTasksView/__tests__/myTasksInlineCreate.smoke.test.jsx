import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Inline task creation (no modal): the blue "משימה חדשה" toolbar button and each
 * group's "+ הוסף משימה" row call createTask IMMEDIATELY with the fixed name
 * "משימה חדשה" and the group's seed value (status/priority grouping only —
 * discussion/none grouping seeds nothing).
 */

const vp = vi.hoisted(() => ({ mobile: false }));
const saved = vi.hoisted(() => ({ view: null }));
const spies = vi.hoisted(() => ({ createTask: null }));

const TASKS = [
  { id: '1', name: 'משימה א', deadlineID: null, statusID: 's1', priorityID: 'p1', discussionLinkID: { linkedItems: [], ids: [], text: null } },
  { id: '2', name: 'משימה ב', deadlineID: null, statusID: 's2', priorityID: null, discussionLinkID: { linkedItems: [], ids: [], text: null } },
];

vi.mock('@generated/hooks/useMyTasks.js', () => ({
  useMyTasks: () => ({
    items: TASKS, loading: false, loadingMore: false, hasMore: false, error: null,
    loadMore: () => {}, updateTaskStatus: () => {}, updateTaskPriority: () => {}, updateTaskNotes: () => {},
    softDeleteTasks: () => ({ undo: () => {} }),
    createTask: spies.createTask,
  }),
}));
vi.mock('@generated/hooks/useDiscussions.js', () => ({ useDiscussions: () => ({ items: [], loading: false }) }));
vi.mock('@generated/hooks/useViewport.js', () => ({ useViewport: () => ({ isMobile: vp.mobile, isTablet: false, isDesktop: !vp.mobile }) }));
vi.mock('@generated/contexts/MondayContext.jsx', () => ({ useMondayContext: () => ({ context: {}, currentUser: { id: '1' } }) }));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: (_b, alias) => (alias === 'priorityID'
    ? { options: [{ id: 'p1', label: 'דחוף', color: '#df2f4a' }], labelById: { p1: 'דחוף' }, colorById: { p1: '#df2f4a' }, orderById: { p1: 0 } }
    : { options: [{ id: 's1', label: 'בעבודה', color: '#fdab3d' }, { id: 's2', label: 'בוצע', color: '#00c875' }], labelById: { s1: 'בעבודה', s2: 'בוצע' }, colorById: { s1: '#fdab3d', s2: '#00c875' }, orderById: { s1: 0, s2: 1 } }),
}));
// The permission resolver reads MondayContext + SettingsContext (mocked only
// partially here) — stub it to allow-all; gating has its own unit tests.
vi.mock('@generated/hooks/usePermission.js', () => ({ usePermission: () => () => true }));
vi.mock('@generated/hooks/useSavedViews.js', () => ({
  useSavedViews: () => ({ view: saved.view, canSave: false, saveView: () => {} }),
}));
// Dumb table that surfaces the per-group add-row hook as a labeled button.
vi.mock('../MyTasksTable.jsx', () => ({
  MyTasksTable: ({ tasks, onAddTask }) => (
    <div data-testid="table">
      {tasks.map((t) => <div key={t.id}>{t.name}</div>)}
      {onAddTask ? <button type="button" onClick={onAddTask}>add-{tasks[0]?.statusID ?? 'none'}</button> : null}
    </div>
  ),
}));

import { MyTasksView } from '../MyTasksView.jsx';

describe('MyTasksView — inline task creation (no modal)', () => {
  beforeEach(() => {
    vp.mobile = false;
    saved.view = null;
    spies.createTask = vi.fn(async () => ({ id: 'real-1' }));
  });

  it('blue toolbar button creates immediately with the fixed name (no grouping → no seed)', () => {
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    expect(spies.createTask).toHaveBeenCalledTimes(1);
    const arg = spies.createTask.mock.calls[0][0];
    expect(arg.name).toBe('משימה חדשה');
    expect(arg.status ?? null).toBeNull();
    expect(arg.priority ?? null).toBeNull();
  });

  it('group add-row creates immediately with that group\'s status seed', () => {
    saved.view = { group: { col: 'status', order: 'labelAsc' } };
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('add-s2'));
    expect(spies.createTask).toHaveBeenCalledTimes(1);
    const arg = spies.createTask.mock.calls[0][0];
    expect(arg.name).toBe('משימה חדשה');
    expect(arg.status).toBe('s2');
  });

  it('blue button with grouping seeds the TOPMOST group\'s value', () => {
    saved.view = { group: { col: 'status', order: 'labelAsc' } };
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    expect(spies.createTask).toHaveBeenCalledTimes(1);
    const arg = spies.createTask.mock.calls[0][0];
    expect(arg.name).toBe('משימה חדשה');
    expect(arg.status).toBe('s1'); // labelAsc → s1 (rank 0) is the top group
  });

  it('discussion grouping seeds nothing (task lands in "ללא דיון")', () => {
    saved.view = { group: { col: 'discussion', order: 'azAsc' } };
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    const arg = spies.createTask.mock.calls[0][0];
    expect(arg.status ?? null).toBeNull();
    expect(arg.priority ?? null).toBeNull();
  });
});
