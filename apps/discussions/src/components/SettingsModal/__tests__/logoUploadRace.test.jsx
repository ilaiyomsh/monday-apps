import React, { useState } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round311 (PR review on the 2.3.8 release) — a logo decode that is still running
 * when the owner leaves the העדפות session must be DROPPED, not applied.
 *
 * App.jsx keeps SettingsModal permanently mounted with `isOpen={showSettings}`,
 * so closing it does not unmount the component and a pending
 * `fileToLogoDataUrl` still resolves into live draft state. Close → reopen →
 * decode finishes therefore used to inject the cancelled logo into the NEW
 * editing session, where an unrelated שמור would persist it.
 *
 * These tests drive the real component with a decode we resolve by hand, because
 * the bug lives entirely in WHEN the continuation runs — a pure-function test of
 * the guard would prove nothing.
 */

// --- storage: nothing stored, so the modal seeds from defaults ---------------
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

// --- the decode we control --------------------------------------------------
let pending = null;
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
vi.mock('../../../utils/imageLogo.js', () => ({
  LOGO_MAX_PX: 320,
  fileToLogoDataUrl: vi.fn(() => {
    pending = deferred();
    return pending.promise;
  }),
}));

import { SettingsModal } from '../SettingsModal.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const PREVIEW_ALT = 'הלוגו הנוכחי';

// A host that mirrors App.jsx: the modal stays MOUNTED and only `isOpen` flips.
function Host() {
  const [open, setOpen] = useState(true);
  return (
    <MondayContext.Provider value={{ context: { instanceId: 'i1', boardId: 'b1' }, user: null }}>
      <SettingsProvider>
        <button type="button" onClick={() => setOpen((v) => !v)}>toggle</button>
        <SettingsModal isOpen={open} onClose={() => setOpen(false)} templatesOnly={false} />
      </SettingsProvider>
    </MondayContext.Provider>
  );
}

const toggle = () => fireEvent.click(screen.getByText('toggle'));
const pickFile = () => {
  const input = document.querySelector('input[type="file"]');
  const file = new File(['x'], 'logo.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
};
// The upload row lives on the העדפות tab.
const openPreferences = async () => {
  await waitFor(() => expect(screen.getByText('העדפות')).toBeTruthy());
  fireEvent.click(screen.getByText('העדפות'));
  await waitFor(() => expect(document.querySelector('input[type="file"]')).toBeTruthy());
};

beforeEach(() => {
  pending = null;
  vi.clearAllMocks();
  storage.getItem.mockImplementation(async () => ({ data: { value: null } }));
});

describe('a logo decode that outlives its editing session', () => {
  it('IS applied when the session is still the same (the control case)', async () => {
    render(<Host />);
    await openPreferences();
    pickFile();
    await act(async () => { pending.resolve(LOGO); });
    expect(screen.getByAltText(PREVIEW_ALT)).toBeTruthy();
  });

  it('is DROPPED when the modal was closed and reopened before it finished', async () => {
    render(<Host />);
    await openPreferences();
    pickFile();
    toggle();                                   // close mid-decode
    toggle();                                   // reopen — new editing session
    await openPreferences();
    await act(async () => { pending.resolve(LOGO); });
    expect(screen.queryByAltText(PREVIEW_ALT)).toBeNull();
  });

  it('is dropped after a close alone, so a later reopen cannot inherit it', async () => {
    render(<Host />);
    await openPreferences();
    pickFile();
    toggle();
    await act(async () => { pending.resolve(LOGO); });
    toggle();
    await openPreferences();
    expect(screen.queryByAltText(PREVIEW_ALT)).toBeNull();
  });

  it('clears "מעבד…" even when the result is dropped, so the row is not left locked', async () => {
    render(<Host />);
    await openPreferences();
    pickFile();
    expect(screen.getByText('מעבד…')).toBeTruthy();
    toggle();
    toggle();
    await openPreferences();
    await act(async () => { pending.resolve(LOGO); });
    expect(screen.queryByText('מעבד…')).toBeNull();
    expect(document.querySelector('input[type="file"]').disabled).toBe(false);
  });

  it('does not surface a decode FAILURE from a session the owner already left', async () => {
    render(<Host />);
    await openPreferences();
    pickFile();
    toggle();
    toggle();
    await openPreferences();
    await act(async () => { pending.reject(new Error('boom')); });
    expect(screen.queryByText(/לא הצלחנו לקרוא את הקובץ/)).toBeNull();
  });

  it('DOES surface a decode failure that belongs to the current session', async () => {
    render(<Host />);
    await openPreferences();
    pickFile();
    await act(async () => { pending.reject(new Error('boom')); });
    expect(screen.getByText(/לא הצלחנו לקרוא את הקובץ/)).toBeTruthy();
  });
});
