import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round317 (owner request) — the install itself must SAVE the access-column
 * auto-fill roles (יוצר + מוביל/מנהל + מרכז דיון on יכולת עריכה). They used to be a
 * fallback only: the stored settings never said so.
 *
 * round340 — "יכולת צפייה" was retired, so the install must seed exactly one key.
 */

const PROVISIONED = {
  boards: { discussions: { id: '1' }, tasks: { id: '2' }, topics: { id: '3' }, decisions: { id: '4' } },
  columns: { tasks: { taskEditorsID: { id: 'ed', type: 'people', title: 'יכולת עריכה' } } },
};
const provisionAllBoards = vi.fn(async () => PROVISIONED);
vi.mock('../../../utils/mondayApi/provisionBoards.js', () => ({
  provisionAllBoards: (...a) => provisionAllBoards(...a),
}));
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ boards: [{ columns: [] }] })),
}));
// The wizard's settings context: we record what it persists.
const updateSettings = vi.fn(async () => ({}));
let settings = null;
vi.mock('../../../contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({ settings, updateSettings, isConfigured: false, isLoading: false, permissions: {} }),
}));
vi.mock('../../../contexts/MondayContext.jsx', () => ({
  useMondayContext: () => ({ context: { boardId: '1', workspaceId: '9', instanceId: 'i1' } }),
}));
vi.mock('@generated/components/PartyProgress', () => ({ PartyProgress: () => <div /> }));

import { SetupWizard } from '../SetupWizard.jsx';

const install = async () => {
  render(<SetupWizard onManual={() => {}} />);
  fireEvent.click(await waitFor(() => screen.getByText('צור לוחות אוטומטית')));
  await waitFor(() => expect(updateSettings).toHaveBeenCalled());
  return updateSettings.mock.calls.at(-1)[0];
};

beforeEach(() => {
  settings = null;
  vi.clearAllMocks();
});

describe('a fresh install', () => {
  /*
   * round340 — a deep equality, not a per-key check, on purpose: the failure this
   * pins is a RETIRED key being seeded back into fresh settings, which only a
   * whole-object comparison can catch.
   */
  it('SAVES the three edit roles and nothing else, alongside the mapping', async () => {
    const saved = await install();
    expect(saved.boards).toEqual(PROVISIONED.boards);
    expect(saved.preferences.accessRoleSources).toEqual({
      taskEditorsID: ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID'],
    });
  });
});

describe('a top-up of an existing instance', () => {
  it('does NOT override a list the owner already configured', async () => {
    settings = { preferences: { accessRoleSources: { taskEditorsID: ['discussionCreatorID'] } } };
    const saved = await install();
    expect(saved.preferences.accessRoleSources.taskEditorsID).toEqual(['discussionCreatorID']);
    // …and does not resurrect the retired viewers key while it is at it.
    expect(saved.preferences.accessRoleSources).not.toHaveProperty('taskViewersID');
  });

  it('keeps the owner\'s other preferences', async () => {
    settings = { preferences: { logoUrl: 'data:x', showMyTasks: true } };
    const saved = await install();
    expect(saved.preferences.logoUrl).toBe('data:x');
    expect(saved.preferences.showMyTasks).toBe(true);
    expect(saved.preferences.accessRoleSources.taskEditorsID).toHaveLength(3);
  });
});
