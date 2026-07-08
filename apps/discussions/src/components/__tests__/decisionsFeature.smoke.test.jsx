import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Status/priority options resolve via useStatusOptions; mock it (same shape as
// componentRender.smoke) so no SDK call fires and a known label is available.
vi.mock('@generated/hooks/useStatusOptions', () => {
  const useStatusOptions = () => ({
    options: [{ id: 1, index: 0, label: 'בתוקף', color: '#00c875', isDone: true }],
    labelById: { 1: 'בתוקף' },
    colorById: { 1: '#00c875' },
    orderById: { 1: 0 },
    doneId: 1,
    loading: false,
  });
  return { useStatusOptions, default: useStatusOptions };
});
// Keep the quick-create render hermetic: the pickers own their SDK/overlay
// concerns and have their own coverage.
vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: () => <div data-testid="person-picker" />,
}));
vi.mock('@generated/components/DatePickerPopover', () => ({
  DatePickerPopover: () => <div data-testid="date-picker" />,
}));
// MyDecisionsView pulls the whole My-Tasks toolbar stack; stub its data hooks —
// this smoke only asserts the unmapped-board empty state renders.
vi.mock('@generated/hooks/useMyDecisions.js', () => {
  const useMyDecisions = () => ({
    items: [], loading: false, loadingMore: false, cursor: null, hasMore: false,
    error: null, userId: '1', configured: false,
    loadMore: () => {}, updateDecisionStatus: () => {}, updateDecisionPriority: () => {},
    updateDecisionDate: () => {}, refresh: () => {},
  });
  return { useMyDecisions, default: useMyDecisions };
});
vi.mock('@generated/hooks/useDiscussions.js', () => ({
  useDiscussions: () => ({ items: [], loading: false }),
}));
vi.mock('@generated/hooks/usePermission.js', () => ({
  usePermission: () => () => true,
}));
vi.mock('@generated/hooks/useSavedViews.js', () => ({
  useSavedViews: () => ({ view: null, canSave: false, saveView: () => {} }),
}));
vi.mock('@generated/contexts/MondayContext.jsx', () => ({
  useMondayContext: () => ({ context: {}, currentUser: { id: '1', name: 'בודק' }, isMobile: false }),
  MondayContext: React.createContext(null),
}));

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { DecisionsTab } from '../DecisionsTab';
import { QuickCreateModal } from '../QuickCreateModal';
import { MyDecisionsView } from '../MyDecisionsView';

const decisionsDataStub = (items = []) => ({
  items, loading: false, refresh: vi.fn(),
  createDecision: vi.fn(), updateDecisionName: vi.fn(), updateDecisionStatus: vi.fn(),
  updateDecisionPriority: vi.fn(), updateDecisionDate: vi.fn(), updateDecisionAffected: vi.fn(),
  deleteDecision: vi.fn(), softDeleteDecisions: vi.fn(),
});

beforeEach(() => {
  // UNMAPPED decisions board by default; the mapped test overrides.
  setActiveConfig({ boards: { decisions: { id: '' } }, columns: { decisions: {} } });
});

describe('decisions feature render smoke', () => {
  it('DecisionsTab shows the unmapped-board empty state and no table', () => {
    render(
      <DecisionsTab data={decisionsDataStub()} onNewDecision={vi.fn()} onNotify={vi.fn()} canDecision={() => false} canCreateDecision={false} />
    );
    expect(screen.getByText('לוח ההחלטות טרם הוגדר — מפו אותו בהגדרות')).toBeInTheDocument();
  });

  it('DecisionsTab (mapped, read-only) renders a decision row with its status label', () => {
    setActiveConfig({ boards: { decisions: { id: 'b-dec' } }, columns: { decisions: {} } });
    const items = [{
      id: 'd1', name: 'לאשר גיוס של 3 עובדים', deciderID: [], affectedID: [],
      decisionStatusID: 1, decisionPriorityID: null, decisionDateID: '2026-07-07',
    }];
    render(
      <DecisionsTab data={decisionsDataStub(items)} onNewDecision={vi.fn()} onNotify={vi.fn()} canDecision={() => false} canCreateDecision={false} />
    );
    expect(screen.getByText('לאשר גיוס של 3 עובדים')).toBeInTheDocument();
    expect(screen.getByText('בתוקף')).toBeInTheDocument();
  });

  it('QuickCreateModal toggles decision/task modes and fires onCreate with the typed text', () => {
    const onCreate = vi.fn();
    render(
      <QuickCreateModal
        open initialMode="task" scopedPoint={null}
        discussion={{ name: 'ישיבת הנהלה' }} participants={[]} currentUser={null}
        onClose={vi.fn()} onCreate={onCreate}
      />
    );
    expect(screen.getByPlaceholderText('שם המשימה *')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'החלטה' }));
    const input = screen.getByPlaceholderText('מה ההחלטה? *');
    fireEvent.change(input, { target: { value: 'החלטה חדשה לבדיקה' } });
    fireEvent.click(screen.getByRole('button', { name: 'צור החלטה' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const [kind, payload] = onCreate.mock.calls[0];
    expect(kind).toBe('decision');
    expect(payload.text).toBe('החלטה חדשה לבדיקה');
  });

  it('MyDecisionsView shows the unmapped-board empty state', () => {
    render(<MyDecisionsView canManageSettings={false} onBackToDiscussions={vi.fn()} onNotify={vi.fn()} />);
    expect(screen.getByText('לוח ההחלטות טרם הוגדר')).toBeInTheDocument();
  });
});
