import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Force a custom persisted order: status BEFORE assignee (default is assignee
// then deadline then status). Header cells must follow this order.
vi.mock('../../../hooks/useColumnOrder.js', () => ({
  useColumnOrder: () => ({ order: ['name', 'status', 'assignee', 'deadline'], reorder: () => {} }),
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

describe('TaskTable — column order (smoke)', () => {
  it('renders header cells in the persisted order (status before assignee)', () => {
    render(<TaskTable tasks={[TASK]} />);
    const headerRow = document.querySelector('.taskHead');
    const texts = [...headerRow.querySelectorAll('.taskCell')].map((c) => c.textContent.trim());
    expect(texts.indexOf('סטאטוס')).toBeLessThan(texts.indexOf('אחראי'));
  });
});
