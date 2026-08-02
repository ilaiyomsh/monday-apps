import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round314 (owner request) — Settings → העדפות renames the three panes of ניהול
 * הדיון. Two halves: the pure writer (what gets STORED, including "cleared") and
 * the row itself (that three editable fields exist and are wired to it).
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

import { SettingsModal, withBoxLabel } from '../SettingsModal.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';
import { DEFAULT_PREFERENCES, resolveBoxLabels } from '../../../utils/mondayApi/boards.config.js';

function Host() {
  return (
    <MondayContext.Provider value={{ context: { instanceId: 'i1', boardId: 'b1' }, user: null }}>
      <SettingsProvider>
        <SettingsModal isOpen onClose={() => {}} templatesOnly={false} />
      </SettingsProvider>
    </MondayContext.Provider>
  );
}

// Scoped to the row: 'רקע' is a plausible placeholder elsewhere in the modal.
const boxInputs = () => [...document.querySelectorAll('.boxLabelsRow input')];

/*
 * The DOM input keeps whatever was typed even when the field is wired to nothing
 * (the value prop is not re-asserted by @vibe/core's TextField), so reading it back
 * proves nothing about the draft — a no-op onChange survived exactly that assertion.
 * שמור is the observable that cannot lie: it persists the DRAFT preferences.
 */
const savedPreferences = async () => {
  fireEvent.click(screen.getByText('שמור'));
  await waitFor(() => expect(
    storage.setItem.mock.calls.some(([key]) => String(key).startsWith('discussions_settings')),
  ).toBe(true));
  const call = storage.setItem.mock.calls.filter(([key]) => String(key).startsWith('discussions_settings')).at(-1);
  return JSON.parse(call[1]).preferences;
};

const openPreferences = async () => {
  await waitFor(() => expect(screen.getByText('העדפות')).toBeTruthy());
  fireEvent.click(screen.getByText('העדפות'));
  await waitFor(() => expect(boxInputs().length).toBe(3));
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.getItem.mockImplementation(async () => ({ data: { value: null } }));
});

describe('withBoxLabel — what a typed box name stores', () => {
  it('writes the named key and leaves the other two on their default', () => {
    const next = withBoxLabel({}, 'references', 'הערות הצוות');
    expect(next.boxLabels).toEqual({ background: 'רקע', references: 'הערות הצוות', summary: 'סיכום' });
  });

  it('keeps an earlier rename when a second box is renamed', () => {
    const first = withBoxLabel({}, 'background', 'סקירה');
    const second = withBoxLabel(first, 'summary', 'מה סוכם');
    expect(second.boxLabels).toEqual({ background: 'סקירה', references: 'התייחסויות', summary: 'מה סוכם' });
  });

  it('stores an EMPTY name (the box must be clearable; the read side restores the default)', () => {
    const next = withBoxLabel({ boxLabels: { background: 'סקירה' } }, 'background', '');
    expect(next.boxLabels.background).toBe('');
    expect(resolveBoxLabels(next).background).toBe('רקע');
  });

  it('stores the RAW text untrimmed, so typing a space between words is not eaten', () => {
    expect(withBoxLabel({}, 'background', 'רקע ').boxLabels.background).toBe('רקע ');
  });

  it('coerces a non-string to an empty name rather than storing it', () => {
    expect(withBoxLabel({}, 'summary', undefined).boxLabels.summary).toBe('');
    expect(withBoxLabel({}, 'summary', 5).boxLabels.summary).toBe('');
  });

  it('ignores an unknown key — the three panes are a closed set', () => {
    const prefs = { boxLabels: { background: 'סקירה' } };
    expect(withBoxLabel(prefs, 'agenda', 'אג׳נדה')).toBe(prefs);
  });

  it('is pure — the input preferences object is never mutated', () => {
    const prefs = { logoUrl: null, boxLabels: { background: 'סקירה' } };
    const snapshot = JSON.stringify(prefs);
    withBoxLabel(prefs, 'summary', 'מה סוכם');
    expect(JSON.stringify(prefs)).toBe(snapshot);
  });

  it('carries the unrelated preferences through untouched', () => {
    const next = withBoxLabel({ logoUrl: 'data:x', showMyTasks: true }, 'background', 'סקירה');
    expect(next.logoUrl).toBe('data:x');
    expect(next.showMyTasks).toBe(true);
  });
});

describe('the שמות התיבות row in העדפות', () => {
  it('offers exactly three fields, one per pane, hinting and showing the shipped name', async () => {
    render(<Host />);
    await openPreferences();
    const shipped = [
      DEFAULT_PREFERENCES.boxLabels.background,
      DEFAULT_PREFERENCES.boxLabels.references,
      DEFAULT_PREFERENCES.boxLabels.summary,
    ];
    expect(boxInputs().map((i) => i.getAttribute('placeholder'))).toEqual(shipped);
    // Nothing stored → the draft seeds from the defaults, so the owner edits the
    // names they can actually see rather than three blank boxes.
    expect(boxInputs().map((i) => i.value)).toEqual(shipped);
  });

  it('seeds each field from the stored name', async () => {
    storage.getItem.mockImplementation(async (key) => (
      String(key).startsWith('discussions_settings')
        ? { data: { value: JSON.stringify({ preferences: { boxLabels: { background: 'סקירה', references: 'הערות', summary: 'מה סוכם' } } }) } }
        : { data: { value: null } }
    ));
    render(<Host />);
    await openPreferences();
    expect(boxInputs().map((i) => i.value)).toEqual(['סקירה', 'הערות', 'מה סוכם']);
  });

  it('PERSISTS a typed rename, leaving the other two names alone', async () => {
    render(<Host />);
    await openPreferences();
    fireEvent.change(boxInputs()[0], { target: { value: 'סקירה' } });
    expect(await savedPreferences()).toMatchObject({
      boxLabels: {
        background: 'סקירה',
        references: DEFAULT_PREFERENCES.boxLabels.references,
        summary: DEFAULT_PREFERENCES.boxLabels.summary,
      },
    });
  });

  it('persists a CLEARED name (an empty field is a legal state, not a rejected edit)', async () => {
    storage.getItem.mockImplementation(async (key) => (
      String(key).startsWith('discussions_settings')
        ? { data: { value: JSON.stringify({ preferences: { boxLabels: { background: 'סקירה' } } }) } }
        : { data: { value: null } }
    ));
    render(<Host />);
    await openPreferences();
    expect(boxInputs()[0].value).toBe('סקירה');
    fireEvent.change(boxInputs()[0], { target: { value: '' } });
    const saved = await savedPreferences();
    expect(saved.boxLabels.background).toBe('');
    // …and the read side turns the cleared name back into the shipped one.
    expect(resolveBoxLabels(saved).background).toBe('רקע');
  });
});
