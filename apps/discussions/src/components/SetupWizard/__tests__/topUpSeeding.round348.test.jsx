import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round348 — two review findings on round347's seeding, both about the TOP-UP flow (the wizard
 * embedded in the Settings modal, on an already-configured instance):
 *
 * 1. TemplatesProvider is already MOUNTED there and has loaded its type templates exactly once.
 *    A direct `monday.storage` write therefore never reaches its in-memory list: the new type
 *    looks selectable while `CreateDiscussionModal` still sees `typeTemplates = []`, so a
 *    discussion created in that session gets no agenda and no roles until the app is reloaded.
 *    Seeding now goes THROUGH the provider whenever one is mounted.
 *
 * 2. If the label mutation failed once after the template was persisted, every later run read
 *    `skipped-existing` and never retried the label — an orphaned agenda with no selectable
 *    type. `already-default` now distinguishes "ours is here, reconcile the label" from "this
 *    account has its own types, leave it alone".
 *
 * The mocks here deliberately do NOT stub defaultTypeTemplate.js: the point is which PATH the
 * write takes, so the real module runs and the storage spy shows whether it was bypassed.
 */

const PROVISIONED = {
  boards: { discussions: { id: '1' }, tasks: { id: '2' }, topics: { id: '3' }, decisions: { id: '4' } },
  columns: { discussions: { discussionTypeID: { id: 'dd', type: 'dropdown', title: 'סוג דיון' } } },
};
const storage = { getItem: vi.fn(async () => ({ data: { value: null } })), setItem: vi.fn(async () => ({})) };
const provisionAllBoards = vi.fn(async () => PROVISIONED);
const addDropdownLabel = vi.fn(async () => ({ id: 1 }));
const upsertTypeTemplate = vi.fn(async (t) => t);

vi.mock('../../../utils/mondayApi/provisionBoards.js', () => ({
  provisionAllBoards: (...a) => provisionAllBoards(...a),
}));
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ boards: [{ columns: [] }] })),
  monday: { storage: { getItem: (...a) => storage.getItem(...a), setItem: (...a) => storage.setItem(...a) } },
  formatValue: vi.fn(),
}));
vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  addDropdownLabel: (...a) => addDropdownLabel(...a),
}));
const updateSettings = vi.fn(async () => ({}));
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
import { TemplatesContext } from '../../../contexts/TemplatesContext.jsx';

// A MOUNTED, LOADED provider — the top-up world. `typeTemplates` is what it has already read.
const withProvider = (typeTemplates, loading = false) => render(
  <TemplatesContext.Provider value={{ typeTemplates, upsertTypeTemplate, loading }}>
    <SetupWizard onManual={() => {}} />
  </TemplatesContext.Provider>
);

const clickCreate = async () => {
  fireEvent.click(await waitFor(() => screen.getByText('צור לוחות אוטומטית')));
  await waitFor(() => expect(updateSettings).toHaveBeenCalled());
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.getItem.mockImplementation(async () => ({ data: { value: null } }));
  storage.setItem.mockImplementation(async () => ({}));
  addDropdownLabel.mockImplementation(async () => ({ id: 1 }));
  upsertTypeTemplate.mockImplementation(async (t) => t);
});

describe('round348 — top-up seeds through the mounted provider', () => {
  /*
   * The fix for finding 1. Asserting the provider call is only half of it: the storage write must
   * be ABSENT, because a direct write is precisely the bypass that left the provider stale.
   */
  it('writes via upsertTypeTemplate and NOT straight to storage', async () => {
    withProvider([]);
    await clickCreate();
    await waitFor(() => expect(upsertTypeTemplate).toHaveBeenCalled());
    expect(storage.setItem).not.toHaveBeenCalled();
    const seeded = upsertTypeTemplate.mock.calls[0][0];
    expect(seeded.discussionType).toBe('דיון כללי');
    expect(seeded.topics).toHaveLength(3);
    expect(seeded.lead).toEqual([{ id: '7', kind: 'person', name: 'עידו' }]);
    expect(seeded.coordinator).toEqual([{ id: '7', kind: 'person', name: 'עידו' }]);
  });

  // With no provider (first run, wizard mounted above it) the direct storage write is correct —
  // the provider mounts afterwards and reads what we wrote.
  it('falls back to a direct storage write when no provider is mounted', async () => {
    render(<SetupWizard onManual={() => {}} />);
    await clickCreate();
    await waitFor(() => expect(storage.setItem).toHaveBeenCalled());
    expect(upsertTypeTemplate).not.toHaveBeenCalled();
    expect(storage.setItem.mock.calls[0][0]).toBe('discussions_type_templates_i1');
  });

  // An account with its OWN types is left alone — no template write, and no label either.
  it('touches nothing when the provider already holds other types', async () => {
    withProvider([{ id: 'x', discussionType: 'הנהלה', topics: [] }]);
    await clickCreate();
    expect(upsertTypeTemplate).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(addDropdownLabel).not.toHaveBeenCalled();
  });

  /*
   * The fix for finding 2: our default is already in the store, so the template is not rewritten
   * — but the LABEL is retried, because a failed label add is exactly how an install ends up
   * with an agenda nobody can select.
   */
  it('re-attempts the LABEL when our default template already exists', async () => {
    withProvider([{ id: 'seed-default-type', discussionType: 'דיון כללי', topics: [] }]);
    await clickCreate();
    await waitFor(() => expect(addDropdownLabel).toHaveBeenCalled());
    expect(addDropdownLabel).toHaveBeenCalledWith({
      boardKey: 'discussions', alias: 'discussionTypeID', title: 'דיון כללי',
    });
    expect(upsertTypeTemplate).not.toHaveBeenCalled();
  });

  // A provider write that throws is reported, not fatal — and then the label is not added,
  // since there would be no agenda behind it.
  it('survives a provider write that throws, without adding the label', async () => {
    upsertTypeTemplate.mockRejectedValueOnce(new Error('storage down'));
    withProvider([]);
    await clickCreate();
    expect(addDropdownLabel).not.toHaveBeenCalled();
    expect(screen.queryByText(/אירעה שגיאה בהקמת הלוחות/)).toBeNull();
  });

  /*
   * round348 (review finding) — a MOUNTED provider is not a LOADED one. `typeTemplates` is `[]`
   * while its storage reads are still in flight, so seeding through it in that window would
   * persist our singleton default OVER the account's real types. The durable store is the only
   * honest source until loading finishes: this must go to storage, and the provider must NOT be
   * written to (that write is what would destroy data).
   */
  it('does NOT write through a provider that is still loading', async () => {
    withProvider([], true);
    await clickCreate();
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    expect(upsertTypeTemplate).not.toHaveBeenCalled();
  });

  it('and in that window it respects the types already in durable storage', async () => {
    storage.getItem.mockImplementation(async () => ({
      data: { value: JSON.stringify({ templates: [{ id: 'x', discussionType: 'הנהלה', topics: [] }] }) },
    }));
    withProvider([], true);
    await clickCreate();
    expect(upsertTypeTemplate).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(addDropdownLabel).not.toHaveBeenCalled();
  });

  /*
   * round348 (review finding) — the provider write must be STRICT. `persistTypes` otherwise logs
   * a storage failure and resolves anyway, so we would report "seeded" for a write that never
   * landed and then add the label: a selectable type with no agenda after the next reload.
   */
  it('asks the provider for a STRICT write', async () => {
    withProvider([]);
    await clickCreate();
    await waitFor(() => expect(upsertTypeTemplate).toHaveBeenCalled());
    expect(upsertTypeTemplate.mock.calls[0][1]).toEqual({ strict: true });
  });
});
