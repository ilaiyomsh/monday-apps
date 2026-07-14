import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROW_NAME = 'דיון לבדיקה';

// A mutable row the mock returns — tests set its people columns per case. The
// people aliases are arrays so the resolver's `discussionReady` gate passes.
let currentRow = {
  id: 'D1',
  name: ROW_NAME,
  discussionDateID: null,
  discussionCreatorID: [],
  discussionLeadID: [],
};

vi.mock('@generated/hooks/useDiscussions', () => ({
  useDiscussions: () => ({
    items: [currentRow],
    loading: false,
    refetching: false,
    loadingMore: false,
    cursor: null,
    loadMore: () => {},
    softDeleteDiscussion: () => ({ undo: () => {} }),
  }),
  // The list now also derives its month-filter options from this hook; the gate
  // tests don't exercise the dropdown, so a stable empty set is enough.
  useDiscussionMonths: () => ({ months: [], loading: false }),
}));

vi.mock('@generated/hooks/useStatusOptions.js', () => ({
  useStatusOptions: () => ({ options: [], colorById: {} }),
}));

import { DiscussionList } from '../DiscussionList.jsx';
import { SettingsContext } from '../../../contexts/SettingsContext.jsx';
import { DEFAULT_PERMISSIONS } from '../../../utils/mondayApi/boards.config.js';

/* Render the list inside a SettingsContext providing the given permissions blob.
   usePermission reads `permissions` from useSettings() and MondayContext softly,
   so DiscussionList's canManageSettings/currentUser props drive the resolver. */
function renderList({ permissions = DEFAULT_PERMISSIONS, canManageSettings = false, currentUser = null } = {}) {
  const value = {
    settings: { permissions },
    permissions,
    isConfigured: true,
    isLoading: false,
    updateSettings: async () => null,
  };
  return render(
    <SettingsContext.Provider value={value}>
      <DiscussionList
        onSelect={() => {}}
        onEdit={() => {}}
        onExport={() => {}}
        onDelete={() => {}}
        canManageSettings={canManageSettings}
        currentUser={currentUser}
      />
    </SettingsContext.Provider>
  );
}

// Open the row's kebab menu (the export item is portal-rendered on open).
function openRowMenu() {
  const kebab = screen.getByRole('button', { name: `פעולות עבור ${ROW_NAME}` });
  fireEvent.click(kebab);
  return screen.getByRole('menu');
}

describe('DiscussionList — exportDocs gate on the row export control', () => {
  beforeEach(() => {
    currentRow = {
      id: 'D1',
      name: ROW_NAME,
      discussionDateID: null,
      discussionCreatorID: [],
      discussionLeadID: [],
    };
  });

  it('shows "ייצוא" when the owner bypass grants export', () => {
    // Owner (canManageSettings) → resolver allows every cap, incl. exportDocs.
    renderList({ canManageSettings: true, currentUser: { id: '999' } });
    const menu = openRowMenu();
    expect(within(menu).getByText('ייצוא')).toBeTruthy();
  });

  it('shows "ייצוא" for the discussion creator (feature on, non-owner)', () => {
    currentRow.discussionCreatorID = [{ id: '999' }];
    const permissions = { enabled: true, version: 1, roles: {} };
    renderList({ permissions, canManageSettings: false, currentUser: { id: '999' } });
    const menu = openRowMenu();
    expect(within(menu).getByText('ייצוא')).toBeTruthy();
  });

  it('hides "ייצוא" for a non-creator/lead/owner when the feature is on', () => {
    // Feature ON, no role grants exportDocs, user is neither creator nor lead nor
    // owner → default bucket creatorLeadOwner → DENY → export item withheld.
    const permissions = { enabled: true, version: 1, roles: {} };
    renderList({ permissions, canManageSettings: false, currentUser: { id: '999' } });
    const menu = openRowMenu();
    expect(within(menu).queryByText('ייצוא')).toBeNull();
    // The menu still renders (other controls are independently gated).
    expect(menu).toBeTruthy();
  });
});
