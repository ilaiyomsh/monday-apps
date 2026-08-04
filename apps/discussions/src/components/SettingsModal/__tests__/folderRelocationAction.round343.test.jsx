import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round343 (review finding on the round342 action) — "ריכוז הלוחות בתיקייה" acted on the
 * PERSISTED settings instead of the draft on screen:
 *
 *   "When an owner remaps a board in the Mapping tab and clicks this action before saving,
 *    settings still contains the previously persisted IDs — the current selections are held
 *    in the local `boards` state. The action therefore relocates the OLD boards and resolves
 *    the folder workspace from the OLD discussions board; in first-run manual configuration
 *    it can instead create an empty folder and move nothing."
 *
 * Two defects, tested separately: the stale read (DOM — it can only be shown by making the
 * draft DIFFER from storage) and the missing empty guard (pure — a folder must never be
 * minted for an instance with nothing mapped).
 */

const moveBoardsIntoProvisionFolder = vi.fn(async () => ({ folderId: 'F1', moved: ['discussions', 'topics', 'tasks', 'decisions'], failed: [] }));
const resolveWorkspaceId = vi.fn(async () => '999');
vi.mock('../../../utils/mondayApi/provisionBoards.js', () => ({
  moveBoardsIntoProvisionFolder: (...a) => moveBoardsIntoProvisionFolder(...a),
  resolveWorkspaceId: (...a) => resolveWorkspaceId(...a),
  PROVISION_FOLDER_NAME: 'בסיס מידע',
}));

// The persisted mapping — every board id here is the OLD one the action must NOT touch
// once the draft has moved on.
const STORED = {
  boards: { discussions: { id: 'OLD_D' }, topics: { id: 'OLD_T' }, tasks: { id: 'OLD_K' }, decisions: { id: 'OLD_C' } },
  columns: {},
};
const storage = {
  getItem: vi.fn(async (key) => (
    String(key).startsWith('discussions_settings')
      ? { data: { value: JSON.stringify(STORED) } }
      : { data: { value: null } }
  )),
  setItem: vi.fn(async () => ({})),
};
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: { getItem: (...a) => storage.getItem(...a), setItem: (...a) => storage.setItem(...a) },
    api: vi.fn(async () => ({ data: {} })),
  },
  api: vi.fn(async () => ({ boards: [{ columns: [] }] })),
  API_VERSION: '2026-07',
  ensureUserPhotoSelection: async () => 'photo_url { small }',
  normalizePhoto: () => null,
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: vi.fn(), getBoardId: () => null, getColumns: () => ({}),
}));
vi.mock('../../../utils/mondayApi/subscribers.js', () => ({ getBoardPeople: async () => [] }));

import {
  SettingsModal,
  relocateBoardsToFolder,
  pickMappedBoards,
  NO_BOARDS_TO_RELOCATE,
} from '../SettingsModal.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';

const Host = () => (
  <MondayContext.Provider value={{ context: { instanceId: 'i1', boardId: 'OLD_D' }, user: null }}>
    <SettingsProvider>
      <SettingsModal isOpen onClose={() => {}} templatesOnly={false} />
    </SettingsProvider>
  </MondayContext.Provider>
);

beforeEach(() => {
  vi.clearAllMocks();
  moveBoardsIntoProvisionFolder.mockResolvedValue({ folderId: 'F1', moved: ['discussions'], failed: [] });
  resolveWorkspaceId.mockResolvedValue('999');
});

