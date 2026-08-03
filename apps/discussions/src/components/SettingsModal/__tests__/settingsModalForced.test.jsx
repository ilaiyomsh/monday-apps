import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round337 (audit finding #2) — the forced (first-run) mount contract:
 * WITHOUT an onClose prop the settings modal renders NO close button at all.
 *
 * Before this round SettingsGate passed `onClose={() => {}}` — truthy, so the X
 * rendered and attemptClose's `if (!onClose) return` guard never fired: a brand
 * new user's very first screen carried a close button that silently did nothing
 * (or opened an unsaved-changes dialog whose exit button also did nothing).
 * Now the gate passes NO onClose and the modal hides the X for that case; a
 * normal (gear-opened) mount still shows it.
 *
 * Mocks mirror logoUploadRace.test.jsx — the modal pulls the monday client
 * transitively through its tabs.
 */

const storage = { getItem: vi.fn(async () => ({ data: { value: null } })), setItem: vi.fn(async () => ({})) };
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: { getItem: (...a) => storage.getItem(...a), setItem: (...a) => storage.setItem(...a) },
    api: vi.fn(async () => ({ data: {} })),
  },
  api: vi.fn(async () => ({})),
  API_VERSION: '2026-07',
  ensureUserPhotoSelection: async () => 'photo_url { small }',
  normalizePhoto: () => null,
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: vi.fn(),
  getBoardId: () => null,
  getColumns: () => ({}),
}));

import { SettingsModal } from '../SettingsModal.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';

function mount(props) {
  const ctxValue = { context: { instanceId: 'i1', boardId: 'b1' }, currentUser: null, isMobile: false };
  return render(
    <MondayContext.Provider value={ctxValue}>
      <SettingsProvider>
        <SettingsModal isOpen templatesOnly={false} {...props} />
      </SettingsProvider>
    </MondayContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.getItem.mockImplementation(async () => ({ data: { value: null } }));
});

describe('round337 — forced mount hides the close button', () => {
  it('renders NO סגירה button when mounted without onClose', async () => {
    await act(async () => { mount({}); });
    expect(screen.queryByLabelText('סגירה')).toBeNull();
  });

  it('still renders the סגירה button on a normal mount (onClose given)', async () => {
    await act(async () => { mount({ onClose: () => {} }); });
    expect(screen.getByLabelText('סגירה')).toBeInTheDocument();
  });
});
