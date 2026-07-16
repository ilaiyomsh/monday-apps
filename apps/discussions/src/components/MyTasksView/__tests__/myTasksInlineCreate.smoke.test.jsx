import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Inline task creation from the blue "משימה חדשה" toolbar button. Clicking it
 * does NOT create immediately: it opens a focused, pre-selected name input as the
 * FIRST row of the topmost group. Typing + Enter commits via createTask with
 * `prepend:true` (so the optimistic row lands at the very top) and the topmost
 * group's seed (status/priority grouping only). Escape / empty discards.
 * The per-group "+ הוסף משימה" footer row still creates immediately.
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
vi.mock('@generated/contexts/MondayContext.jsx', async (importOriginal) => ({ ...(await importOriginal()), useMondayContext: () => ({ context: {}, currentUser: { id: '1' } }) }));
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
// Dumb table that surfaces BOTH the per-group add-row hook (as a labeled button)
// and the top-of-group inline draft input (newTaskRow) so we can drive them.
vi.mock('../MyTasksTable.jsx', () => ({
  MyTasksTable: ({ tasks, onAddTask, newTaskRow }) => (
    <div data-testid="table">
      {newTaskRow ? (
        <input
          data-testid="new-task-input"
          defaultValue={newTaskRow.defaultName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') newTaskRow.onCommit(e.currentTarget.value);
            if (e.key === 'Escape') newTaskRow.onCancel();
          }}
        />
      ) : null}
      {tasks.map((t) => <div key={t.id}>{t.name}</div>)}
      {onAddTask ? <button type="button" onClick={onAddTask}>add-{tasks[0]?.statusID ?? 'none'}</button> : null}
    </div>
  ),
}));

import { MyTasksView } from '../MyTasksView.jsx';

describe('MyTasksView — blue "משימה חדשה" button (inline, top of view)', () => {
  beforeEach(() => {
    vp.mobile = false;
    saved.view = null;
    spies.createTask = vi.fn(async () => ({ id: 'real-1' }));
  });

  it('opens an inline draft input at the top — does NOT create immediately', () => {
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    expect(spies.createTask).not.toHaveBeenCalled();
    const input = screen.getByTestId('new-task-input');
    expect(input).toBeTruthy();
    expect(input.value).toBe('משימה חדשה'); // default (pre-selected in the real row)
  });

  it('typing a name + Enter creates it with prepend + the typed name (no grouping → no seed)', () => {
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    const input = screen.getByTestId('new-task-input');
    fireEvent.change(input, { target: { value: 'לקנות חלב' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spies.createTask).toHaveBeenCalledTimes(1);
    const arg = spies.createTask.mock.calls[0][0];
    expect(arg.name).toBe('לקנות חלב');
    expect(arg.prepend).toBe(true);
    expect(arg.status ?? null).toBeNull();
    expect(arg.priority ?? null).toBeNull();
  });

  it('Enter with the unchanged default commits the default name (pre-selected default)', () => {
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    fireEvent.keyDown(screen.getByTestId('new-task-input'), { key: 'Enter' });
    expect(spies.createTask).toHaveBeenCalledTimes(1);
    expect(spies.createTask.mock.calls[0][0].name).toBe('משימה חדשה');
    expect(spies.createTask.mock.calls[0][0].prepend).toBe(true);
  });

  it('Escape discards — no task created, input removed', () => {
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    fireEvent.keyDown(screen.getByTestId('new-task-input'), { key: 'Escape' });
    expect(spies.createTask).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-task-input')).toBeNull();
  });

  it('with status grouping, the committed task is seeded with the TOPMOST group value', () => {
    saved.view = { group: { col: 'status', order: 'labelAsc' } };
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    const input = screen.getByTestId('new-task-input');
    fireEvent.change(input, { target: { value: 'משהו' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const arg = spies.createTask.mock.calls[0][0];
    expect(arg.status).toBe('s1'); // labelAsc → s1 (rank 0) is the top group
    expect(arg.prepend).toBe(true);
  });

  it('discussion grouping seeds nothing (task created unlinked)', () => {
    saved.view = { group: { col: 'discussion', order: 'azAsc' } };
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('משימה חדשה'));
    const input = screen.getByTestId('new-task-input');
    fireEvent.change(input, { target: { value: 'משהו' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const arg = spies.createTask.mock.calls[0][0];
    expect(arg.status ?? null).toBeNull();
    expect(arg.priority ?? null).toBeNull();
    expect(arg.prepend).toBe(true);
  });
});

describe('MyTasksView — per-group "+ הוסף משימה" footer (immediate create)', () => {
  beforeEach(() => {
    vp.mobile = false;
    saved.view = null;
    spies.createTask = vi.fn(async () => ({ id: 'real-1' }));
  });

  it("creates immediately with that group's status seed", () => {
    saved.view = { group: { col: 'status', order: 'labelAsc' } };
    render(<MyTasksView />);
    fireEvent.click(screen.getByText('add-s2'));
    expect(spies.createTask).toHaveBeenCalledTimes(1);
    const arg = spies.createTask.mock.calls[0][0];
    expect(arg.name).toBe('משימה חדשה');
    expect(arg.status).toBe('s2');
  });
});
