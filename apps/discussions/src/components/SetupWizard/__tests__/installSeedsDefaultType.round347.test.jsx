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
  await waitFor(() => expect(addDropdownLabel).toHaveBeenCalled());
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

  /*
   * Two ordering rules, both found by review, both pinned here as ONE sequence:
   *   · the TEMPLATE goes first — updateSettings publishes "configured" before its storage
   *     write lands, so SettingsGate can unmount this wizard and mount TemplatesProvider,
   *     which reads the type-template key exactly once. Write after that and the session
   *     holds an empty type list until the app is reloaded.
   *   · the LABEL goes last — addDropdownLabel resolves board+column from the ACTIVE settings
   *     store, which is what updateSettings publishes.
   */
  it('writes the template BEFORE the mapping, and the label after', async () => {
    await install();
    expect(calls).toEqual(['template', 'settings', 'label']);
  });

  /*
   * A populated top-up: the template seeding declines (the account has its own types), so the
   * LABEL must be declined too. Otherwise an established installation gains a selectable
   * "דיון כללי" with no agenda behind it — a change nobody asked for, in someone's live setup.
   */
  it('adds NO label when the template was skipped (populated top-up)', async () => {
    seedDefaultTypeTemplate.mockResolvedValueOnce('skipped-existing');
    render(<SetupWizard onManual={() => {}} />);
    fireEvent.click(await waitFor(() => screen.getByText('צור לוחות אוטומטית')));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(addDropdownLabel).not.toHaveBeenCalled();
    expect(calls).toEqual(['template', 'settings']);
  });

  // Same for a seed that FAILED: a type label with no agenda behind it is worse than neither.
  it('adds NO label when the template seed failed', async () => {
    seedDefaultTypeTemplate.mockResolvedValueOnce('failed');
    render(<SetupWizard onManual={() => {}} />);
    fireEvent.click(await waitFor(() => screen.getByText('צור לוחות אוטומטית')));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(addDropdownLabel).not.toHaveBeenCalled();
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
