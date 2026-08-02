import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round318 (owner request, from a screenshot) — לוגו and שמות התיבות are two
 * half-width boxes SIDE BY SIDE in העדפות, and neither carries its explanatory
 * paragraph any more.
 *
 * Both halves are pinned here because both are easy to undo by accident: the
 * pairing is one wrapper element that a later edit can drop while every row still
 * renders, and a removed sentence is one line away from coming back. The controls
 * themselves are asserted alongside, so "the text is gone" can never pass by the
 * box having gone with it.
 *
 * CSS-module classes are literal in tests (`classNameStrategy: 'non-scoped'`),
 * which is what lets the structure be queried at all — the same handle
 * boxLabelField.test.jsx already relies on.
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

function Host() {
  return (
    <MondayContext.Provider value={{ context: { instanceId: 'i1', boardId: 'b1' }, user: null }}>
      <SettingsProvider>
        <SettingsModal isOpen onClose={() => {}} templatesOnly={false} />
      </SettingsProvider>
    </MondayContext.Provider>
  );
}

const boxInputs = () => [...document.querySelectorAll('.boxLabelsRow input')];
const pair = () => document.querySelector('.prefPair');

const openPreferences = async () => {
  await waitFor(() => expect(screen.getByText('העדפות')).toBeTruthy());
  screen.getByText('העדפות').click();
  await waitFor(() => expect(boxInputs().length).toBe(3));
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.getItem.mockImplementation(async () => ({ data: { value: null } }));
});

describe('לוגו and שמות התיבות as a side-by-side pair', () => {
  it('puts exactly the two boxes in one pair wrapper, logo first', async () => {
    render(<Host />);
    await openPreferences();

    const children = [...(pair()?.children ?? [])];
    expect(children).toHaveLength(2);
    // Both are still ordinary preference boxes — the pair changes the layout, not
    // what they are.
    children.forEach((box) => expect(box.classList.contains('prefRow')).toBe(true));
    expect(children[0].textContent).toContain('לוגו');
    expect(children[1].textContent).toContain('שמות התיבות');
  });

  it('drops the explanatory paragraph from both boxes but keeps their controls', async () => {
    render(<Host />);
    await openPreferences();

    expect(screen.queryByText(/מוצג במסך הטעינה/)).toBeNull();
    expect(screen.queryByText(/שמות שלושת החלקים/)).toBeNull();

    // …and the boxes are still boxes: the upload control and all three name
    // fields are there, so the missing text above is the text and nothing else.
    expect(screen.getByText('העלאת לוגו')).toBeTruthy();
    expect(boxInputs()).toHaveLength(3);
  });

  it('keeps the three name fields inside the pair, not orphaned elsewhere', async () => {
    render(<Host />);
    await openPreferences();

    boxInputs().forEach((input) => expect(pair()?.contains(input)).toBe(true));
  });
});