describe('round343 — the relocation action reads the DRAFT', () => {
  it('moves the boards the owner just picked, not the ones still in storage', async () => {
    render(<Host />);
    // Wait until the stored mapping has loaded into the draft.
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('העדפות')).toBeTruthy());

    /*
     * Remapping through the board picker is a @vibe Dropdown (not drivable in jsdom), so
     * the draft is moved via the modal's OWN settings-import path — the same
     * `setBoards` draft state a picker selection writes to, and nothing is persisted by
     * it (the user still has to press שמור). That is exactly the pre-save state the
     * finding describes.
     */
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const NEW_BOARDS = {
      discussions: { id: 'NEW_D' }, topics: { id: 'NEW_T' },
      tasks: { id: 'NEW_K' }, decisions: { id: 'NEW_C' },
    };
    const json = JSON.stringify({ boards: NEW_BOARDS, columns: {} });
    const file = new File([json], 'settings.json', { type: 'application/json' });
    // jsdom's File does not implement Blob.text() (checked, not assumed), and the import
    // handler reads the file with it — so it is stubbed on this one instance.
    file.text = async () => json;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/הקובץ נטען/)).toBeTruthy());

    fireEvent.click(screen.getByText('העדפות'));
    const btn = await waitFor(() => screen.getByText('העברת הלוחות לתיקייה'));
    fireEvent.click(btn);

    await waitFor(() => expect(moveBoardsIntoProvisionFolder).toHaveBeenCalled());
    // The workspace is resolved from the DRAFT's discussions board...
    expect(resolveWorkspaceId).toHaveBeenCalledWith('NEW_D', null);
    // ...and every id handed to the move is the draft's, with no stored id surviving.
    const passed = moveBoardsIntoProvisionFolder.mock.calls[0][0];
    expect(Object.values(passed).map((b) => b.id).sort()).toEqual(['NEW_C', 'NEW_D', 'NEW_K', 'NEW_T']);
    expect(JSON.stringify(passed)).not.toContain('OLD_');
    // And nothing was persisted on the way — the draft is still a draft.
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('round343 — relocateBoardsToFolder', () => {
  // The empty guard. Returning early is the POINT: reaching the helper would create the
  // folder (ensureProvisionFolder runs before the first move) and move nothing.
  it('never touches the API when nothing is mapped', async () => {
    expect(await relocateBoardsToFolder({})).toBe(NO_BOARDS_TO_RELOCATE);
    expect(await relocateBoardsToFolder({ discussions: { id: '' }, tasks: {} })).toBe(NO_BOARDS_TO_RELOCATE);
    expect(await relocateBoardsToFolder(null)).toBe(NO_BOARDS_TO_RELOCATE);
    expect(moveBoardsIntoProvisionFolder).not.toHaveBeenCalled();
    expect(resolveWorkspaceId).not.toHaveBeenCalled();
  });

  // A partially-mapped instance still relocates what it CAN — and the unmapped roles are
  // dropped rather than passed through as blank ids.
  it('passes only the boards that have an id', async () => {
    await relocateBoardsToFolder({ discussions: { id: 'D' }, topics: { id: '' }, tasks: { id: 'K' } });
    expect(moveBoardsIntoProvisionFolder).toHaveBeenCalledWith({ discussions: { id: 'D' }, tasks: { id: 'K' } }, '999');
  });

  /*
   * Second review finding: the workspace was read off `mapped.discussions` only, so a
   * partially-configured instance with no discussions board passed `undefined` →
   * resolveWorkspaceId → null → "main workspace". The folder would then be created in the
   * wrong workspace and the relocation would drag the mapped board out of its own.
   */
  it('resolves the workspace off a mapped board when discussions is absent', async () => {
    await relocateBoardsToFolder({ discussions: { id: '' }, tasks: { id: 'K' }, decisions: { id: 'C' } });
    expect(resolveWorkspaceId).toHaveBeenCalledWith('K', null);
  });

  // ...and prefers the discussions board when there IS one, since that is the host.
  it('still prefers the discussions board', async () => {
    await relocateBoardsToFolder({ topics: { id: 'T' }, discussions: { id: 'D' } });
    expect(resolveWorkspaceId).toHaveBeenCalledWith('D', null);
  });

  it('reports the real counts, including a partial failure', async () => {
    moveBoardsIntoProvisionFolder.mockResolvedValueOnce({ folderId: 'F1', moved: ['discussions', 'tasks'], failed: ['topics'] });
    expect(await relocateBoardsToFolder({ discussions: { id: 'D' } })).toBe('2 לוחות הועברו, 1 נכשלו');
    moveBoardsIntoProvisionFolder.mockResolvedValueOnce({ folderId: 'F1', moved: ['discussions', 'tasks'], failed: [] });
    expect(await relocateBoardsToFolder({ discussions: { id: 'D' } })).toBe('2 לוחות הועברו לתיקייה');
  });

  it('says the folder failed, and survives a thrown move', async () => {
    moveBoardsIntoProvisionFolder.mockResolvedValueOnce({ folderId: null, moved: [], failed: ['discussions'] });
    expect(await relocateBoardsToFolder({ discussions: { id: 'D' } })).toBe('יצירת התיקייה נכשלה — נסו שוב');
    moveBoardsIntoProvisionFolder.mockRejectedValueOnce(new Error('boom'));
    expect(await relocateBoardsToFolder({ discussions: { id: 'D' } })).toBe('ההעברה נכשלה');
  });

  it('pickMappedBoards keeps ids and drops blanks', () => {
    expect(pickMappedBoards({ a: { id: '1' }, b: { id: '' }, c: null })).toEqual({ a: { id: '1' } });
  });
});
