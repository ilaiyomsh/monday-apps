import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Regression: picking a status/priority label must AUTO-CLOSE the picker menu.
// @vibe's Dialog ORs its internal open-state with the controlled `open`, so a
// controlled setOpen(false) alone can't hide a menu opened via showTrigger:['click'].
// The fix adds 'onContentClick' to hideTrigger — clicking any label closes it.
// This drives the REAL MyTasksRow (StatusEditCell) end-to-end.
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({ priorityID: { id: 'status_p' }, taskNotesID: { id: 'text_n' }, deadlineID: { id: 'date_x' } }),
}));
vi.mock('../../../hooks/useColumnWidths.js', () => ({
  useColumnWidths: () => ({ gridTemplate: 'repeat(6, 1fr)', startResize: () => {} }),
}));
vi.mock('../../../hooks/useViewport.js', () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('../../../hooks/useColumnOrder.js', () => ({
  useColumnOrder: () => ({ order: ['name', 'status'], reorder: () => {} }),
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({
    options: [
      { id: 0, label: 'בעבודה', color: '#579bfc' },
      { id: 1, label: 'בוצע', color: '#00c875' },
    ],
    labelById: { 0: 'בעבודה', 1: 'בוצע' },
    colorById: { 0: '#579bfc', 1: '#00c875' },
    orderById: { 0: 0, 1: 1 },
  }),
}));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: vi.fn() } }));

import { MyTasksTable } from '../MyTasksTable.jsx';

const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 260)); }); };

describe('MyTasks status picker — auto-close on select', () => {
  it('closes the label menu and reports the pick after a status is chosen', async () => {
    const onStatusChange = vi.fn();
    render(
      <MyTasksTable
        tasks={[{ id: '1', name: 'משימה', statusID: 0, taskNotesID: '' }]}
        canTask={() => true}
        onStatusChange={onStatusChange}
        onPriorityChange={() => {}}
        onNotesChange={() => {}}
        onDeadlineChange={() => {}}
        onRenameTask={() => {}}
      />,
    );

    // 'בוצע' exists ONLY as a menu option (statusID is 0/'בעבודה'), so its presence
    // in the DOM is a proxy for "menu is open".
    expect(screen.queryByText('בוצע')).toBeNull();

    // open the status menu via its trigger pill (current label 'בעבודה')
    fireEvent.click(screen.getByText('בעבודה'));
    await flush();
    expect(screen.getByText('בוצע')).toBeTruthy();

    // pick the other label — must fire the change AND close the menu
    fireEvent.click(screen.getByText('בוצע'));
    await flush();
    expect(onStatusChange).toHaveBeenCalledWith('1', 1);
    expect(screen.queryByText('בוצע')).toBeNull();
  });
});
