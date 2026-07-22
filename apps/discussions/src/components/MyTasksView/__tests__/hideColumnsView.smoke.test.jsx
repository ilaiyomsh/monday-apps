import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Round 46: the Hide-columns control is OWNER-gated (canManageSettings) and
// persists to the SHARED saved view (useSavedViews.saveView({ hiddenColumns })).
// Everyone gets the saved config applied to the table; only owners see the
// control. The table is mocked dumb so we can read the applied `hiddenColumns`.
const TASKS = [{ id: '1', name: 'משימה א', statusID: 's1' }];

vi.mock('@generated/hooks/useMyTasks.js', () => ({
  useMyTasks: () => ({
    items: TASKS, loading: false, loadingMore: false, hasMore: false, error: null,
    loadMore: () => {}, updateTaskStatus: () => {}, updateTaskPriority: () => {},
    updateTaskNotes: () => {}, updateTaskDeadline: () => {}, updateTaskName: () => {},
    softDeleteTasks: () => ({ undo: () => {} }), createTask: () => {},
  }),
}));
vi.mock('@generated/hooks/useDiscussions.js', () => ({ useDiscussions: () => ({ items: [], loading: false }) }));
vi.mock('@generated/hooks/useViewport.js', () => ({ useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }) }));
vi.mock('@generated/contexts/MondayContext.jsx', async (importOriginal) => ({ ...(await importOriginal()), useMondayContext: () => ({ context: {}, currentUser: { id: '1' } }) }));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({ options: [], labelById: {}, colorById: {}, orderById: {} }),
}));
// All three optional task columns mapped -> the Hide panel lists them.
vi.mock('@api/board-config-store.js', () => ({
  getColumns: () => ({ deadlineID: { id: 'd' }, priorityID: { id: 'p' }, taskNotesID: { id: 'n' } }),
}));
vi.mock('../MyTasksTable.jsx', () => ({
  MyTasksTable: ({ hiddenColumns }) => (
    <div data-testid="table" data-hidden={[...(hiddenColumns || [])].join(',')} />
  ),
}));
vi.mock('@generated/hooks/usePermission.js', () => ({ usePermission: () => () => true }));

const saveView = vi.fn();
vi.mock('@generated/hooks/useSavedViews.js', () => ({
  // A saved view that already hides "priority" for everyone.
  useSavedViews: () => ({ view: { hiddenColumns: ['priority'] }, canSave: true, saveView }),
}));

import { MyTasksView } from '../MyTasksView.jsx';

describe('MyTasksView — Hide columns (owner gating + shared persistence)', () => {
  it('does NOT show the Hide control for non-owners', () => {
    render(<MyTasksView canManageSettings={false} onNotify={() => {}} />);
    expect(screen.queryByRole('button', { name: 'הסתר' })).toBeNull();
    // ...but the saved hidden config is still applied to the table for everyone.
    expect(screen.getAllByTestId('table')[0].getAttribute('data-hidden')).toContain('priority');
  });

  it('shows Hide for owners and applies the saved hiddenColumns to the table', () => {
    render(<MyTasksView canManageSettings onNotify={() => {}} />);
    expect(screen.getByRole('button', { name: 'הסתר' })).toBeInTheDocument();
    expect(screen.getAllByTestId('table')[0].getAttribute('data-hidden')).toContain('priority');
  });

  it('owner "Save to this view" persists the current selection to the shared view', () => {
    render(<MyTasksView canManageSettings onNotify={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'הסתר' }));
    fireEvent.click(screen.getByText('Save to this view'));
    expect(saveView).toHaveBeenCalledWith({ hiddenColumns: ['priority'] });
  });
});
