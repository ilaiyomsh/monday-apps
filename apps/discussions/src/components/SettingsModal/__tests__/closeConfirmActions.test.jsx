import React, { useState } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round334 — the action row of the unsaved-changes confirm dialog.
 *
 * The dialog's LOOK is CSS (equal thirds, radius, the tinted glyph) and jsdom
 * applies no CSS modules, so that part carries a logged waiver. What IS asserted
 * here is the part that lives in the markup and that a careless edit silently
 * breaks — the owner specified all four points explicitly:
 *
 *   1. All THREE actions sit in ONE row (one shared parent), not two stacked rows.
 *   2. RTL reading order, which in an RTL box IS the DOM order:
 *      המשך עריכה · יציאה ללא שמירה · שמירה ויציאה.
 *   3. Icons: an arrow on המשך עריכה, a diskette on שמירה ויציאה, and NOTHING on
 *      the middle button.
 *   4. Each button still does what it says — dismiss / leave without saving.
 *
 * The mocks mirror logoUploadRace.test.jsx, which is also how the dialog is
 * reached: a resolved logo decode makes `preferences` dirty, so the X asks
 * instead of closing.
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
const BACK = 'המשך עריכה';
const LEAVE = 'יציאה ללא שמירה';
const SAVE = 'שמירה ויציאה';

function Host() {
  const [open, setOpen] = useState(true);
  return (
    <MondayContext.Provider value={{ context: { instanceId: 'i1', boardId: 'b1' }, user: null }}>
      <SettingsProvider>
        <SettingsModal isOpen={open} onClose={() => setOpen(false)} templatesOnly={false} />
      </SettingsProvider>
    </MondayContext.Provider>
  );
}

/** Open settings, dirty it via a resolved logo decode, then press X. */
async function openConfirm() {
  render(<Host />);
  await waitFor(() => expect(screen.getByText('העדפות')).toBeTruthy());
  fireEvent.click(screen.getByText('העדפות'));
  await waitFor(() => expect(document.querySelector('input[type="file"]')).toBeTruthy());
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } });
  await act(async () => { pending.resolve(LOGO); });
  await act(async () => { fireEvent.click(screen.getByLabelText('סגירה')); });
  await waitFor(() => expect(screen.getByText('יש שינויים שלא נשמרו')).toBeTruthy());
}

/** The <button> carrying a label, whatever wrapper Vibe puts the text in. */
const btn = (label) => screen.getByText(label).closest('button');

/*
 * Which SIDE of its label a button's icon sits on: 'start' (= right, in RTL) or
 * 'end' (= left). It walks childNodes, not children — the label is a bare TEXT
 * node, so `firstElementChild`/`lastElementChild` both resolve to the single svg
 * no matter which side it is on, and an icon moved across the label survives
 * unnoticed (verified: that exact mutation survived the element-only version).
 */
function iconSide(button) {
  const nodes = Array.from(button.childNodes);
  const svgAt = nodes.findIndex((n) => n.nodeName.toLowerCase() === 'svg');
  const textAt = nodes.findIndex((n) => n.nodeType === 3 && n.textContent.trim());
  if (svgAt === -1) return 'no-icon';
  if (textAt === -1) return 'no-label';
  return svgAt < textAt ? 'start' : 'end';
}

beforeEach(() => {
  pending = null;
  vi.clearAllMocks();
  storage.getItem.mockImplementation(async () => ({ data: { value: null } }));
});

describe('round334 — the confirm dialog action row', () => {
  it('puts all three actions in ONE row', async () => {
    await openConfirm();
    const row = btn(BACK).parentElement;
    expect(btn(LEAVE).parentElement).toBe(row);
    expect(btn(SAVE).parentElement).toBe(row);
  });

  it('reads המשך עריכה → יציאה ללא שמירה → שמירה ויציאה right-to-left (= DOM order)', async () => {
    await openConfirm();
    const order = Array.from(btn(BACK).parentElement.children);
    expect(order.indexOf(btn(BACK))).toBe(0);
    expect(order.indexOf(btn(LEAVE))).toBe(1);
    expect(order.indexOf(btn(SAVE))).toBe(2);
  });

  it('gives המשך עריכה an arrow and שמירה ויציאה a diskette, and the middle button none', async () => {
    await openConfirm();
    expect(btn(BACK).querySelectorAll('svg').length).toBe(1);
    expect(btn(SAVE).querySelectorAll('svg').length).toBe(1);
    expect(btn(LEAVE).querySelectorAll('svg').length).toBe(0);
  });

  it('places the arrow at the START of המשך עריכה and the diskette at the END of שמירה ויציאה', async () => {
    await openConfirm();
    // In an RTL box the first child renders rightmost and the last leftmost, which
    // is exactly the owner's spec: arrow to the RIGHT of המשך עריכה, diskette to
    // the LEFT of שמירה ויציאה.
    expect(iconSide(btn(BACK))).toBe('start');
    expect(iconSide(btn(SAVE))).toBe('end');
  });

  it('dismisses on המשך עריכה and leaves the settings modal open', async () => {
    await openConfirm();
    await act(async () => { fireEvent.click(btn(BACK)); });
    expect(screen.queryByText('יש שינויים שלא נשמרו')).toBeNull();
    expect(screen.getByLabelText('סגירה')).toBeTruthy();   // settings still mounted+open
  });

  it('closes without persisting on יציאה ללא שמירה', async () => {
    await openConfirm();
    storage.setItem.mockClear();
    await act(async () => { fireEvent.click(btn(LEAVE)); });
    expect(screen.queryByText('יש שינויים שלא נשמרו')).toBeNull();
    expect(screen.queryByLabelText('סגירה')).toBeNull();   // settings closed
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
