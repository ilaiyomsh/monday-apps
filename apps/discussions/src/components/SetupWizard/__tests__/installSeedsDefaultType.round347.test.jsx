import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round347 (owner spec) — the INSTALL is what seeds the starting point: the discussion type
 * "דיון כללי" and its agenda template, with the installing user as מנהל + מרכז הדיון.
 *
 * Two stores have to agree, and this file pins that both are written and in which order:
 *   1. the LABEL on the managed "סוג דיון" dropdown — what a discussion actually stores;
 *   2. the TYPE TEMPLATE in monday.storage — the agenda + roles, keyed by that label's TEXT.
 * Seeding one without the other gives a type with no agenda, or an agenda for a type nobody
 * can pick.
 *
 * The ORDERING against updateSettings is the subtle part: `addDropdownLabel` resolves the
 * board + column from the ACTIVE settings store, which `updateSettings` is what publishes. Run
 * it first and it fails with "missing board/column" on every fresh install.
 */

const PROVISIONED = {
  boards: { discussions: { id: '1' }, tasks: { id: '2' }, topics: { id: '3' }, decisions: { id: '4' } },
  columns: {
    discussions: { discussionTypeID: { id: 'dd', type: 'dropdown', title: 'סוג דיון', managedColumnId: 'mc-1' } },
  },
};
const calls = [];
const provisionAllBoards = vi.fn(async () => PROVISIONED);
const addDropdownLabel = vi.fn(async () => ({ id: 1 }));
const seedDefaultTypeTemplate = vi.fn(async () => 'seeded');

vi.mock('../../../utils/mondayApi/provisionBoards.js', () => ({
  provisionAllBoards: (...a) => provisionAllBoards(...a),
}));
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({ api: vi.fn(async () => ({ boards: [{ columns: [] }] })) }));
vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  addDropdownLabel: (...a) => { calls.push('label'); return addDropdownLabel(...a); },
}));
vi.mock('@generated/utils/defaultTypeTemplate.js', () => ({
  DEFAULT_DISCUSSION_TYPE: 'דיון כללי',
  seedDefaultTypeTemplate: (...a) => { calls.push('template'); return seedDefaultTypeTemplate(...a); },
}));
const updateSettings = vi.fn(async () => { calls.push('settings'); return {}; });
vi.mock('../../../contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({ settings: null, updateSettings, isConfigured: false, isLoading: false, permissions: {} }),
}));
vi.mock('../../../contexts/MondayContext.jsx', () => ({
  useMondayContext: () => ({
    context: { boardId: '1', workspaceId: '9', instanceId: 'i1' },
    currentUser: { id: '7', name: 'עידו' },
  }),
}));
vi.mock('@generated/components/PartyProgress', () => ({ PartyProgress: () => <div /> }));

import { SetupWizard } from '../SetupWizard.jsx';

const install = async () => {
  render(<SetupWizard onManual={() => {}} />);
  fireEvent.click(await waitFor(() => screen.getByText('צור לוחות אוטומטית')));
  await waitFor(() => expect(seedDefaultTypeTemplate).toHaveBeenCalled());
};

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  addDropdownLabel.mockResolvedValue({ id: 1 });
  seedDefaultTypeTemplate.mockResolvedValue('seeded');
});

describe('round347 — the install seeds the default type and its template', () => {
  it('adds the "דיון כללי" label to the discussions type column', async () => {
    await install();
    expect(addDropdownLabel).toHaveBeenCalledWith({
      boardKey: 'discussions', alias: 'discussionTypeID', title: 'דיון כללי',
    });
  });

  it('seeds the type template with the installing user', async () => {
    await install();
    expect(seedDefaultTypeTemplate).toHaveBeenCalledWith(
      { boardId: '1', workspaceId: '9', instanceId: 'i1' },
      { id: '7', name: 'עידו' }
    );
  });

  // The ordering rule, and the reason it is a rule: addDropdownLabel reads the ACTIVE settings
  // store, which updateSettings publishes. Seeding before the save fails on every install.
  it('seeds AFTER the mapping is saved', async () => {
    await install();
    expect(calls).toEqual(['settings', 'label', 'template']);
  });

  /*
   * A failed label add must not take the install down: the boards and mapping are already
   * saved, and the owner can add the type by hand in תבניות. The template is still seeded —
   * an agenda waiting for a type is recoverable, a half-failed install is not.
   */
  it('still finishes, and still seeds the template, when the label add fails', async () => {
    addDropdownLabel.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    await install();
    expect(seedDefaultTypeTemplate).toHaveBeenCalled();
    expect(screen.queryByText(/אירעה שגיאה בהקמת הלוחות/)).toBeNull();
  });
});
