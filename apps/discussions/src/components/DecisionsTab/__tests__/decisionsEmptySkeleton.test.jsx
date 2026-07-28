import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// round301 item 1 — with ZERO decisions the tab must still render the TABLE
// SKELETON (column headers) plus the clickable "+ הוסף החלטה" row, exactly like
// the Tasks tab does (TasksTab renders an empty TaskTable when grouped.length===0).
// Creating a decision must be possible from that row, not only from the blue
// "החלטה חדשה" toolbar button.

vi.mock('@generated/hooks/useStatusOptions', () => {
  const useStatusOptions = () => ({
    options: [{ id: 1, index: 0, label: 'בתוקף', color: '#00c875', isDone: true }],
    labelById: { 1: 'בתוקף' }, colorById: { 1: '#00c875' }, orderById: { 1: 0 },
    doneId: 1, loading: false,
  });
  return { useStatusOptions, default: useStatusOptions };
});
vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: () => <div data-testid="person-picker" />,
}));
vi.mock('@generated/components/DatePickerPopover', () => ({
  DatePickerPopover: () => <div data-testid="date-picker" />,
}));
vi.mock('@generated/hooks/usePermission.js', () => ({
  usePermission: () => () => true,
}));
const savedViewMock = vi.hoisted(() => ({ value: null }));
vi.mock('@generated/hooks/useSavedViews.js', () => ({
  useSavedViews: () => ({ view: savedViewMock.value, canSave: false, saveView: () => {} }),
}));
vi.mock('@generated/contexts/MondayContext.jsx', () => ({
  useMondayContext: () => ({ context: {}, currentUser: { id: '1', name: 'בודק' }, isMobile: false }),
  MondayContext: React.createContext(null),
}));

import { setActiveConfig } from '../../../utils/mondayApi/board-config-store.js';
import { DecisionsTab } from '../index.js';

const emptyData = () => ({
  items: [], loading: false, refresh: vi.fn(),
  createDecision: vi.fn(), updateDecisionName: vi.fn(), updateDecisionStatus: vi.fn(),
  updateDecisionTracking: vi.fn(), updateDecisionPriority: vi.fn(), updateDecisionDate: vi.fn(),
  updateDecisionAffected: vi.fn(), updateDecisionDecider: vi.fn(),
  deleteDecision: vi.fn(), softDeleteDecisions: vi.fn(), retryCreate: vi.fn(), dismissRow: vi.fn(),
});

beforeEach(() => {
  savedViewMock.value = null;
  setActiveConfig({ boards: { decisions: { id: 'b-dec' } }, columns: { decisions: {} } });
});

describe('DecisionsTab — empty-state table skeleton (round301)', () => {
  it('ungrouped + zero decisions: renders the column headers and the add-decision row', () => {
    render(
      <DecisionsTab data={emptyData()} discussionId="D1" onNewDecision={vi.fn()}
        onInlineCreate={vi.fn()} onNotify={vi.fn()} canCreateDecision />
    );
    expect(screen.getByText('החלטה')).toBeInTheDocument();
    expect(screen.getByText('סטאטוס')).toBeInTheDocument();
    expect(screen.getByText('+ הוסף החלטה')).toBeInTheDocument();
  });

  it('GROUPED + zero decisions: still renders the headers and the add-decision row', () => {
    // A shared saved view can put the tab in a grouped mode. With no decisions
    // there are no groups, so the grouped branch must fall back to an empty
    // skeleton table instead of rendering nothing at all.
    savedViewMock.value = { group: { col: 'status', order: 'labelAsc' } };
    render(
      <DecisionsTab data={emptyData()} discussionId="D1" onNewDecision={vi.fn()}
        onInlineCreate={vi.fn()} onNotify={vi.fn()} canCreateDecision />
    );
    expect(screen.getByText('החלטה')).toBeInTheDocument();
    expect(screen.getByText('+ הוסף החלטה')).toBeInTheDocument();
  });

  it('a viewer who cannot create decisions gets the empty state, not an add row', () => {
    render(
      <DecisionsTab data={emptyData()} discussionId="D1" onNewDecision={vi.fn()}
        onNotify={vi.fn()} canCreateDecision={false} />
    );
    expect(screen.getByText('אין החלטות עדיין')).toBeInTheDocument();
    expect(screen.queryByText('+ הוסף החלטה')).toBeNull();
  });
});
