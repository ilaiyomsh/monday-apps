import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Default column order; no persisted widths → the constants' defaults apply.
vi.mock('../../../hooks/useViewport.js', () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({ options: [], labelById: {}, colorById: {}, orderById: {}, doneId: null, loading: false }),
}));
vi.mock('@generated/components/PersonPicker', () => ({ PersonPicker: () => null }));
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => null }));
vi.mock('@generated/components/PersonAvatar', () => ({ PersonList: () => null }));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: () => {}, storage: { getItem: async () => ({}), setItem: async () => ({}) } } }));

import { TaskTable } from '../TaskTable.jsx';
import { TASKS_COLUMN_WIDTHS } from '../../../constants/columnWidths.js';

const TASK = { id: '1', name: 'משימה', statusID: null, responsibilityID: [], deadlineID: null };

describe('TaskTable — resizable column widths (smoke)', () => {
  it('drives the grid template from the shared width defaults (fixed px, name included)', () => {
    render(<TaskTable tasks={[TASK]} />);
    const headerRow = document.querySelector('.taskHead');
    expect(headerRow.style.gridTemplateColumns).toBe(
      `${TASKS_COLUMN_WIDTHS.name.default}px ${TASKS_COLUMN_WIDTHS.assignee.default}px ${TASKS_COLUMN_WIDTHS.deadline.default}px ${TASKS_COLUMN_WIDTHS.status.default}px`
    );
  });

  it('shows a resize handle on every column (incl. name) for owners, none for viewers', () => {
    const { unmount } = render(<TaskTable tasks={[TASK]} canManageSettings />);
    // 4 visible columns (name / assignee / deadline / status) → 4 handles.
    expect(document.querySelectorAll('.taskHead [role="separator"]')).toHaveLength(4);
    unmount();

    render(<TaskTable tasks={[TASK]} />);
    expect(document.querySelectorAll('.taskHead [role="separator"]')).toHaveLength(0);
  });
});
