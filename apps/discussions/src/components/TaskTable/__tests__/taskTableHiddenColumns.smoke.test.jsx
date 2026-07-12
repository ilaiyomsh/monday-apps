import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Round 47 — the shared TaskTable (TasksTab / PreviousTasksTab) drops a column
// at the RENDER layer when its key is in the `hiddenColumns` prop, while the
// primary (frozen) name column can never be hidden. Fix the persisted order so
// the header set is deterministic; the width/order hooks are untouched by hiding.
vi.mock('../../../hooks/useColumnOrder.js', () => ({
  useColumnOrder: () => ({ order: ['name', 'assignee', 'deadline', 'status'], reorder: () => {} }),
}));
vi.mock('../../../hooks/useViewport.js', () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({ options: [], labelById: {}, colorById: {}, orderById: {}, doneId: null, loading: false }),
}));
vi.mock('@generated/components/PersonPicker', () => ({ PersonPicker: () => null }));
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => null }));
vi.mock('@generated/components/PersonAvatar', () => ({ PersonList: () => null }));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: () => {} } }));

import { TaskTable } from '../TaskTable.jsx';

const TASK = { id: '1', name: 'משימה', statusID: null, responsibilityID: [], deadlineID: null };
const headerTexts = () => {
  const headerRow = document.querySelector('.taskHead');
  return [...headerRow.querySelectorAll('.taskCell')].map((c) => c.textContent.trim());
};

describe('TaskTable — hidden columns (round 47, smoke)', () => {
  it('shows every column when hiddenColumns is undefined', () => {
    render(<TaskTable tasks={[TASK]} />);
    const texts = headerTexts();
    expect(texts).toContain('אחראי');
    expect(texts).toContain('דד ליין');
    expect(texts).toContain('סטאטוס');
  });

  it('drops a hidden column header while keeping the rest', () => {
    render(<TaskTable tasks={[TASK]} hiddenColumns={new Set(['status'])} />);
    const texts = headerTexts();
    expect(texts).toContain('אחראי');
    expect(texts).toContain('דד ליין');
    expect(texts).not.toContain('סטאטוס');
  });

  it('accepts an array (not only a Set) and drops multiple columns', () => {
    render(<TaskTable tasks={[TASK]} hiddenColumns={['assignee', 'deadline']} />);
    const texts = headerTexts();
    expect(texts).not.toContain('אחראי');
    expect(texts).not.toContain('דד ליין');
    expect(texts).toContain('סטאטוס');
  });

  it('never hides the primary (frozen) name column, even if asked', () => {
    // The name header carries no label text (it's the frozen first column), so
    // assert via its literal .nameHead class + the body row's .taskFirst cell.
    render(<TaskTable tasks={[TASK]} hiddenColumns={new Set(['name', 'status'])} />);
    expect(document.querySelector('.taskHead .nameHead')).not.toBeNull();
    expect(document.querySelector('.bodyRow .taskFirst')).not.toBeNull();
  });
});
